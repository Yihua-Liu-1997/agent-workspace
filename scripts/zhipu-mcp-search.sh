#!/bin/bash
# 智谱 MCP 搜索脚本

API_KEY="f6efdb78d38248ccaa04e504d8615469.UFCOZXA1JxTPRNyK"
MCP_URL="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"
QUERY="$1"

if [ -z "$QUERY" ]; then
    echo "用法: zhipu-mcp-search.sh <搜索关键词>"
    exit 1
fi

# 调用 MCP 工具
curl -s --max-time 60 "$MCP_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"method\": \"tools/call\",
        \"id\": 1,
        \"params\": {
            \"name\": \"webSearchPrime\",
            \"arguments\": {
                \"search_query\": \"$QUERY\"
            }
        }
    }" | grep -oP '"text":"[^"]*"' | sed 's/"text":"//;s/"$//'
