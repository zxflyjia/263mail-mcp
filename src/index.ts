#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 验证必需的环境变量
const REQUIRED_ENV_VARS = [
  'MAIL_263_ACCOUNT',
  'MAIL_263_SECRET',
  'MAIL_263_DOMAIN',
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  'DINGTALK_AGENT_ID', // 新增：钉钉应用的AgentId
];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    console.error(`错误: 缺少必需的环境变量 ${envVar}`);
    process.exit(1);
  }
}

// 输出配置信息用于调试（不输出敏感信息）
console.error('[MCP] 环境变量配置:');
console.error('[MCP] MAIL_263_ACCOUNT:', process.env.MAIL_263_ACCOUNT);
console.error('[MCP] MAIL_263_DOMAIN:', process.env.MAIL_263_DOMAIN);
console.error('[MCP] DINGTALK_AGENT_ID:', process.env.DINGTALK_AGENT_ID);
console.error('[MCP] DINGTALK_APP_KEY:', process.env.DINGTALK_APP_KEY?.substring(0, 10) + '...');

// 初始化客户端
const mailClient = new Mail263Client({
  account: process.env.MAIL_263_ACCOUNT!,
  secret: process.env.MAIL_263_SECRET!,
  domain: process.env.MAIL_263_DOMAIN!,
  apiUrl: process.env.MAIL_263_API_URL || 'https://ma.263.net/api/mail/v2',
});

const dingTalkClient = new DingTalkClient({
  appKey: process.env.DINGTALK_APP_KEY!,
  appSecret: process.env.DINGTALK_APP_SECRET!,
});

const verificationManager = new VerificationCodeManager();

// 定义工具
const TOOLS: Tool[] = [
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

// 创建服务器实例
const server = new Server(
  {
    name: 'mcp-263mail-manager',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 处理工具列表请求
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// 处理工具调用请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
            dingUserId = await dingTalkClient.getUserIdByJobNumber(employee_id);
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
          const verificationCode = verificationManager.generateCode(employee_id, new_password);
          console.error('[MCP] 验证码已生成:', verificationCode);

          // 发送钉钉消息
          console.error('[MCP] 发送钉钉消息...');
          try {
            await dingTalkClient.sendVerificationCode(dingUserId, verificationCode, user.xmname);
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
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('263邮箱MCP Server已启动 (v2.0.0 - 验证码版本)');
}

main().catch((error) => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});
