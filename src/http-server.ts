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

// 创建 MCP 服务器实例
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
    async (input: any, context: any) => toolHandler(tool.name, input, context)
  );
}

// 创建 Streamable HTTP Transport
// 根据 MCP 协议 2025-03-26 规范，使用 sessionIdGenerator 支持有状态会话
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),   // 有状态模式：服务器生成并管理会话ID
  // enableJsonResponse: false,              // 默认使用 SSE 流式响应（推荐）
});

// 连接 transport 到 MCP server（关键步骤！）
await mcpServer.connect(transport);

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    transport: 'streamable-http',
    protocol: '2025-03-26',
    features: ['SSE', 'session-management', 'POST', 'GET'],
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

// MCP 端点 - 实现 Streamable HTTP 协议
// 根据规范，必须支持 POST 和 GET 方法
app.post('/mcp', authMiddleware, async (req, res) => {
  try {
    // POST 方法：客户端发送 JSON-RPC 请求
    // Transport 会处理请求并返回响应（可能是单个 JSON 或 SSE 流）
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('POST /mcp 处理错误:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.get('/mcp', authMiddleware, async (req, res) => {
  try {
    // GET 方法：客户端建立 SSE 连接以接收服务器通知
    // Transport 会建立持久 SSE 连接用于服务器到客户端的消息
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('GET /mcp 处理错误:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// DELETE 方法：根据协议规范，用于终止会话
app.delete('/mcp', authMiddleware, async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('DELETE /mcp 处理错误:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// 启动 HTTP 服务器
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📧 263邮箱 MCP Server (Streamable HTTP)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 状态: 运行中`);
  console.log(`🌐 端点: http://0.0.0.0:${PORT}/mcp`);
  console.log(`❤️  健康: http://localhost:${PORT}/health`);
  console.log(`📋 协议: MCP Streamable HTTP (2025-03-26)`);
  console.log(`🔐 认证: ${REQUIRE_AUTH ? `Bearer ${API_KEY?.slice(0, 4)}...` : '关闭'}`);
  console.log(`🔧 工具: ${TOOLS.length} 个已注册`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信号，正在优雅关闭...');
  server.close(async () => {
    await mcpServer.close();
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\n收到 SIGINT 信号，正在优雅关闭...');
  server.close(async () => {
    await mcpServer.close();
    console.log('服务器已关闭');
    process.exit(0);
  });
});