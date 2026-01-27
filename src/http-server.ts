#!/usr/bin/env node

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools-definition.js';
import { createToolHandler } from './tools.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

const API_KEY = process.env.MCP_API_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

if (REQUIRE_AUTH && !API_KEY) {
  console.error('错误: 需要设置 MCP_API_KEY 环境变量，或设置 REQUIRE_AUTH=false');
  process.exit(1);
}

// 初始化
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

const mcpServer = new McpServer({
  name: 'mcp-263mail-manager',
  version: '2.0.0',
});

// 注册所有工具
const toolHandler = createToolHandler(mailClient, dingTalkClient, verificationManager);

for (const tool of TOOLS) {
  mcpServer.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (input, context) => toolHandler(tool.name, input, context)
  );
}

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),   // 支持会话（stateful）
  enableJsonResponse: false,                // 使用 SSE 流式（推荐）
  // 如需纯 JSON 模式，可设为 true
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    transport: 'streamable-http',
    auth: REQUIRE_AUTH ? 'enabled' : 'disabled',
  });
});

// 认证中间件
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!REQUIRE_AUTH) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: '需要 Bearer Token' });
  }

  const token = authHeader.slice(7);
  if (token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Token 无效' });
  }

  next();
};

// MCP 端点（Streamable HTTP 需要手动处理 req/res）
app.all('/mcp', authMiddleware, async (req, res) => {
  // 支持 GET/POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    await transport.handle(req, res);
  } catch (err) {
    console.error('Transport 处理错误:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 启动服务器
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] MCP Server (Streamable HTTP) 已启动`);
  console.log(`端点: http://0.0.0.0:${PORT}/mcp`);
  console.log(`健康: http://localhost:${PORT}/health`);
  console.log(`认证: ${REQUIRE_AUTH ? `Bearer ${API_KEY?.slice(0,4)}...` : '关闭'}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM，关闭服务器...');
  server.close(() => process.exit(0));
});