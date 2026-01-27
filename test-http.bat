@echo off
REM HTTP服务器测试脚本 (Windows)

set BASE_URL=http://localhost:3000

REM 提示用户设置 API Key
if "%MCP_API_KEY%"=="" (
  echo 警告: 未设置 MCP_API_KEY 环境变量
  echo 如果服务器启用了认证，请先设置: set MCP_API_KEY=your_key
  echo.
)

echo === 测试 263邮箱MCP HTTP服务器 ===
echo.

REM 1. 健康检查
echo 1. 测试健康检查端点（无需认证）...
curl -s "%BASE_URL%/health"
echo.
echo.

REM 2. 测试未认证的请求
echo 2. 测试未认证的请求（应该返回 401）...
curl -s -X POST "%BASE_URL%/mcp" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
echo.
echo.

REM 3. 获取工具列表（使用 API Key）
if not "%MCP_API_KEY%"=="" (
  echo 3. 获取工具列表（使用 Authorization Bearer）...
  curl -s -X POST "%BASE_URL%/mcp" -H "Content-Type: application/json" -H "Authorization: Bearer %MCP_API_KEY%" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
  echo.
  echo.

  echo 4. 获取工具列表（使用 X-API-Key）...
  curl -s -X POST "%BASE_URL%/mcp" -H "Content-Type: application/json" -H "X-API-Key: %MCP_API_KEY%" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
  echo.
  echo.
)

REM 3. 测试说明
echo 3. 测试查询用户工具（示例）...
echo 请使用以下命令测试实际工号：
echo curl -X POST %BASE_URL%/mcp ^
echo   -H "Content-Type: application/json" ^
echo   -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_user_by_employee_id\",\"arguments\":{\"employee_id\":\"YOUR_EMPLOYEE_ID\"}}}"
echo.

echo === 测试完成 ===
pause
