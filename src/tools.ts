/**
 * MCP 工具定义和处理器
 */

import {
  Tool,
  CallToolRequestSchema,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';

/**
 * 工具定义
 */
export const TOOLS: Tool[] = [
  {
    name: 'request_password_reset',
    description: '发起密码重置请求。系统会向员工的钉钉发送验证码。',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'string',
          description: '员工工号',
        },
        new_password: {
          type: 'string',
          description: '新密码(明文，至少8位)',
        },
      },
      required: ['employee_id', 'new_password'],
    },
  },
  {
    name: 'confirm_password_reset',
    description: '使用验证码确认并完成密码重置。',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'string',
          description: '员工工号',
        },
        verification_code: {
          type: 'string',
          description: '6位数字验证码',
        },
      },
      required: ['employee_id', 'verification_code'],
    },
  },
  {
    name: 'get_user_by_employee_id',
    description: '通过员工工号查询用户信息。',
    inputSchema: {
      type: 'object',
      properties: {
        employee_id: {
          type: 'string',
          description: '员工工号',
        },
      },
      required: ['employee_id'],
    },
  },
];

/**
 * 创建工具处理器
 */
export function createToolHandlers(
  mailClient: Mail263Client,
  dingTalkClient: DingTalkClient,
  verificationManager: VerificationCodeManager
) {
  return async (request: typeof CallToolRequestSchema._type): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'request_password_reset': {
          const { employee_id, new_password } = args as {
            employee_id: string;
            new_password: string;
          };

          console.error('[MCP] 收到密码重置请求，工号:', employee_id);

          // 验证密码强度
          if (new_password.length < 8) {
            return {
              content: [
                {
                  type: 'text',
                  text: '密码长度至少需要8位',
                },
              ],
            };
          }

          try {
            // 通过员工编号查找用户
            console.error('[MCP] 查询263邮箱用户列表...');
            const userList = await mailClient.getUserList();
            console.error('[MCP] 找到', userList.length, '个用户');

            const user = userList.find((u) => u.xmidnum === employee_id);

            if (!user) {
              console.error('[MCP] 未找到工号为', employee_id, '的员工');
              return {
                content: [
                  {
                    type: 'text',
                    text: `未找到工号为 ${employee_id} 的员工`,
                  },
                ],
              };
            }

            console.error('[MCP] 找到用户:', user.xmname, user.xmuserid);

            // 获取员工的钉钉用户ID
            console.error('[MCP] 查询钉钉用户ID...');
            let dingUserId: string;
            try {
              dingUserId =
                await dingTalkClient.getUserIdByJobNumber(employee_id);
              console.error('[MCP] 钉钉用户ID:', dingUserId);
            } catch (dingError) {
              console.error('[MCP] 查询钉钉用户失败:', dingError);
              return {
                content: [
                  {
                    type: 'text',
                    text: `无法找到工号 ${employee_id} 对应的钉钉账号。错误: ${dingError instanceof Error ? dingError.message : String(dingError)}`,
                  },
                ],
                isError: true,
              };
            }

            // 生成验证码
            console.error('[MCP] 生成验证码...');
            const verificationCode = verificationManager.generateCode(
              employee_id,
              new_password
            );
            console.error('[MCP] 验证码已生成:', verificationCode);

            // 发送钉钉消息
            console.error('[MCP] 发送钉钉消息...');
            try {
              await dingTalkClient.sendVerificationCode(
                dingUserId,
                verificationCode,
                user.xmname
              );
              console.error('[MCP] 消息发送成功');
            } catch (sendError) {
              console.error('[MCP] 发送消息失败:', sendError);
              // 清除已生成的验证码
              verificationManager.clearCode(employee_id);
              return {
                content: [
                  {
                    type: 'text',
                    text: `发送验证码失败。错误: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
                  },
                ],
                isError: true,
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `验证码已发送到员工 ${user.xmname}(工号:${employee_id}) 的钉钉账号。\n请在5分钟内输入验证码完成密码重置。`,
                },
              ],
            };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[MCP] 密码重置请求失败:', errorMsg);
            console.error('[MCP] 错误堆栈:', error);
            return {
              content: [
                {
                  type: 'text',
                  text: `操作失败: ${errorMsg}`,
                },
              ],
              isError: true,
            };
          }
        }

        case 'confirm_password_reset': {
          const { employee_id, verification_code } = args as {
            employee_id: string;
            verification_code: string;
          };

          // 验证验证码
          const validationResult = verificationManager.validateCode(
            employee_id,
            verification_code
          );

          if (!validationResult.valid) {
            return {
              content: [
                {
                  type: 'text',
                  text: validationResult.message,
                },
              ],
            };
          }

          // 获取用户信息
          const userList = await mailClient.getUserList();
          const user = userList.find((u) => u.xmidnum === employee_id);

          if (!user) {
            return {
              content: [
                {
                  type: 'text',
                  text: `未找到工号为 ${employee_id} 的员工`,
                },
              ],
            };
          }

          // 重置密码
          await mailClient.resetPassword(
            user.xmuserid.split('@')[0],
            validationResult.password!
          );

          // 清除验证码
          verificationManager.clearCode(employee_id);

          return {
            content: [
              {
                type: 'text',
                text: `成功重置员工 ${user.xmname}(${user.xmuserid}) 的密码！`,
              },
            ],
          };
        }

        case 'get_user_by_employee_id': {
          const { employee_id } = args as {
            employee_id: string;
          };

          // 通过员工编号查找用户
          const userList = await mailClient.getUserList();
          const user = userList.find((u) => u.xmidnum === employee_id);

          if (!user) {
            return {
              content: [
                {
                  type: 'text',
                  text: `未找到工号为 ${employee_id} 的员工`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    姓名: user.xmname,
                    邮箱: user.xmuserid,
                    工号: user.xmidnum,
                    职位: user.xmposition,
                    手机: user.xmcell,
                    状态: user.mailstatus === 1 ? '启用' : '禁用',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: `未知工具: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `执行失败: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  };
}
