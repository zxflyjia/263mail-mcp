import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './tools-definition.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';

// Re-export TOOLS for backward compatibility
export { TOOLS };

// 核心工具处理逻辑
async function handleToolCall(
  name: string,
  input: any,
  sessionId: string,
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
): Promise<CallToolResult> {
  try {
    switch (name) {
      case 'request_password_reset': {
        const { employee_id, new_password } = input;
        if (new_password.length < 8) throw new Error('密码至少8位');
        const code = verificationManager.generateCode(sessionId, employee_id, new_password);
        await dingTalkClient.sendVerificationCode(employee_id, code);
        return { content: [{ type: 'text', text: `验证码已发送至钉钉（员工 ${employee_id}），有效期5分钟` }] };
      }

      case 'confirm_password_reset': {
        const { employee_id, verification_code } = input;
        const result = verificationManager.validateCode(sessionId, employee_id, verification_code);
        if (!result.valid) throw new Error(result.message);
        const user = await mailClient.getUserByEmployeeId(employee_id);
        if (!user) throw new Error('员工不存在');
        await mailClient.resetPassword(user.xmuserid, result.password!);
        return { content: [{ type: 'text', text: '密码重置成功！' }] };
      }

      case 'get_user_by_employee_id': {
        const { employee_id } = input;
        const user = await mailClient.getUserByEmployeeId(employee_id);
        if (!user) throw new Error('员工不存在');
        return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `错误: ${err.message || '未知错误'}` }],
      isError: true,
    };
  }
}

// 为新的 McpServer API 创建处理器（用于 HTTP server）
export function createToolHandler(
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
) {
  return async (name: string, input: any, context?: any): Promise<CallToolResult> => {
    const sessionId = context?.sessionId || 'default';
    return handleToolCall(name, input, sessionId, mailClient, dingTalkClient, verificationManager);
  };
}

// 为旧的 Server API 创建处理器（用于 stdio server）
export function createToolHandlers(
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
) {
  return async (request: any) => {
    const { params } = request;
    const { name, arguments: input } = params;
    const sessionId = 'stdio-session';

    return handleToolCall(name, input, sessionId, mailClient, dingTalkClient, verificationManager);
  };
}