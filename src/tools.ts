// src/tools.ts (更新为支持 ctx.session.id，无遗漏)
import {
  CallToolRequestSchema,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpServerContext } from '@modelcontextprotocol/sdk/server/mcp.js'; // 导入 ctx 类型
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import { TOOLS } from './tools.js'; // 工具定义保持不变

/**
 * 创建工具处理器（支持 ctx.session.id 用于 per-session 状态）
 */
export function createToolHandlers(
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
) {
  return async (ctx: McpServerContext, request: typeof CallToolRequestSchema._type): Promise<CallToolResult> => {
    const sessionId = ctx.session?.id || 'stateless'; // 支持有状态会话

    try {
      switch (request.params.name) {
        case 'request_password_reset': {
          const { employee_id, new_password } = request.params.arguments;
          if (new_password.length < 8) {
            throw new Error('密码长度至少8位');
          }
          const code = verificationManager.generateCode(sessionId, employee_id, new_password);
          await dingTalkClient.sendVerificationCode(employee_id, code); // 假设dingtalkClient有此方法
          return {
            content: [{
              type: 'text',
              text: `验证码已发送至员工${employee_id}的钉钉（有效期5分钟）`,
            }],
          };
        }

        case 'confirm_password_reset': {
          const { employee_id, verification_code } = request.params.arguments;
          const result = verificationManager.validateCode(sessionId, employee_id, verification_code);
          if (!result.valid) {
            throw new Error(result.message);
          }
          const user = await mailClient.getUserByEmployeeId(employee_id);
          if (!user) {
            throw new Error('员工不存在');
          }
          await mailClient.resetPassword(user.xmuserid, result.password!);
          return {
            content: [{
              type: 'text',
              text: '密码重置成功',
            }],
          };
        }

        case 'get_user_by_employee_id': {
          const { employee_id } = request.params.arguments;
          const user = await mailClient.getUserByEmployeeId(employee_id);
          if (!user) {
            throw new Error('员工不存在');
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(user, null, 2),
            }],
          };
        }

        default:
          throw new Error(`未知工具: ${request.params.name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `错误: ${error.message}`,
        }],
        isError: true,
      };
    }
  };
}