# 263邮箱MCP服务器

通过 MCP (Model Context Protocol) 协议管理 263 企业邮箱密码，支持钉钉验证码验证。

## 功能特性

- 🔐 安全的密码重置流程（钉钉验证码验证）
- 👤 员工信息查询
- 🚀 支持多种传输方式：
  - **Stdio** - 标准输入输出（适用于本地CLI）
  - **HTTP + SSE** - HTTP服务器模式（适用于远程调用）

## 前置要求

- Node.js >= 18.0.0
- 263企业邮箱管理权限
- 钉钉企业应用权限

## 安装

```bash
npm install
npm run build
```

## 配置

复制 `.env.example` 为 `.env` 并填写配置：

```env
# 263邮箱API配置
MAIL_263_ACCOUNT=your_account
MAIL_263_SECRET=your_secret_key
MAIL_263_DOMAIN=your_domain.com

# 钉钉API配置
DINGTALK_APP_KEY=your_dingtalk_app_key
DINGTALK_APP_SECRET=your_dingtalk_app_secret
DINGTALK_AGENT_ID=your_dingtalk_agent_id

# HTTP服务器端口 (HTTP模式时使用，默认3000)
PORT=3000

# API地址 (可选，默认为线上环境)
MAIL_263_API_URL=https://ma.263.net/api/mail/v2
```

## 运行方式

### 方式1: Stdio模式（推荐用于 Claude Desktop 等本地客户端）

```bash
npm start
```

或者直接运行：

```bash
node build/index.js
```

#### 在 Claude Desktop 中配置

编辑 Claude Desktop 配置文件：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "263mail-manager": {
      "command": "node",
      "args": ["/path/to/mcp-263mail-manager/build/index.js"],
      "env": {
        "MAIL_263_ACCOUNT": "your_account",
        "MAIL_263_SECRET": "your_secret",
        "MAIL_263_DOMAIN": "your_domain.com",
        "DINGTALK_APP_KEY": "your_key",
        "DINGTALK_APP_SECRET": "your_secret",
        "DINGTALK_AGENT_ID": "your_agent_id"
      }
    }
  }
}
```

### 方式2: HTTP模式（推荐用于远程调用和生产环境）

#### 第一步：生成 API Key（推荐）

HTTP 模式默认启用认证保护。首先生成安全的 API Key：

```bash
npm run generate-key
```

将生成的 API Key 添加到 `.env` 文件：

```env
MCP_API_KEY=你生成的64位hex密钥
REQUIRE_AUTH=true
```

#### 第二步：启动服务器

```bash
npm run start:http
```

或者：

```bash
node build/http-server.js
```

服务器将在以下端点启动：

- **健康检查**: `http://localhost:3000/health` (无需认证)
- **MCP端点**: `http://localhost:3000/mcp` (需要认证)
- **SSE端点**: `http://localhost:3000/sse` (需要认证)

#### HTTP API 使用示例

**1. 健康检查（无需认证）**

```bash
curl http://localhost:3000/health
```

响应：
```json
{
  "status": "ok",
  "version": "2.0.0"
}
```

**2. 调用工具（需要 API Key）**

使用 `Authorization: Bearer` 头：

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_user_by_employee_id",
      "arguments": {
        "employee_id": "10001"
      }
    }
  }'
```

或使用 `X-API-Key` 头：

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_user_by_employee_id",
      "arguments": {
        "employee_id": "10001"
      }
    }
  }'
```

**认证失败响应**：

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

**3. 获取工具列表**

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## 可用工具

### 1. request_password_reset

发起密码重置请求，向员工钉钉发送验证码。

**参数**:
- `employee_id` (string): 员工工号
- `new_password` (string): 新密码（至少8位）

**示例**:
```json
{
  "name": "request_password_reset",
  "arguments": {
    "employee_id": "10001",
    "new_password": "NewSecurePass123"
  }
}
```

### 2. confirm_password_reset

使用验证码确认并完成密码重置。

**参数**:
- `employee_id` (string): 员工工号
- `verification_code` (string): 6位数字验证码

**示例**:
```json
{
  "name": "confirm_password_reset",
  "arguments": {
    "employee_id": "10001",
    "verification_code": "123456"
  }
}
```

### 3. get_user_by_employee_id

通过员工工号查询用户信息。

**参数**:
- `employee_id` (string): 员工工号

**示例**:
```json
{
  "name": "get_user_by_employee_id",
  "arguments": {
    "employee_id": "10001"
  }
}
```

## 工作流程

1. 调用 `request_password_reset` 发起密码重置请求
2. 员工收到钉钉验证码（有效期5分钟）
3. 调用 `confirm_password_reset` 使用验证码完成密码重置

## 传输方式对比

| 特性 | Stdio | HTTP + SSE |
|------|-------|------------|
| 适用场景 | 本地CLI工具 | 远程服务、Web集成 |
| 连接方式 | 进程标准输入输出 | HTTP请求/响应 |
| 安全性 | 本地进程隔离 | API Key + HTTPS |
| 部署复杂度 | 简单 | 中等 |
| 扩展性 | 单进程 | 可横向扩展 |
| 认证 | 不需要 | 默认启用 API Key |

## 安全性

### HTTP 模式认证

HTTP 模式默认启用 **API Key 认证机制**，防止未授权访问：

- ✅ 默认启用认证（`REQUIRE_AUTH=true`）
- ✅ 支持 `Authorization: Bearer` 和 `X-API-Key` 两种方式
- ✅ 健康检查端点无需认证
- ✅ 所有 MCP 工具端点需要认证

### 生成 API Key

```bash
npm run generate-key
```

### 生产环境建议

1. **必须使用 HTTPS**（通过 Nginx/Caddy 反向代理）
2. **限制 CORS 来源**（设置 `ALLOWED_ORIGIN`）
3. **配置防火墙规则**
4. **启用速率限制**
5. **定期轮换 API Key**

详细的安全配置请查看 [SECURITY.md](SECURITY.md)

## 开发

```bash
# 构建
npm run build

# 测试钉钉消息
npm run test:dingtalk <task_id>
```

## 架构说明

### 项目结构

```
src/
├── index.ts              # Stdio模式入口
├── http-server.ts        # HTTP模式入口
├── tools.ts              # 工具定义和处理器
├── env.ts                # 环境变量验证
├── mail263Client.ts      # 263邮箱API客户端
├── dingtalkClient.ts     # 钉钉API客户端
└── verificationManager.ts # 验证码管理器
```

### 核心模块

- **tools.ts**: 定义所有MCP工具和处理逻辑，被stdio和HTTP模式共享
- **env.ts**: 环境变量验证逻辑
- **mail263Client.ts**: 封装263邮箱API调用
- **dingtalkClient.ts**: 封装钉钉API调用
- **verificationManager.ts**: 验证码生成、验证和管理

## 安全考虑

1. **验证码安全**:
   - 5分钟有效期
   - 最多尝试3次
   - 内存存储（可考虑使用Redis）

2. **API安全**:
   - 所有敏感信息通过环境变量配置
   - 263邮箱API使用MD5签名验证

3. **HTTP模式安全建议**:
   - 生产环境使用HTTPS
   - 添加认证机制（JWT/API Key）
   - 配置防火墙规则
   - 使用反向代理（Nginx）

## 故障排查

### Stdio模式

检查日志输出（通过stderr）:
```bash
node build/index.js 2> server.log
```

### HTTP模式

查看控制台日志或使用健康检查：
```bash
curl http://localhost:3000/health
```

## 技术参考

- 📘 [MCP Protocol Documentation](https://modelcontextprotocol.io)
- 📘 [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

关于MCP协议从SSE到Streamable HTTP的演进，参考官方文档。

## License

MIT

## 作者

Your Name
