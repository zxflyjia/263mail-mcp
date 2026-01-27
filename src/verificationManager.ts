// src/verificationManager.ts (更新为 per-session，支持全面状态管理)
interface Verification {
  code: string;
  password: string;
  expireTime: number;
  attempts: number;
}

interface ValidationResult {
  valid: boolean;
  message: string;
  password?: string;
}

export class VerificationCodeManager {
  private verifications = new Map<string, Map<string, Verification>>(); // sessionId -> employeeId -> Verification
  private readonly CODE_EXPIRE_TIME = 5 * 60 * 1000; // 5分钟
  private readonly MAX_ATTEMPTS = 3; // 最大尝试次数

  /**
   * 生成6位数字验证码
   */
  private generateRandomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 为指定会话的员工生成验证码
   */
  generateCode(sessionId: string, employeeId: string, password: string): string {
    const sessionMap = this.verifications.get(sessionId) || new Map<string, Verification>();
    const code = this.generateRandomCode();
    const expireTime = Date.now() + this.CODE_EXPIRE_TIME;

    sessionMap.set(employeeId, {
      code,
      password,
      expireTime,
      attempts: 0,
    });

    this.verifications.set(sessionId, sessionMap);

    // 定时清理
    setTimeout(() => {
      this.clearCode(sessionId, employeeId);
    }, this.CODE_EXPIRE_TIME);

    return code;
  }

  /**
   * 验证指定会话的验证码
   */
  validateCode(sessionId: string, employeeId: string, inputCode: string): ValidationResult {
    const sessionMap = this.verifications.get(sessionId);
    if (!sessionMap) {
      return {
        valid: false,
        message: '会话无效或验证码不存在，请重新发起',
      };
    }

    const verification = sessionMap.get(employeeId);
    if (!verification) {
      return {
        valid: false,
        message: '验证码不存在或已过期，请重新发起密码重置请求',
      };
    }

    // 检查过期
    if (Date.now() > verification.expireTime) {
      this.clearCode(sessionId, employeeId);
      return {
        valid: false,
        message: '验证码已过期，请重新发起密码重置请求',
      };
    }

    // 检查尝试次数
    if (verification.attempts >= this.MAX_ATTEMPTS) {
      this.clearCode(sessionId, employeeId);
      return {
        valid: false,
        message: '验证码输入错误次数过多，请重新发起密码重置请求',
      };
    }

    // 校验
    if (verification.code !== inputCode) {
      verification.attempts++;
      const remaining = this.MAX_ATTEMPTS - verification.attempts;
      if (remaining === 0) {
        this.clearCode(sessionId, employeeId);
        return {
          valid: false,
          message: '验证码错误，已达最大尝试次数，请重新发起',
        };
      }
      return {
        valid: false,
        message: `验证码错误，还有 ${remaining} 次尝试机会`,
      };
    }

    // 成功
    return {
      valid: true,
      message: '验证成功',
      password: verification.password,
    };
  }

  /**
   * 清除指定会话的验证码
   */
  clearCode(sessionId: string, employeeId: string): void {
    const sessionMap = this.verifications.get(sessionId);
    if (sessionMap) {
      sessionMap.delete(employeeId);
      if (sessionMap.size === 0) {
        this.verifications.delete(sessionId);
      }
    }
  }

  /**
   * 获取剩余时间（秒）
   */
  getRemainingTime(sessionId: string, employeeId: string): number {
    const sessionMap = this.verifications.get(sessionId);
    if (!sessionMap) return 0;
    const verification = sessionMap.get(employeeId);
    if (!verification) return 0;
    const remaining = Math.max(0, verification.expireTime - Date.now());
    return Math.floor(remaining / 1000);
  }
}