interface VerificationData {
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
  private verifications: Map<string, VerificationData> = new Map();
  private readonly CODE_EXPIRE_TIME = 5 * 60 * 1000; // 5分钟
  private readonly MAX_ATTEMPTS = 3; // 最大尝试次数

  /**
   * 生成6位数字验证码
   */
  private generateRandomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 为员工生成验证码
   */
  generateCode(employeeId: string, password: string): string {
    const code = this.generateRandomCode();
    const expireTime = Date.now() + this.CODE_EXPIRE_TIME;

    this.verifications.set(employeeId, {
      code,
      password,
      expireTime,
      attempts: 0,
    });

    // 定时清理过期验证码
    setTimeout(() => {
      this.clearCode(employeeId);
    }, this.CODE_EXPIRE_TIME);

    return code;
  }

  /**
   * 验证验证码
   */
  validateCode(employeeId: string, inputCode: string): ValidationResult {
    const verification = this.verifications.get(employeeId);

    if (!verification) {
      return {
        valid: false,
        message: '验证码不存在或已过期，请重新发起密码重置请求',
      };
    }

    // 检查是否过期
    if (Date.now() > verification.expireTime) {
      this.clearCode(employeeId);
      return {
        valid: false,
        message: '验证码已过期，请重新发起密码重置请求',
      };
    }

    // 检查尝试次数
    if (verification.attempts >= this.MAX_ATTEMPTS) {
      this.clearCode(employeeId);
      return {
        valid: false,
        message: '验证码输入错误次数过多，请重新发起密码重置请求',
      };
    }

    // 验证码校验
    if (verification.code !== inputCode) {
      verification.attempts++;
      const remainingAttempts = this.MAX_ATTEMPTS - verification.attempts;
      
      if (remainingAttempts === 0) {
        this.clearCode(employeeId);
        return {
          valid: false,
          message: '验证码错误，已达最大尝试次数，请重新发起密码重置请求',
        };
      }

      return {
        valid: false,
        message: `验证码错误，还有 ${remainingAttempts} 次尝试机会`,
      };
    }

    // 验证成功
    return {
      valid: true,
      message: '验证成功',
      password: verification.password,
    };
  }

  /**
   * 清除验证码
   */
  clearCode(employeeId: string): void {
    this.verifications.delete(employeeId);
  }

  /**
   * 获取剩余有效时间（秒）
   */
  getRemainingTime(employeeId: string): number {
    const verification = this.verifications.get(employeeId);
    if (!verification) return 0;

    const remaining = Math.max(0, verification.expireTime - Date.now());
    return Math.floor(remaining / 1000);
  }
}
