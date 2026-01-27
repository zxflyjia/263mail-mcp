import { z } from 'zod';

export const TOOLS = [
  {
    name: 'request_password_reset',
    title: '请求密码重置验证码',
    description: '向员工钉钉发送密码重置验证码',
    inputSchema: z.object({
      employee_id: z.string().describe('员工ID'),
      new_password: z.string().min(8).describe('新密码，至少8位'),
    }),
  },
  {
    name: 'confirm_password_reset',
    title: '确认密码重置',
    description: '验证验证码并执行密码重置',
    inputSchema: z.object({
      employee_id: z.string().describe('员工ID'),
      verification_code: z.string().length(6).describe('6位验证码'),
    }),
  },
  {
    name: 'get_user_by_employee_id',
    title: '查询员工信息',
    description: '根据员工ID获取263邮箱用户信息',
    inputSchema: z.object({
      employee_id: z.string().describe('员工ID'),
    }),
  },
] as const;