import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './tools-definition.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';

export function createToolHandlers(
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
) {
  return async (request: any): Promise<CallToolResult> => {
    const toolName = request.params?.name;
    const args = request.params?.arguments || {};
    const sessionId = request.session?.id || 'default-session';

    try {
      switch (toolName) {
        case 'request_password_reset': {
          const { employee_id, new_password } = args;
          if (typeof new_password !== 'string' || new_password.length < 8) {
            throw new Error('密码长度至少8位');
          }
          const code = verificationManager.generateCode(sessionId, employee_id, new_password);
          await dingTalkClient.sendVerificationCode(employee_id, code);
          return {
            content: [{ type: 'text', text: `验证码已发送至员工 ${employee_id} 的钉钉，有效期5分钟` }]
          };
        }

        case 'confirm_password_reset': {
          const { employee_id, verification_code } = args;
          const result = verificationManager.validateCode(sessionId, employee_id, verification_code);
          if (!result.valid) {
            throw new Error(result.message);
          }
          const user = await mailClient.getUserByEmployeeId(employee_id);
          if (!user) {
            throw new Error('未找到该员工');
          }
          await mailClient.resetPassword(user.xmuserid, result.password!);
          return {
            content: [{ type: 'text', text: '密码重置成功' }]
          };
        }

        case 'get_user_by_employee_id': {
          const { employee_id } = args;
          const user = await mailClient.getUserByEmployeeId(employee_id);
          if (!user) {
            throw new Error('员工不存在');
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(user, null, 2) }]
          };
        }

        default:
          throw new Error(`未知工具: ${toolName}`);
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `错误: ${err.message || String(err)}` }],
        isError: true
      };
    }
  };
}