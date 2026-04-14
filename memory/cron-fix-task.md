# Cron 论文推送问题与解决方案

## 问题

**现状：** 每天 9:00 cron 触发 isolated session，但 isolated session 只运行了 `alphaxiv-hot.js` 脚本，没有执行后续的 "spawn sub-agents 写长文" 逻辑。

**结果：** 只推送了简化版（标题 + 简短评论），没有详细长文分析。

**根本原因：** isolated session 收到指令后，没有理解/没有能力 spawn sub-agents。

## 解决方案（三选一）

### 方案 A：改脚本（推荐）
在 `alphaxiv-hot.js` 里调用 OpenClaw Gateway API spawn sub-agents。

**优点：** 完全自动化
**缺点：** 需要写代码，处理认证、等待、错误

**实现思路：**
```javascript
// 在脚本末尾添加
const papers = getTopPapers(); // 已有函数
papers.forEach(paper => {
  // 调用 OpenClaw API spawn sub-agent
  spawn(`node /path/to/review-agent.js ${paper.arxivId}`);
});
```

### 方案 B：cron 发提醒，手动执行
cron 只发消息到 Telegram "该推论文了"，然后手动或我在主 session 执行完整流程。

**优点：** 最简单，100% 可靠
**缺点：** 需要我在线

**实现：**
```bash
openclaw cron edit d51375a7-0b0a-40ab-9fe4-4b1d8a7c52ae \
  --message "🌸 该推论文了！请运行脚本并 spawn sub-agents 写长文"
```

### 方案 C：拆分成多个 cron
- cron 1 (9:00): 运行脚本 + 推送简化版
- cron 2 (9:10): spawn agent 写论文1
- cron 3 (9:10): spawn agent 写论文2
- ...

**优点：** 每个 cron 任务简单
**缺点：** 需要多个 cron，管理复杂

## 推荐方案

**短期（今天）：** 方案 B - 改成提醒模式，手动执行

**长期：** 方案 A - 改脚本，完全自动化

## 需要做的事

1. **修改 cron 配置**（方案 B）
   ```bash
   openclaw cron edit d51375a7-0b0a-40ab-9fe4-4b1d8a7c52ae \
     --message "🌸 该推论文了！请执行：1) node scripts/alphaxiv-hot.js 2) spawn 5个sub-agents写长文 3) 逐篇推送"
   ```

2. **或改脚本**（方案 A）
   - 在 `alphaxiv-hot.js` 里添加 spawn sub-agents 的逻辑
   - 需要调用 OpenClaw Gateway API

## 关键信息

- **Cron ID:** `d51375a7-0b0a-40ab-9fe4-4b1d8a7c52ae`
- **脚本路径:** `/home/useradmin/.openclaw/workspace/scripts/alphaxiv-hot.js`
- **长文目录:** `/home/useradmin/.openclaw/workspace/data/paper-reviews/YYYY-MM-DD/`
- **Telegram Chat ID:** `5740650457`
- **Spawn 模板:** 见 TOOLS.md

## 今天已补救

5 篇长文已由主 session spawn sub-agents 完成，已推送。

---

## 2026-03-13 更新：方案 A 已实现！

### 分身完成的工作

✅ **脚本已改好**（`/home/useradmin/.openclaw/workspace/scripts/alphaxiv-hot.js`）：
- 添加了 `spawnAgentForPaper`（304行）- 使用 `openclaw agent --local` spawn
- 添加了 `pushToTelegram`（343行）- 推送长文到 Telegram
- 添加了 `spawnAndWaitForReviews`（405行）- 协调 5 个 agents
- `main` 末尾调用（561行）

✅ **代码质量很好**：
- 错误处理完善
- 超时处理（10分钟）
- Telegram 消息分段（4096 字符限制）

### 2026-03-13 16:57 修复

✅ **解析器工作正常** - 成功解析 20 篇论文
✅ **添加简报推送** - 第 554-565 行，使用 `openclaw message send`
✅ **修复 spawnAgentForPaper** - 改用 `child_process.spawn` 避免 shell 引号问题

### 测试命令

```bash
cd /home/useradmin/.openclaw/workspace
node scripts/alphaxiv-hot.js
```

---

**结论**：完整自动化流程已就绪！明天 9:00 cron 将自动：
1. 获取 AlphaXiv 热门论文
2. 推送简报到 Telegram
3. Spawn 5 个 agents 写长文
4. 逐篇推送长文到 Telegram
