import fetch from 'node-fetch';
import { URLSearchParams } from 'url';

interface DingTalkConfig {
  appKey: string;
  appSecret: string;
}

export class DingTalkClient {
  private config: DingTalkConfig;
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

  constructor(appKey: string, appSecret: string) {
    this.config = { appKey, appSecret };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpireTime) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      appkey: this.config.appKey,
      appsecret: this.config.appSecret,
    });

    const url = `https://oapi.dingtalk.com/gettoken?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`获取 access_token HTTP 失败: ${response.status}`);
    }

    const data: any = await response.json();
    if (data.errcode !== 0) {
      throw new Error(`钉钉返回错误: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpireTime = now + (data.expires_in * 1000 - 300000); // 提前5分钟刷新
    return this.accessToken!;
  }

  /**
   * 发送验证码到员工钉钉（使用机器人单聊消息）
   * 注意：employeeId 必须是钉钉的 unionId 或 userid
   */
  async sendVerificationCode(employeeId: string, code: string): Promise<void> {
    const accessToken = await this.getAccessToken();

    const url = `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend?access_token=${accessToken}`;

    const body = {
      robotCode: this.config.appKey,
      userIds: [employeeId],
      msgKey: 'sampleText',
      msgParam: JSON.stringify({
        content: `您的263邮箱密码重置验证码为：${code}，有效期5分钟。请勿泄露给他人。`
      })
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`钉钉发送 HTTP 失败: ${response.status} ${response.statusText}`);
    }

    const result: any = await response.json();
    if (result.errcode !== 0) {
      throw new Error(`钉钉发送失败: ${result.errmsg || JSON.stringify(result)}`);
    }

    console.log(`[DingTalk] 验证码已发送给 ${employeeId}`);
  }
}