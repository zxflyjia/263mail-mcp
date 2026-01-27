// src/http-server.ts (重写为Streamable HTTP，支持全面协议，无遗漏)
#!/usr/bin/env node

import express from 'express';
import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHttpServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, createToolHandlers } from './tools.js';
import { validateEnv } from './env.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 验证环境变量
validateEnv();

// 获取 API Key（仅支持 Authorization: Bearer）
const API_KEY = process.env.MCP_API_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

if (REQUIRE_AUTH && !API_KEY) {
  console.error('[HTTP] 错误: 启用认证时必须设置 MCP_API_KEY 环境变量');
  console.error('[HTTP] 提示: 设置 REQUIRE_AUTH=false 可以禁用认证（不推荐生产环境）');
  process.exit(1);
}

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

// 创建 MCP 服务器
const mcpServer = new McpServer(
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

// 设置工具处理器（现在支持 ctx.session.id 用于状态管理）
const toolHandlers = createToolHandlers(
  mailClient,
  dingTalkClient,
  verificationManager
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, toolHandlers);

// Streamable HTTP 传输配置（全面支持：会话、恢复、SSE可选、JSON响应模式）
const transport = new StreamableHttpServerTransport({
  enableSessions: true, // 启用会话管理（支持状态ful工具，如验证码）
  enableResumability: true, // 支持流恢复（Last-Event-ID）
  enableJsonResponse: false, // 禁用纯JSON模式，启用SSE流（全面支持）
  // 可选：自定义SSE配置
  sseOptions: {
    maxChunkSize: 64 * 1024, // 64KB 块
  },
});

// 连接传输
await mcpServer.connect(transport);

// 创建 Express 应用（用于 /health 和认证）
const app = express();
app.use(express.json({ limit: '10mb' }));

// 健康检查端点（无需认证）
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    transport: 'streamable-http',
    sessions: 'enabled',
  });
});

// 认证中间件（仅支持 Authorization: Bearer，移除 X-API-Key）
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!REQUIRE_AUTH) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization: Bearer header',
    });
  }

  const providedKey = authHeader.substring(7);
  if (providedKey !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  next();
};

// MCP 端点（应用认证 + Streamable HTTP 处理器）
app.use('/mcp', authMiddleware, transport.createRequestHandler());

// 启动服务器
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const server = app.listen(PORT, () => {
  console.log(`[HTTP] 263邮箱MCP Server已启动 (v2.0.0 - Streamable HTTP模式)`);
  console.log(`[HTTP] 端点: http://localhost:${PORT}/mcp (POST/GET)`);
  console.log(`[HTTP] 健康检查: http://localhost:${PORT}/health`);
  console.log(`[HTTP] 认证: Authorization: Bearer ${API_KEY ? '***' : 'disabled'}`);
});

// 优雅关闭
process.on('SIGINT', () => {
  server.close(() => {
    console.log('[HTTP] 服务器已关闭');
    process.exit(0);
  });
});