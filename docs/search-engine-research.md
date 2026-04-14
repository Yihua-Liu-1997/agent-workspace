# OpenClaw 搜索引擎后端调研报告

> 调研日期：2026-03-19  
> 目标：将 `web_search` 工具从 Brave Search 切换到 SearXNG 或其他自定义搜索后端

---

## 1. OpenClaw web_search 架构分析

### 1.1 支持的 Provider

OpenClaw **内置支持 5 种搜索 provider**，全部在源码 `dist/reply-Bm8VrLQh.js` 中硬编码实现：

| Provider | API Endpoint | 认证方式 | 结果格式 |
|----------|-------------|---------|---------|
| **Brave Search** | `https://api.search.brave.com/res/v1/web/search` | `X-Subscription-Token` header | 结构化结果（title/url/snippet） |
| **Gemini** (Google Search grounding) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key` header | AI 合成回答 + citations |
| **Grok** (xAI) | `https://api.x.ai/v1/responses` | `Authorization: Bearer` | AI 合成回答 + citations |
| **Kimi** (Moonshot) | `https://api.moonshot.ai/v1/chat/completions` | `Authorization: Bearer` | AI 合成回答 + citations |
| **Perplexity** | `https://api.perplexity.ai/search` (native) / OpenRouter | `Authorization: Bearer` | 结构化结果 或 AI 回答 |

### 1.2 Provider 选择机制

```javascript
// resolveSearchProvider(search) — 优先级：
// 1. 配置文件 tools.web.search.provider
// 2. 自动检测：brave → gemini → grok → kimi → perplexity
// 3. 默认 fallback: "brave"
```

**关键发现：provider 列表是硬编码的**，没有插件式的 provider 注册机制。`resolveSearchProvider()` 只接受这 5 个值，其他值会被忽略，最终 fallback 到 `"brave"`。

### 1.3 源码位置

- 主实现：`/usr/lib/node_modules/openclaw/dist/reply-Bm8VrLQh.js`（约第 95284 行开始）
- 配置/引导：`/usr/lib/node_modules/openclaw/dist/onboard-search-CeLQ2E2N.js`
- 配置文档：`/usr/lib/node_modules/openclaw/docs/tools/web.md`

---

## 2. 公共 SearXNG 实例测试

测试了多个公共 SearXNG 实例的 JSON API：

| 实例 | URL | 状态 | 说明 |
|------|-----|------|------|
| searx.be | `https://searx.be/search?q=test&format=json` | ❌ 403 Forbidden | 有 Cloudflare 验证 + JS fingerprint 检测 |
| search.sapti.me | `https://search.sapti.me/search?q=test&format=json` | ❌ 429 Too Many Requests | 限速严格 |
| searx.tiekoetter.com | 同上 | ❌ 429 Too Many Requests | 限速 |
| priv.au | 同上 | ❌ 429 Too Many Requests | 限速 |
| searx.work | 同上 | ❌ JS fingerprint 重定向 | 需要浏览器环境 |

**结论：公共 SearXNG 实例对 curl/程序化访问都有严格的反爬保护，不适合作为后端。**

### SearXNG JSON API 格式（参考）

SearXNG `format=json` 返回结构：
```json
{
  "query": "test",
  "number_of_results": 12345678,
  "results": [
    {
      "url": "https://example.com",
      "title": "Example Title",
      "content": "Snippet text...",
      "engine": "google",
      "score": 1.0,
      "category": "general"
    }
  ],
  "suggestions": ["related search"],
  "infoboxes": []
}
```

---

## 3. 四种方案评估

### 方案 A：直接修改 OpenClaw 源码

**原理**：修改 `reply-Bm8VrLQh.js` 中的 `resolveSearchProvider()` 和 `runWebSearch()`，添加 SearXNG 作为新 provider。

**步骤**：
1. 在 `resolveSearchProvider()` 中添加 `if (raw === "searxng") return "searxng";`
2. 在 `runWebSearch()` 中添加 SearXNG 分支，调用自建实例 API
3. 添加 `resolveSearxngConfig()` 等配置解析函数
4. 添加 `missingSearchKeyPayload()` 中的 searxng 分支（可选，如果需要 API key）

**优点**：
- 完全集成到 `web_search` 工具中，LLM 自然调用
- 享受内置的缓存、超时、错误处理机制
- 无需额外工具

**缺点**：
- ⚠️ **每次 `npm update openclaw` 都会被覆盖**，需要重新 patch
- 修改 minified 代码非常困难（变量名被混淆）
- 不支持 SecretRef 等高级配置
- 维护成本高

**可行性**：⭐⭐ (可以做到但不推荐)

---

### 方案 B：通过 OpenClaw Plugin 机制注册自定义搜索工具

**原理**：OpenClaw 支持通过 Plugin 注册 agent tools（`api.registerTool()`）。可以写一个插件注册 `searxng_search` 工具。

**步骤**：

1. 创建插件文件 `~/.openclaw/extensions/searxng-search/index.ts`：

```typescript
import { Type } from "@sinclair/typebox";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";

export default function (api: any) {
  api.registerTool(
    {
      name: "searxng_search",
      description: "Search the web using a self-hosted SearXNG instance. Returns titles, URLs, and snippets.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        count: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 20 })),
        language: Type.Optional(Type.String({ description: "ISO language code, e.g. 'en', 'zh'" })),
        categories: Type.Optional(Type.String({ description: "Comma-separated categories: general,images,news,science" })),
      }),
      async execute(_id: string, params: any) {
        const url = new URL(`${SEARXNG_URL}/search`);
        url.searchParams.set("q", params.query);
        url.searchParams.set("format", "json");
        url.searchParams.set("count", String(params.count || 5));
        if (params.language) url.searchParams.set("language", params.language);
        if (params.categories) url.searchParams.set("categories", params.categories);

        try {
          const res = await fetch(url.toString(), {
            headers: { "User-Agent": "OpenClaw/1.0" },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            return { content: [{ type: "text", text: `SearXNG error: ${res.status}` }] };
          }
          const data = await res.json();
          const results = (data.results || []).slice(0, params.count || 5);
          if (results.length === 0) {
            return { content: [{ type: "text", text: "No results found." }] };
          }
          const formatted = results.map((r: any, i: number) =>
            `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content || ""}`
          ).join("\n\n");
          return {
            content: [{
              type: "text",
              text: formatted,
            }],
          };
        } catch (err: any) {
          return { content: [{ type: "text", text: `SearXNG request failed: ${err.message}` }] };
        }
      },
    },
    { optional: true },
  );
}
```

2. 创建 `openclaw.plugin.json`：

```json
{
  "id": "searxng-search",
  "name": "SearXNG Search",
  "version": "1.0.0",
  "description": "Web search via self-hosted SearXNG"
}
```

3. 在 `openclaw.json` 中启用：

```json5
{
  plugins: {
    allow: ["searxng-search"],
    entries: {
      "searxng-search": { enabled: true }
    }
  },
  agents: {
    list: [{
      id: "main",
      tools: {
        allow: ["searxng_search", "group:core"]
      }
    }]
  }
}
```

4. 部署自建 SearXNG（Docker）：

```bash
docker run -d -p 8888:8080 --name searxng searxng/searxng
# 编辑 /etc/searxng/settings.yml 启用 JSON 格式
```

**优点**：
- ✅ 正规的扩展机制，不会被更新覆盖
- ✅ 支持所有插件特性（配置 schema、CLI 命令等）
- ✅ 工具独立于内置 `web_search`，可以共存
- ✅ 支持 SecretRef、环境变量等配置方式

**缺点**：
- 需要自己部署和维护 SearXNG 实例
- 需要写 TypeScript 插件代码
- LLM 需要学会在 `web_search`（Brave）和 `searxng_search` 之间选择

**可行性**：⭐⭐⭐⭐⭐ (推荐)

---

### 方案 C：通过 MCP Server 包装 SearXNG

**原理**：OpenClaw 支持 mcporter CLI 调用 MCP servers。写一个 MCP server 包装 SearXNG API。

**步骤**：

1. 写一个简单的 MCP server（Node.js 或 Python）：

```python
# searxng_mcp_server.py (Python, using mcp package)
from mcp.server.fastmcp import FastMCP
import httpx

SEARXNG_URL = "http://localhost:8888"

mcp = FastMCP("searxng-search")

@mcp.tool()
async def searxng_search(query: str, count: int = 5) -> str:
    """Search the web using SearXNG."""
    resp = httpx.get(f"{SEARXNG_URL}/search", params={
        "q": query, "format": "json", "count": count
    }, timeout=15)
    data = resp.json()
    results = data.get("results", [])[:count]
    if not results:
        return "No results found."
    return "\n\n".join(
        f"{i+1}. **{r['title']}**\n   {r['url']}\n   {r.get('content', '')}"
        for i, r in enumerate(results)
    )

if __name__ == "__main__":
    mcp.run()
```

2. 配置 mcporter 连接：

```bash
# 使用 mcporter CLI 配置
mcporter add searxng --command "python3 /path/to/searxng_mcp_server.py"
```

**优点**：
- MCP 是标准协议，可以复用于其他 AI 工具
- Python 实现简单

**缺点**：
- ⚠️ OpenClaw 的 MCP 支持需要额外配置，且 web_search 不会自动使用 MCP 工具
- LLM 需要显式调用 MCP 工具，而不是 `web_search`
- 多一层抽象，调试更复杂
- 公共 SearXNG 实例同样不可用，需要自建

**可行性**：⭐⭐⭐ (可行但不如方案 B 直接)

---

### 方案 D：写 Skill 让 Agent 用 exec+curl 调 SearXNG

**原理**：写一个 SKILL.md，教 agent 在需要搜索时用 `exec` + `curl` 调 SearXNG。

**步骤**：

1. 创建 skill：

```markdown
# ~/.openclaw/workspace/skills/searxng-search/SKILL.md

## SearXNG Web Search

When the user asks to search the web using SearXNG, or when `web_search` 
(Brave) is unavailable, use this approach:

### Steps

1. Run a shell command to query the SearXNG instance:
```bash
curl -s --max-time 15 "http://localhost:8888/search?q=<URL-ENCODED-QUERY>&format=json&count=5"
```

2. Parse the JSON response and extract `results[].title`, `results[].url`, `results[].content`
3. Format and present results to the user

### Notes
- Always URL-encode the query
- The SearXNG instance runs on localhost:8888
- If the instance is down, fall back to the built-in `web_search` tool
```

**优点**：
- 最简单，不需要写代码
- 不影响现有工具

**缺点**：
- ❌ 依赖 agent "记住" 使用这个 skill，不够可靠
- ❌ 每次 exec 都有开销，不如工具调用高效
- ❌ JSON 解析在 agent 层面完成，容易出错
- ❌ 无法被 system prompt 中的工具列表发现

**可行性**：⭐⭐ (最简单但最不可靠)

---

## 4. 方案对比总结

| 维度 | 方案 A (改源码) | 方案 B (Plugin) | 方案 C (MCP) | 方案 D (Skill) |
|------|:-:|:-:|:-:|:-:|
| 实现难度 | 🔴 高 (minified) | 🟢 中 | 🟡 中 | 🟢 低 |
| 维护成本 | 🔴 高 (更新覆盖) | 🟢 低 | 🟡 中 | 🟡 中 |
| 稳定性 | 🟡 中 | 🟢 高 | 🟢 高 | 🔴 低 |
| 集成度 | 🟢 完全集成 | 🟢 工具级别集成 | 🟡 需额外配置 | 🔴 agent 自行决定 |
| 自建实例需求 | ✅ 需要 | ✅ 需要 | ✅ 需要 | ✅ 需要 |
| 推荐指数 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

---

## 5. 推荐方案：方案 B（Plugin）

### 推荐理由

1. **正规机制**：OpenClaw 原生支持 `api.registerTool()`，不会被更新覆盖
2. **完全集成**：注册后的工具和内置工具一样出现在 LLM 的工具列表中
3. **配置灵活**：支持环境变量、SecretRef、JSON Schema 配置
4. **可共存**：和内置 `web_search` (Brave/Gemini/etc) 共存，LLM 可以按需选择
5. **可扩展**：未来可以加更多功能（图片搜索、新闻搜索等）

### 注意事项

- **必须自建 SearXNG 实例**，公共实例对 API 访问都有严格的反爬保护
- Docker 部署 SearXNG 非常简单：`docker run -d -p 8888:8080 searxng/searxng`
- 如果不想维护 SearXNG，可以考虑直接用 Gemini（免费额度大）或 Perplexity

### 替代考虑：不换引擎，换免费 Provider

如果目标是**省钱**而不是**换引擎**，可以考虑：

- **Gemini (Google Search grounding)**：免费额度很大，AI 合成回答质量高
- **Kimi (Moonshot)**：如果有 Moonshot API key，搜索功能免费
- 两者都可以通过 `openclaw configure --section web` 直接切换，无需写代码

---

## 6. 快速实施清单（方案 B）

```bash
# 1. 部署 SearXNG
docker run -d -p 8888:8080 --name searxng -v ./searxng-settings.yml:/etc/searxng/settings.yml searxng/searxng

# 2. 创建插件目录
mkdir -p ~/.openclaw/extensions/searxng-search

# 3. 写入插件代码（见方案 B 的代码）
# 4. 写入 openclaw.plugin.json（见方案 B）
# 5. 重启 Gateway
openclaw gateway restart

# 6. 验证
openclaw plugins list  # 应该看到 searxng-search
```
