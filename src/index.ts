#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import { TOOLS, createToolHandlers } from './tools.js';
import { validateEnv } from './env.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 验证必需的环境变量
validateEnv();

// 初始化客户端
const mailClient = new Mail263Client({
  account: process.env.MAIL_263_ACCOUNT!,
  secret: process.env.MAIL_263_SECRET!,
  domain: process.env.MAIL_263_DOMAIN!,
  apiUrl: process.env.MAIL_263_API_URL || 'https://ma.263.net/api/mail/v2',
});

const dingTalkClient = new DingTalkClient(
  process.env.DINGTALK_APP_KEY!,
  process.env.DINGTALK_APP_SECRET!
);

const verificationManager = new VerificationCodeManager();

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

// 设置请求处理器
const toolHandlers = createToolHandlers(
  mailClient,
  dingTalkClient,
  verificationManager
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, toolHandlers);

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('263邮箱MCP Server已启动 (v2.0.0 - 验证码版本 - Stdio模式)');
}

main().catch((error) => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});
