import crypto from 'crypto';
import fetch from 'node-fetch';

interface Mail263Config {
  account: string;
  secret: string;
  domain: string;
  apiUrl: string;
}

interface UserInfo {
  xmuserid: string;
  xmname: string;
  xmspace?: number;
  mailstatus?: number;
  emstatus?: number;
  tbpstatus?: number;
  xmalias?: string[];
  deptids?: number[];
  xmposition?: string;
  xmtel?: string;
  xmcell?: string;
  xmfax?: string;
  xmexpiretime?: string;
  xmregtime?: string;
  xmidnum?: string;
  remark?: string;
}

interface ApiResponse<T = any> {
  tag: string;
  errcode: number;
  errmsg: string;
  data?: T;
}

export class Mail263Client {
  private config: Mail263Config;

  constructor(config: Mail263Config) {
    this.config = config;
  }

  /**
   * 生成请求签名
   */
  private generateSign(params: Record<string, any>): string {
    // 移除null值
    const filteredParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && key !== 'sign') {
        filteredParams[key] = value;
      }
    }

    // 按key排序
    const sortedKeys = Object.keys(filteredParams).sort();
    const sortedParams: Record<string, any> = {};
    for (const key of sortedKeys) {
      sortedParams[key] = filteredParams[key];
    }

    // 生成JSON字符串
    const jsonStr = JSON.stringify(sortedParams);
    
    // 拼接密钥
    const signStr = jsonStr + this.config.secret;
    
    // MD5加密
    return crypto.createHash('md5').update(signStr, 'utf-8').digest('hex');
  }

  /**
   * 生成唯一请求标识
   */
  private generateTag(): string {
    return Date.now().toString();
  }

  /**
   * 发送API请求
   */
  private async request<T = any>(
    endpoint: string,
    params: Record<string, any>
  ): Promise<ApiResponse<T>> {
    const tag = this.generateTag();
    const ts = Date.now();

    const requestBody: Record<string, any> = {
      tag,
      account: this.config.account,
      ts,
      domain: this.config.domain,
      ...params,
    };

    // 生成签名
    const sign = this.generateSign(requestBody);
    requestBody.sign = sign;

    const url = `${this.config.apiUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as ApiResponse<T>;

    if (result.errcode !== 0) {
      throw new Error(`API错误 [${result.errcode}]: ${result.errmsg}`);
    }

    return result;
  }

  /**
   * 获取用户列表
   */
  async getUserList(): Promise<UserInfo[]> {
    const response = await this.request<UserInfo[]>('/user/list', {});
    return response.data || [];
  }

  /**
   * 获取指定用户信息
   */
  async getUserInfo(xmuserid: string): Promise<UserInfo> {
    const response = await this.request<UserInfo>('/user/info', {
      xmuserid,
    });

    if (!response.data) {
      throw new Error('用户不存在');
    }

    return response.data;
  }

  /**
   * 重置用户密码
   */
  async resetPassword(xmuserid: string, password: string): Promise<void> {
    // 将密码进行MD5加密
    const md5Password = crypto.createHash('md5').update(password).digest('hex');

    await this.request('/user/modpwd', {
      xmuserid,
      passwd: md5Password,
    });
  }

  /**
   * 通过员工编号查找用户
   */
  async getUserByEmployeeId(employeeId: string): Promise<UserInfo | null> {
    const userList = await this.getUserList();
    return userList.find((user) => user.xmidnum === employeeId) || null;
  }
}
