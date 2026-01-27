// src/dingtalkClient.ts (小更新：添加 sendVerificationCode 方法)
 // ... 现有代码保持不变，添加以下方法

  /**
   * 发送验证码到员工钉钉
   */
  async sendVerificationCode(employeeId: string, code: string): Promise<void> {
    // 查找员工钉钉ID (假设通过API获取，这里简化)
    // 实际需实现 getUserByEmployeeId from 263 or dingtalk
    // For demo, assume employeeId is dingtalk userid
    const accessToken = await this.getAccessToken();
    const url = `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend?access_token=${accessToken}`;
    const body = {
      robotCode: this.config.appKey,
      userIds: [employeeId], // assume employeeId is userid
      msgKey: 'sampleText',
      msgParam: JSON.stringify({
        content: `您的263邮箱密码重置验证码为: ${code}，有效期5分钟。`
      }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (result.errcode !== 0) {
      throw new Error(`钉钉发送失败: ${result.errmsg}`);
    }
  }