import { z } from 'zod';

export const TOOLS = [
  {
    name: 'request_password_reset',
    description: '向员工发送密码重置验证码（通过钉钉）',
    parameters: z.object({
      employee_id: z.string().describe('员工ID'),
      new_password: z.string().min(8).describe('新密码（至少8位）')
    })
  },
  {
    name: 'confirm_password_reset',
    description: '验证验证码并完成密码重置',
    parameters: z.object({
      employee_id: z.string().describe('员工ID'),
      verification_code: z.string().length(6).describe('6位验证码')
    })
  },
  {
    name: 'get_user_by_employee_id',
    description: '根据员工ID查询263邮箱用户信息',
    parameters: z.object({
      employee_id: z.string().describe('员工ID')
    })
  }
] as const;