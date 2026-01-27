#!/usr/bin/env node

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools-definition.js';
import { createToolHandlers } from './tools.js';
import { Mail263Client } from './mail263Client.js';
import { DingTalkClient } from './dingtalkClient.js';
import { VerificationCodeManager } from './verificationManager.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const API_KEY = process.env.MCP_API_KEY;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

if (REQUIRE_AUTH && !API_KEY) {
  console.error('必须设置 MCP_API_KEY 或将 REQUIRE_AUTH 设置为 false');
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

const mcpServer = new McpServer({
  name: 'mcp-263mail-manager',
  version: '2.0.0',
});

// 注册工具（当前SDK推荐方式）
for (const tool of TOOLS) {
  mcpServer.addTool(tool);
}

// 设置工具调用处理器
const toolHandler = createToolHandlers(mailClient, dingTalkClient, verificationManager);
mcpServer.setToolHandler(toolHandler);   // 如果此方法不存在，可换成下面方式

// 如果上面 setToolHandler 不存在，用下面这种更通用方式
// mcpServer.handleRequest = async (req) => {
//   if (req.method === 'tools/call') {
//     return toolHandler(req);
//   }
//   // 其他请求交给默认处理
//   return mcpServer.defaultHandler(req);
// };

const transport = new StreamableHTTPServerTransport({
  sessionEnabled: true,
  resumable: true,
  jsonResponseEnabled: false,
});

await mcpServer.connect(transport);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', mode: 'streamable-http' });
});

// 认证中间件
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!REQUIRE_AUTH) return next();

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '缺少或无效的 Authorization: Bearer' });
  }

  const key = auth.slice(7);
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'API Key 无效' });
  }

  next();
};

app.use('/mcp', authMiddleware, transport.handler());

// 启动
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`MCP Server (Streamable HTTP) 运行于 http://0.0.0.0:${PORT}/mcp`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
});