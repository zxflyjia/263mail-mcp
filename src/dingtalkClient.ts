// src/dingtalkClient.ts

// ... existing imports and class definition ...

export class DingTalkClient {
  // ... existing properties, constructor, getAccessToken(), etc. ...

  /**
   * 发送验证码到员工的钉钉（使用机器人单聊消息批量发送接口）
   * 注意：此接口需要应用拥有 "机器人发送单聊消息" 权限
   * employeeId 应为钉钉的 unionId 或 staffId（视你的场景而定）
   */
  async sendVerificationCode(employeeId: string, code: string): Promise<void> {
    const accessToken = await this.getAccessToken();

    const url = `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend?access_token=${accessToken}`;

    const body = {
      robotCode: this.config.appKey,           // 你的应用 robotCode (通常就是 appKey)
      userIds: [employeeId],                   // 接收人列表（这里只发给一人）
      msgKey: 'sampleText',                    // 文本消息类型
      msgParam: JSON.stringify({
        content: `您的263邮箱密码重置验证码为：${code}，有效期5分钟。请勿泄露。`
      })
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`DingTalk API HTTP error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errcode !== 0) {
      throw new Error(`DingTalk 发送失败: ${result.errmsg || result.errcode}`);
    }

    // 可选：记录日志
    console.log(`[DingTalk] 验证码已发送给 employee ${employeeId}`);
  }

  // ... rest of the class ...
}