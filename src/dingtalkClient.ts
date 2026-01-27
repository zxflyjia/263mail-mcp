import fetch from 'node-fetch';

interface DingTalkConfig {
  appKey: string;
  appSecret: string;
}

interface AccessTokenResponse {
  errcode: number;
  errmsg: string;
  access_token: string;
  expires_in: number;
}

interface UserListResponse {
  errcode: number;
  errmsg: string;
  result?: {
    list: Array<{
      userid: string;
      name: string;
      job_number?: string;
      mobile?: string;
    }>;
    has_more: boolean;
    next_cursor: number;
  };
}

interface DepartmentListResponse {
  errcode: number;
  errmsg: string;
  result?: Array<{
    dept_id: number;
    name: string;
  }>;
}

interface SendMessageResponse {
  errcode: number;
  errmsg: string;
  task_id?: number;
  request_id?: string;
}

export class DingTalkClient {
  private config: DingTalkConfig;
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

  constructor(config: DingTalkConfig) {
    this.config = config;
    console.error('[DingTalk] 初始化钉钉客户端');
    console.error('[DingTalk] AppKey:', config.appKey?.substring(0, 10) + '...');
  }

  /**
   * 获取访问令牌
   */
  private async getAccessToken(): Promise<string> {
    // 如果token还有效，直接返回
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      console.error('[DingTalk] 使用缓存的AccessToken');
      return this.accessToken;
    }

    console.error('[DingTalk] 获取新的AccessToken...');
    const url = `https://oapi.dingtalk.com/gettoken?appkey=${this.config.appKey}&appsecret=${this.config.appSecret}`;

    const response = await fetch(url);
    const result = (await response.json()) as AccessTokenResponse;

    console.error('[DingTalk] AccessToken响应:', JSON.stringify(result));

    if (result.errcode !== 0) {
      throw new Error(`获取钉钉AccessToken失败: [${result.errcode}] ${result.errmsg}`);
    }

    this.accessToken = result.access_token;
    // 提前5分钟过期
    this.tokenExpireTime = Date.now() + (result.expires_in - 300) * 1000;

    console.error('[DingTalk] AccessToken获取成功，有效期:', result.expires_in, '秒');
    return this.accessToken;
  }

  /**
   * 获取所有部门列表（递归获取所有子部门）
   */
  private async getDepartmentList(): Promise<number[]> {
    console.error('[DingTalk] 获取部门列表...');
    const accessToken = await this.getAccessToken();
    const url = `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${accessToken}`;

    const allDeptIds: number[] = [1]; // 包含根部门
    const queue: number[] = [1]; // 待处理的部门队列

    while (queue.length > 0) {
      const currentDeptId = queue.shift()!;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dept_id: currentDeptId,
        }),
      });

      const result = (await response.json()) as DepartmentListResponse;

      if (result.errcode === 0 && result.result) {
        for (const dept of result.result) {
          if (!allDeptIds.includes(dept.dept_id)) {
            allDeptIds.push(dept.dept_id);
            queue.push(dept.dept_id); // 继续获取子部门
          }
        }
      }
    }

    console.error('[DingTalk] 找到', allDeptIds.length, '个部门（含子部门）');
    return allDeptIds;
  }

  /**
   * 获取部门用户列表
   */
  private async getDepartmentUsers(deptId: number): Promise<Array<{ userid: string; name: string; job_number?: string }>> {
    const accessToken = await this.getAccessToken();
    const url = `https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${accessToken}`;

    let cursor = 0;
    const allUsers: Array<{ userid: string; name: string; job_number?: string }> = [];

    do {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dept_id: deptId,
          cursor: cursor,
          size: 100,
        }),
      });

      const result = (await response.json()) as UserListResponse;

      if (result.errcode !== 0) {
        console.error(`[DingTalk] 获取部门${deptId}用户失败:`, result.errmsg);
        break;
      }

      if (result.result?.list) {
        allUsers.push(...result.result.list);
      }

      if (!result.result?.has_more) {
        break;
      }

      cursor = result.result.next_cursor;
    } while (true);

    return allUsers;
  }

  /**
   * 通过工号获取钉钉用户ID
   * 优化：先尝试工号作为UserID，失败再遍历部门查找
   */
  async getUserIdByJobNumber(jobNumber: string): Promise<string> {
    console.error('[DingTalk] 开始查找工号:', jobNumber);

    // 快速路径：尝试直接使用工号作为UserID
    try {
      console.error('[DingTalk] 快速路径：尝试使用工号作为UserID');
      const accessToken = await this.getAccessToken();
      const url = `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${accessToken}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid: jobNumber }),
      });
      
      const result = await response.json() as any;
      
      if (result.errcode === 0 && result.result) {
        console.error('[DingTalk] ✅ 快速路径成功！UserID = 工号:', jobNumber);
        console.error('[DingTalk] 用户名:', result.result.name);
        return jobNumber;
      } else {
        console.error('[DingTalk] 快速路径失败，errcode:', result.errcode);
      }
    } catch (fastError) {
      console.error('[DingTalk] 快速路径异常:', fastError);
    }

    // 慢速路径：遍历所有部门查找
    console.error('[DingTalk] 使用慢速路径：遍历部门查找');
    
    try {
      // 获取所有部门
      const deptIds = await this.getDepartmentList();
      console.error('[DingTalk] 将在', deptIds.length, '个部门中查找');

      // 限制并发查询，避免API限流
      const batchSize = 10; // 每次查询10个部门
      
      for (let i = 0; i < deptIds.length; i += batchSize) {
        const batch = deptIds.slice(i, i + batchSize);
        console.error(`[DingTalk] 查询部门批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(deptIds.length / batchSize)}`);
        
        // 并发查询这批部门
        const results = await Promise.all(
          batch.map(async (deptId) => {
            try {
              const users = await this.getDepartmentUsers(deptId);
              return { deptId, users };
            } catch (err) {
              console.error(`[DingTalk] 查询部门 ${deptId} 失败:`, err);
              return { deptId, users: [] };
            }
          })
        );

        // 在这批结果中查找匹配的工号
        for (const { deptId, users } of results) {
          if (users.length > 0) {
            const matchedUser = users.find(u => u.job_number === jobNumber);
            if (matchedUser) {
              console.error('[DingTalk] ✅ 找到匹配用户:', matchedUser.name, matchedUser.userid);
              return matchedUser.userid;
            }
          }
        }
      }

      console.error('[DingTalk] ❌ 未找到工号对应的用户');
      throw new Error(`未找到工号 ${jobNumber} 对应的钉钉账号`);
    } catch (error) {
      console.error('[DingTalk] 查找用户时出错:', error);
      throw error;
    }
  }

  /**
   * ⭐ 关键修复：发送验证码消息
   * 
   * 钉钉 asyncsend_v2 API 的正确参数格式：
   * - agent_id: 整数（NOT 字符串）
   * - userid_list: 字符串，多个用户用 ',' 分隔（NOT 数组）
   * 
   * 例如：
   */
  async sendVerificationCode(
    userId: string,
    code: string,
    userName: string
  ): Promise<{ taskId: number; result: any }> {
    console.error('[DingTalk] ========== 发送验证码消息 ==========');
    console.error('[DingTalk] 目标用户ID:', userId);
    console.error('[DingTalk] 用户名:', userName);
    console.error('[DingTalk] 验证码:', code);

    const accessToken = await this.getAccessToken();
    
    const agentId = process.env.DINGTALK_AGENT_ID;
    if (!agentId) {
      throw new Error('缺少必需的环境变量: DINGTALK_AGENT_ID');
    }

    console.error('[DingTalk] 使用AgentId:', agentId);

    const url = `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${accessToken}`;

    // ⭐ 关键修复：正确的请求体格式
    const requestBody = {
      agent_id: parseInt(agentId), // ⭐ 必须转换为整数
      userid_list: userId, // ⭐ 必须是字符串，不是数组！多个用户用英文逗号分隔
      msg: {
        msgtype: 'text',
        text: {
          content: `【邮箱密码重置】\n${userName}，您好！\n\n您正在重置企业邮箱密码。\n验证码：${code}\n\n验证码有效期为5分钟，请勿泄露给他人。\n如非本人操作，请忽略此消息。`,
        },
      },
    };

    console.error('[DingTalk] 请求URL:', url);
    console.error('[DingTalk] 请求体:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const result = (await response.json()) as SendMessageResponse;
    
    console.error('[DingTalk] 发送消息响应:', JSON.stringify(result));

    if (result.errcode !== 0) {
      throw new Error(`发送钉钉消息失败: [${result.errcode}] ${result.errmsg}`);
    }

    console.error('[DingTalk] ✅ 消息发送成功');
    console.error('[DingTalk] Task ID:', result.task_id);
    console.error('[DingTalk] ========== 消息发送完成 ==========\n');

    return {
      taskId: result.task_id!,
      result: result,
    };
  }

  /**
   * 查询消息发送状态
   */
  async checkMessageStatus(taskId: number): Promise<any> {
    console.error('[DingTalk] 查询消息状态，Task ID:', taskId);

    const accessToken = await this.getAccessToken();
    const agentId = process.env.DINGTALK_AGENT_ID;

    if (!agentId) {
      throw new Error('缺少DINGTALK_AGENT_ID');
    }

    const url = `https://oapi.dingtalk.com/topapi/message/corpconversation/getsendresult?access_token=${accessToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: parseInt(agentId),
        task_id: taskId,
      }),
    });

    const result = await response.json() as any;

    console.error('[DingTalk] 消息状态查询结果:', JSON.stringify(result));

    if (result.errcode === 0) {
      return result.result?.send_result || result.result;
    }

    return null;
  }
}
