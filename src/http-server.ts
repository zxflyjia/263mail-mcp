#!/usr/bin/env node

import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { TOOLS } from './tools-definition.js';
import { createToolHandler } from './tools.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';

dotenv.config();

/* =========================
 * 基础配置
 * ========================= */
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.MCP_API_KEY || '';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

if (REQUIRE_AUTH && !API_KEY) {
  console.error('❌ REQUIRE_AUTH=true 但未设置 MCP_API_KEY');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));

/* =====================================================
 * ✅ 1. 钉钉心跳探活（必须最前 & 绝对纯净）
 * ===================================================== */
app.get('/', (_req, res) => {
  // 钉钉只看 200，不看内容
  res.status(200).send('OK');
});

/* =====================================================
 * 2. 日志中间件（跳过 /）
 * ===================================================== */
app.use((req, res, next) => {
  if (req.path === '/') return next();

  const ts = new Date().toISOString();
  console.error(`\n${'='.repeat(80)}`);
  console.error(`[${ts}] 📥 HTTP ${req.method} ${req.originalUrl}`);
  console.error(`[IP] ${req.ip || req.socket.remoteAddress}`);
  console.error(`[UA] ${req.headers['user-agent']}`);
  console.error(`[Headers]`, req.headers);

  const rawSend = res.send.bind(res);
  res.send = (body: any) => {
    console.error(`[RESP ${res.statusCode}]`, typeof body === 'string' ? body.slice(0, 300) : body);
    return rawSend(body);
  };

  next();
});

/* =====================================================
 * 3. 健康检查（给人看的，不给钉钉）
 * ===================================================== */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mcp-263mail-manager',
    version: '2.0.0',
    protocol: 'streamable-http',
    auth: REQUIRE_AUTH ? 'enabled' : 'disabled',
    tools: TOOLS.length,
  });
});

/* =====================================================
 * 4. 初始化业务客户端
 * ===================================================== */
const mailClient = new Mail263Client({
  account: process.env.MAIL_263_ACCOUNT!,
  secret: process.env.MAIL_263_SECRET!,
  domain: process.env.MAIL_263_DOMAIN!,
  apiUrl: process.env.MAIL_263_API_URL,
});

const dingTalkClient = new DingTalkClient(
  process.env.DINGTALK_APP_KEY!,
  process.env.DINGTALK_APP_SECRET!
);

const verificationManager = new VerificationCodeManager();

/* =====================================================
 * 5. MCP Server
 * ===================================================== */
const mcpServer = new McpServer({
  name: 'mcp-263mail-manager',
  version: '2.0.0',
});

const toolHandler = createToolHandler(
  mailClient,
  dingTalkClient,
  verificationManager
);

for (const tool of TOOLS) {
  mcpServer.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    (input, context) => toolHandler(tool.name, input, context)
  );
}

/* =====================================================
 * 6. Streamable HTTP Transport
 * ===================================================== */
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

await mcpServer.connect(transport);

/* =====================================================
 * 7. 鉴权（仅用于 /mcp）
 * ===================================================== */
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!REQUIRE_AUTH) return next();

  let token = '';

  if (req.query.key) token = String(req.query.key);
  else if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.slice(7);
  else if (req.headers['x-api-key'])
    token = String(req.headers['x-api-key']);

  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/* =====================================================
 * 8. MCP Endpoint（严格只做 MCP）
 * ===================================================== */

// POST → JSON-RPC
app.post('/mcp', authMiddleware, async (req, res) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (e: any) {
    console.error('[MCP POST ERROR]', e);
    if (!res.headersSent) res.status(500).end();
  }
});

// GET → SSE
app.get('/mcp', authMiddleware, async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (e: any) {
    console.error('[MCP GET ERROR]', e);
    if (!res.headersSent) res.status(500).end();
  }
});

// DELETE → 会话终止
app.delete('/mcp', authMiddleware, async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (e: any) {
    console.error('[MCP DELETE ERROR]', e);
    if (!res.headersSent) res.status(500).end();
  }
});

/* =====================================================
 * 9. 启动
 * ===================================================== */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 MCP Server READY');
  console.log(`🌐 MCP  : http://<公网IP>:${PORT}/mcp?key=***`);
  console.log(`❤️  Root: GET / (钉钉探活)`);
  console.log(`🩺 Health: /health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

/* =====================================================
 * 10. 优雅关闭
 * ===================================================== */
async function shutdown() {
  console.log('🛑 Shutting down...');
  server.close(async () => {
    await mcpServer.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);