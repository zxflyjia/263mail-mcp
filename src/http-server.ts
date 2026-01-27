#!/usr/bin/env node

import http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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

// 验证环境变量
validateEnv();

// 获取 API Key（如果启用认证）
const API_KEY = process.env.MCP_API_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false'; // 默认启用认证

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

// 创建 MCP 服务器实例
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

// 创建 HTTP 服务器
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

/**
 * 验证 API Key
 */
function authenticateRequest(req: http.IncomingMessage): boolean {
  // 如果未启用认证，直接通过
  if (!REQUIRE_AUTH) {
    return true;
  }

  // 从 Authorization header 获取 API Key
  // 支持两种格式: "Bearer <key>" 或 "<key>"
  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'] as string;

  if (!authHeader && !xApiKey) {
    return false;
  }

  let providedKey = '';
  if (authHeader) {
    // 支持 "Bearer TOKEN" 格式
    if (authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7);
    } else {
      providedKey = authHeader;
    }
  } else if (xApiKey) {
    providedKey = xApiKey;
  }

  return providedKey === API_KEY;
}

const httpServer = http.createServer(async (req, res) => {
  // 启用 CORS（生产环境应该限制 origin）
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key'
  );

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // 健康检查端点（不需要认证）
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '2.0.0' }));
      return;
    }

    // MCP 消息端点 (Streamable HTTP) - 需要认证
    if (req.url === '/mcp' && req.method === 'POST') {
      // 验证认证
      if (!authenticateRequest(req)) {
        console.error('[HTTP] 认证失败 - 无效或缺失的 API Key');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Unauthorized',
            message: 'Invalid or missing API key',
          })
        );
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const message = JSON.parse(body);
          console.error('[HTTP] 收到请求:', message.method);

          let result;

          // 处理 MCP 协议的各种方法
          switch (message.method) {
            case 'initialize':
              // MCP 初始化握手
              result = {
                protocolVersion: '2024-11-05',
                capabilities: {
                  tools: {},
                },
                serverInfo: {
                  name: 'mcp-263mail-manager',
                  version: '10.0.1',
                },
              };
              break;

            case 'initialized':
              // 确认初始化完成
              result = {};
              break;

            case 'tools/list':
              // 返回工具列表
              result = { tools: TOOLS };
              break;

            case 'tools/call':
              // 调用工具
              result = await toolHandlers(message);
              break;

            default:
              throw new Error(`Unsupported method: ${message.method}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result,
            })
          );
        } catch (error) {
          console.error('[HTTP] 处理请求失败:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body ? JSON.parse(body).id : null,
              error: {
                code: -32603,
                message:
                  error instanceof Error ? error.message : 'Internal error',
              },
            })
          );
        }
      });
      return;
    }

    // SSE 端点 (用于实时通信) - 需要认证
    if (req.url === '/sse' && req.method === 'GET') {
      // 验证认证
      if (!authenticateRequest(req)) {
        console.error('[HTTP] SSE 认证失败 - 无效或缺失的 API Key');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Unauthorized',
            message: 'Invalid or missing API key',
          })
        );
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // 发送初始连接消息
      res.write('data: {"type":"connected"}\n\n');

      // 保持连接
      const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(keepAlive);
        console.error('[SSE] 客户端断开连接');
      });

      return;
    }

    // 未找到的路由
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('[HTTP] 服务器错误:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    );
  }
});

// 启动服务器
httpServer.listen(PORT, () => {
  console.error(`[HTTP] 263邮箱MCP Server (HTTP模式) 已启动`);
  console.error(`[HTTP] 监听端口: ${PORT}`);
  console.error(`[HTTP] 认证状态: ${REQUIRE_AUTH ? '已启用 (需要 API Key)' : '已禁用 (不安全)'}`);
  if (REQUIRE_AUTH) {
    console.error(
      `[HTTP] API Key: ${API_KEY?.substring(0, 8)}...（已部分隐藏）`
    );
  }
  console.error(`[HTTP] 健康检查: http://localhost:${PORT}/health`);
  console.error(`[HTTP] MCP端点: http://localhost:${PORT}/mcp`);
  console.error(`[HTTP] SSE端点: http://localhost:${PORT}/sse`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.error('[HTTP] 收到 SIGTERM 信号，正在关闭服务器...');
  httpServer.close(() => {
    console.error('[HTTP] 服务器已关闭');
    process.exit(0);
  });
});
