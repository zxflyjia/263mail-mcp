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

// 请求日志中间件
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.error(`\n[${timestamp}] ${req.method} ${req.url}`);
  console.error(`[HTTP] Headers:`, JSON.stringify(req.headers, null, 2));
  if (req.body && Object.keys(req.body).length > 0) {
    console.error(`[HTTP] Body:`, JSON.stringify(req.body, null, 2));
  }
  next();
});

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
  if (!REQUIRE_AUTH) {
    console.error('[AUTH] 认证已禁用，直接通过');
    return next();
  }

  let token = '';

  // 1. URL 参数（优先，用于钉钉）
  const keyFromQuery = req.query.key || req.query.apiKey;
  if (keyFromQuery) {
    token = String(keyFromQuery);
    console.error(`[AUTH] 从 URL 参数获取 Token: ${token.substring(0, 8)}...`);
  }

  // 2. Authorization Header
  if (!token) {
    const authHeader = req.headers.authorization;
    console.error(`[AUTH] Authorization Header: ${authHeader ? authHeader.substring(0, 20) + '...' : '(无)'}`);

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
      console.error(`[AUTH] 从 Header 获取 Token: ${token.substring(0, 8)}...`);
    }
  }

  // 3. X-API-Key Header
  if (!token) {
    const xApiKey = req.headers['x-api-key'];
    if (xApiKey) {
      token = String(xApiKey);
      console.error(`[AUTH] 从 X-API-Key 获取 Token: ${token.substring(0, 8)}...`);
    }
  }

  // 验证
  if (!token) {
    console.error('[AUTH] ❌ 认证失败: 未提供 Token (Header 或 URL 参数)');
    return res.status(401).json({
      error: 'Unauthorized',
      message: '需要认证: Authorization Bearer 或 URL参数 ?key=xxx',
      hint: '钉钉配置示例: "url": "http://your-server/mcp?key=YOUR_API_KEY"'
    });
  }

  const isValid = token === API_KEY;
  console.error(`[AUTH] Token 验证: ${isValid ? '✅ 通过' : '❌ 失败'}`);

  if (!isValid) {
    console.error(`[AUTH] 提供的 Token: ${token.substring(0, 8)}...`);
    console.error(`[AUTH] 期望的 Token: ${API_KEY?.substring(0, 8)}...`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token 无效',
    });
  }

  next();
};

// MCP 端点 - 实现 Streamable HTTP 协议
// 根据规范，必须支持 POST 和 GET 方法
app.post('/mcp', authMiddleware, async (req, res) => {
  console.error('[MCP] POST 请求开始处理');
  console.error(`[MCP] 请求方法: ${req.body?.method}`);
  try {
    // POST 方法：客户端发送 JSON-RPC 请求
    // Transport 会处理请求并返回响应（可能是单个 JSON 或 SSE 流）
    await transport.handleRequest(req, res, req.body);
    console.error('[MCP] ✅ POST 请求处理完成');
  } catch (err: any) {
    console.error('[MCP] ❌ POST /mcp 处理错误:', err.message);
    console.error('[MCP] 错误堆栈:', err.stack);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  console.error('[MCP] GET 请求 - 建立 SSE 连接');

  // 检查认证（但不强制拦截，用于钉钉健康检查）
  if (REQUIRE_AUTH) {
    const keyFromQuery = req.query.key || req.query.apiKey;
    const authHeader = req.headers.authorization;
    const xApiKey = req.headers['x-api-key'];

    let token = '';
    if (keyFromQuery) token = String(keyFromQuery);
    else if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
    else if (xApiKey) token = String(xApiKey);

    // 如果没有提供任何认证信息 - 钉钉健康检查
    if (!token) {
      console.error('[MCP] ⚠️  未提供认证 - 返回配置提示（钉钉健康检查）');
      return res.status(200).json({
        status: 'ready',
        message: '263邮箱MCP服务器运行正常',
        hint: '使用此服务需要认证',
        config: {
          钉钉配置: {
            type: 'streamable-http',
            url: `http://${req.headers.host}/mcp?key=YOUR_API_KEY`,
          },
          说明: '请将 YOUR_API_KEY 替换为实际的密钥',
        },
      });
    }

    // 提供了 token 但验证失败
    if (token !== API_KEY) {
      console.error('[MCP] ❌ Token 无效');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API Key 无效',
      });
    }

    console.error('[MCP] ✅ 认证通过');
  }

  try {
    // GET 方法：客户端建立 SSE 连接以接收服务器通知
    await transport.handleRequest(req, res);
    console.error('[MCP] ✅ SSE 连接已建立');
  } catch (err: any) {
    console.error('[MCP] ❌ GET /mcp 处理错误:', err.message);
    console.error('[MCP] 错误堆栈:', err.stack);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
      });
    }
  }
});

// DELETE 方法：根据协议规范，用于终止会话
app.delete('/mcp', authMiddleware, async (req, res) => {
  console.error('[MCP] DELETE 请求 - 终止会话');
  try {
    await transport.handleRequest(req, res);
    console.error('[MCP] ✅ 会话已终止');
  } catch (err: any) {
    console.error('[MCP] ❌ DELETE /mcp 处理错误:', err.message);
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