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
  console.error(`[TOOL] 调用工具: ${name}, Session: ${sessionId}`);
  console.error(`[TOOL] 输入参数:`, JSON.stringify(input, null, 2));

  try {
    switch (name) {
      case 'request_password_reset': {
        const { employee_id, new_password } = input;
        console.error(`[TOOL] request_password_reset - 员工ID: ${employee_id}`);

        if (new_password.length < 8) {
          const error = '密码至少8位';
          console.error(`[TOOL] ❌ 验证失败: ${error}`);
          throw new Error(error);
        }

        console.error(`[TOOL] 生成验证码...`);
        const code = verificationManager.generateCode(sessionId, employee_id, new_password);
        console.error(`[TOOL] 验证码: ${code}`);

        console.error(`[TOOL] 发送钉钉消息...`);
        await dingTalkClient.sendVerificationCode(employee_id, code);

        const success = `验证码已发送至钉钉（员工 ${employee_id}），有效期5分钟`;
        console.error(`[TOOL] ✅ 成功: ${success}`);
        return { content: [{ type: 'text', text: success }] };
      }

      case 'confirm_password_reset': {
        const { employee_id, verification_code } = input;
        console.error(`[TOOL] confirm_password_reset - 员工ID: ${employee_id}, 验证码: ${verification_code}`);

        console.error(`[TOOL] 验证验证码...`);
        const result = verificationManager.validateCode(sessionId, employee_id, verification_code);
        if (!result.valid) {
          console.error(`[TOOL] ❌ 验证码验证失败: ${result.message}`);
          throw new Error(result.message);
        }
        console.error(`[TOOL] ✅ 验证码正确`);

        console.error(`[TOOL] 查询用户信息...`);
        const user = await mailClient.getUserByEmployeeId(employee_id);
        if (!user) {
          const error = '员工不存在';
          console.error(`[TOOL] ❌ ${error}`);
          throw new Error(error);
        }
        console.error(`[TOOL] 用户邮箱: ${user.xmuserid}`);

        console.error(`[TOOL] 重置密码...`);
        await mailClient.resetPassword(user.xmuserid, result.password!);

        const success = `密码重置成功！员工: ${employee_id}, 邮箱: ${user.xmuserid}`;
        console.error(`[TOOL] ✅ ${success}`);
        return { content: [{ type: 'text', text: success }] };
      }

      case 'get_user_by_employee_id': {
        const { employee_id } = input;
        console.error(`[TOOL] get_user_by_employee_id - 员工ID: ${employee_id}`);

        console.error(`[TOOL] 查询用户...`);
        const user = await mailClient.getUserByEmployeeId(employee_id);
        if (!user) {
          const error = `员工不存在: ${employee_id}`;
          console.error(`[TOOL] ❌ ${error}`);
          throw new Error(error);
        }

        const userInfo = {
          姓名: user.xmname,
          邮箱: user.xmuserid,
          工号: user.xmidnum,
          职位: user.xmposition,
          手机: user.xmcell,
          状态: user.mailstatus === 1 ? '启用' : '禁用',
        };

        console.error(`[TOOL] ✅ 查询成功:`, userInfo);
        return { content: [{ type: 'text', text: JSON.stringify(userInfo, null, 2) }] };
      }

      default:
        const error = `未知工具: ${name}`;
        console.error(`[TOOL] ❌ ${error}`);
        throw new Error(error);
    }
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    const stack = err.stack || '';

    console.error(`[TOOL] ❌ 执行失败: ${errorMsg}`);
    console.error(`[TOOL] 错误堆栈:`, stack);

    return {
      content: [{
        type: 'text',
        text: `❌ 错误: ${errorMsg}\n\n调用: ${name}\n参数: ${JSON.stringify(input, null, 2)}\n会话: ${sessionId}\n堆栈: ${stack.split('\n').slice(0, 3).join('\n')}`
      }],
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