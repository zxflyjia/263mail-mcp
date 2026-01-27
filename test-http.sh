#!/bin/bash

# HTTP服务器测试脚本

BASE_URL="http://localhost:3000"

# 从 .env 文件读取 API Key（如果存在）
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep MCP_API_KEY | xargs)
fi

# 如果没有设置 API Key，提示用户
if [ -z "$MCP_API_KEY" ]; then
  echo "警告: 未设置 MCP_API_KEY 环境变量"
  echo "如果服务器启用了认证，请先设置: export MCP_API_KEY=your_key"
  echo ""
fi

echo "=== 测试 263邮箱MCP HTTP服务器 ==="
echo ""

# 1. 健康检查
echo "1. 测试健康检查端点（无需认证）..."
curl -s "${BASE_URL}/health" | jq .
echo ""

# 2. 测试未认证的请求（应该返回 401）
echo "2. 测试未认证的请求（应该返回 401）..."
curl -s -X POST "${BASE_URL}/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq .
echo ""

# 3. 获取工具列表（使用 API Key）
if [ -n "$MCP_API_KEY" ]; then
  echo "3. 获取工具列表（使用 Authorization Bearer）..."
  curl -s -X POST "${BASE_URL}/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${MCP_API_KEY}" \
    -d '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/list",
      "params": {}
    }' | jq .
  echo ""

  echo "4. 获取工具列表（使用 X-API-Key）..."
  curl -s -X POST "${BASE_URL}/mcp" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${MCP_API_KEY}" \
    -d '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "tools/list",
      "params": {}
    }' | jq .
  echo ""
fi

# 3. 测试查询用户（需要替换实际的工号）
echo "3. 测试查询用户工具（示例）..."
echo "请使用以下命令测试实际工号："
echo "curl -X POST ${BASE_URL}/mcp \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{"
echo "    \"jsonrpc\": \"2.0\","
echo "    \"id\": 2,"
echo "    \"method\": \"tools/call\","
echo "    \"params\": {"
echo "      \"name\": \"get_user_by_employee_id\","
echo "      \"arguments\": {"
echo "        \"employee_id\": \"YOUR_EMPLOYEE_ID\""
echo "      }"
echo "    }"
echo "  }' | jq ."
echo ""

echo "=== 测试完成 ==="
