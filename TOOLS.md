# TOOLS.md - Local Notes

环境特定的工具配置和备忘录。

---

### Zhipu AI

- **API Key**: `f6efdb78d38248ccaa04e504d8615469.UFCOZXA1JxTPRNyK`
- **Base URL**: `https://open.bigmodel.cn/api/coding/paas/v4`
- **Embedding**: `embedding-3`（用于 memory_search）
- **Get Key**: https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys

---

### ClawHub CLI

技能市场 CLI。

```bash
# 必须用代理补丁
NODE_OPTIONS='--require /home/useradmin/fetch-patch.cjs' clawhub <command>
```

**常用命令：**
- `clawhub search <query>` - 搜索技能
- `clawhub install <slug>` - 安装技能
- `clawhub list` - 列出已安装技能

**技能目录**: `~/.openclaw/workspace/skills/`

---

### Kimi CLI

Moonshot AI 的命令行助手。

```bash
kimi -y -p "任务描述"      # 单次任务
kimi --quiet -p "..."      # 只输出结果
kimi -C                    # 继续上次会话
kimi acp                   # ACP 服务器模式
```

**安装位置**: `~/.local/lib/kimi/kimi`

---

### Gemini CLI

Google DeepMind 的命令行助手，可以读图。**内置 Google 搜索，不需要代理**。

```bash
gemini -y -p "任务描述"             # 单次任务（自动批准）
gemini --approval-mode plan -p "..." # 只读模式
gemini -m gemini-3.1-pro-preview -p "..."   # 指定模型
gemini -r latest -p "继续"          # 继续上次会话
```

**安装位置**: `/usr/bin/gemini`（v0.34.0）
**优势**: 免费搜索、推理强、不需要代理补丁

---

### AlphaXiv 论文推送

每日 9:00 自动推送热门 AI 论文到 Telegram。

**关键文件：**
- 主脚本：`~/.openclaw/workspace/scripts/alphaxiv-hot.js`（抓取+简报+评论+长文一体化）
- 长文独立脚本：`~/.openclaw/workspace/scripts/generate-reviews.js`（补跑/单独用）
- 长文目录：`~/.openclaw/workspace/data/paper-reviews/YYYY-MM-DD/`
- PDF 目录：`~/.openclaw/workspace/data/papers/YYYY-MM-DD/`
- cron ID：`d51375a7-0b0a-40ab-9fe4-4b1d8a7c52ae`

**常用命令：**
```bash
openclaw cron list                           # 查看 cron
openclaw cron run d51375a7-...               # 手动触发
node scripts/alphaxiv-hot.js                 # 完整流程
node scripts/generate-reviews.js             # 只跑长文（串行）
node scripts/generate-reviews.js 2603.28627  # 指定论文
node scripts/generate-reviews.js --dry-run   # 预检（含PDF）
node scripts/generate-reviews.js --skip-existing  # 跳过已有
```

**长文 Fallback 链路**: Gemini Pro (90s) → Gemini Flash (90s) → Flash+HTML (90s) → GLM-5

---

### 搜索工具（默认用这些）

- **fdfind** → 替代 `find`（更快更友好）
- **rg** → 替代 `grep`（速度爆快）
- **memory_search** → 语义搜索记忆文件

```bash
fdfind -e md . ~/path        # 找所有 .md 文件
fdfind -t f "pattern" ~/path # 按文件名搜索
rg "关键词" ~/path           # 搜索内容
rg -l "关键词" ~/path        # 只显示文件名
rg -C 3 "关键词" ~/path      # 显示上下文各3行
```

**注意**：Ubuntu 上 `fd` 叫 `fdfind`（fd 被其他包占用了）

---

Add whatever helps you do your job.
