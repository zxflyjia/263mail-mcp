#!/usr/bin/env node

import http from 'http';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import { TOOLS, createToolHandlers } from './tools.js';
import { validateEnv } from './env.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 验证环境变量
validateEnv();

// 获取 API Key（如果启用认证）
const API_KEY = process.env.MCP_API_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

if (REQUIRE_AUTH && !API_KEY) {
  console.error('[HTTP] 错误: 启用认证时必须设置 MCP_API_KEY 环境变量');
  console.error('[HTTP] 提示: 设置 REQUIRE_AUTH=false 可以禁用认证（不推荐）');
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

// 设置请求处理器
const toolHandlers = createToolHandlers(
  mailClient,
  dingTalkClient,
  verificationManager
);

// 创建 HTTP 服务器
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

/**
 * 验证 API Key
 */
function authenticateRequest(req: http.IncomingMessage): boolean {
  if (!REQUIRE_AUTH) return true;

  let providedKey = '';

  // URL 参数
  if (req.url) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const keyFromQuery = url.searchParams.get('key') || url.searchParams.get('apiKey');
    if (keyFromQuery) providedKey = keyFromQuery;
  }

  // Authorization header
  if (!providedKey) {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      providedKey = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;
    }
  }

  // X-API-Key header
  if (!providedKey) {
    const xApiKey = req.headers['x-api-key'] as string;
    if (xApiKey) providedKey = xApiKey;
  }

  return providedKey === API_KEY;
}

// SSE 客户端管理
interface SSEClient {
  id: string;
  res: http.ServerResponse;
}

const sseClients = new Map<string, SSEClient>();

function sendSSE(client: SSEClient, data: any) {
  try {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error('[SSE] 发送失败:', error);
  }
}

const httpServer = http.createServer(async (req, res) => {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // 健康检查
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '10.0.2' }));
      return;
    }

    // SSE 连接 - GET /sse
    if (req.url?.startsWith('/sse') && req.method === 'GET') {
      if (!authenticateRequest(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      console.error('[SSE] 建立连接');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const clientId = `client_${Date.now()}`;
      const client: SSEClient = { id: clientId, res };
      sseClients.set(clientId, client);

      console.error(`[SSE] 客户端连接: ${clientId}, 总数: ${sseClients.size}`);

      // 发送初始化通知
      sendSSE(client, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      });

      // 心跳
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15000);

      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(clientId);
        console.error(`[SSE] 客户端断开: ${clientId}, 剩余: ${sseClients.size}`);
      });

      return;
    }

    // 消息端点 - POST /message
    if (req.url?.startsWith('/message') && req.method === 'POST') {
      if (!authenticateRequest(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => (body += chunk.toString()));
      req.on('end', async () => {
        try {
          const message = JSON.parse(body);
          console.error('[HTTP] 收到:', message.method);

          let result: any;

          switch (message.method) {
            case 'initialize':
              result = {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'mcp-263mail-manager', version: '10.0.2' },
              };
              break;

            case 'notifications/initialized':
              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ accepted: true }));
              return;

            case 'tools/list':
              result = { tools: TOOLS };
              break;

            case 'tools/call':
              result = await toolHandlers(message);
              break;

            case 'prompts/list':
              result = { prompts: [] };
              break;

            case 'resources/list':
              result = { resources: [] };
              break;

            case 'ping':
              result = {};
              break;

            default:
              throw new Error(`Unsupported: ${message.method}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        } catch (error) {
          console.error('[HTTP] 错误:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32603, message: error instanceof Error ? error.message : 'Error' },
            })
          );
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('[HTTP] 服务器错误:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error' }));
  }
});

// 启动
httpServer.listen(PORT, () => {
  console.error(`[HTTP] 263邮箱MCP Server (SSE模式) 已启动`);
  console.error(`[HTTP] 监听端口: ${PORT}`);
  console.error(`[HTTP] 认证: ${REQUIRE_AUTH ? '已启用' : '已禁用'}`);
  if (REQUIRE_AUTH) console.error(`[HTTP] API Key: ${API_KEY?.substring(0, 8)}...`);
  console.error(`[HTTP] 健康检查: http://localhost:${PORT}/health`);
  console.error(`[HTTP] SSE连接: GET http://localhost:${PORT}/sse`);
  console.error(`[HTTP] 消息端点: POST http://localhost:${PORT}/message`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.error('[HTTP] 关闭中...');
  httpServer.close(() => process.exit(0));
});
