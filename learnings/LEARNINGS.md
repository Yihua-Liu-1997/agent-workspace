# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice
**Areas**: frontend | backend | infra | tests | docs | config
**Statuses**: pending | in_progress | resolved | wont_fix | promoted | promoted_to_skill

## Status Definitions

| Status | Meaning |
|--------|---------|
| `pending` | Not yet addressed |
| `in_progress` | Actively being worked on |
| `resolved` | Issue fixed or knowledge integrated |
| `wont_fix` | Decided not to address (reason in Resolution) |
| `promoted` | Elevated to CLAUDE.md, AGENTS.md, or copilot-instructions.md |
| `promoted_to_skill` | Extracted as a reusable skill |

## Skill Extraction Fields

When a learning is promoted to a skill, add these fields:

```markdown
**Status**: promoted_to_skill
**Skill-Path**: skills/skill-name
```

Example:
```markdown
## [LRN-20250115-001] best_practice

**Logged**: 2025-01-15T10:00:00Z
**Priority**: high
**Status**: promoted_to_skill
**Skill-Path**: skills/docker-m1-fixes
**Area**: infra

### Summary
Docker build fails on Apple Silicon due to platform mismatch
...
```

---

## [LRN-20260305-002] insight

**Logged**: 2026-03-05T21:45:00+08:00
**Priority**: high
**Status**: pending
**Area**: config

### Summary
论文推荐的核心痛点是"筛选重要论文"，而不是"获取所有论文"

### Details
用户想要每天看 AI 论文，但 arXiv 每天有 100+ 篇新论文。真正有价值的可能只有 3-5 篇。

**解决方案**：paper-recommendation 技能
- 并行子代理阅读和评分（1-5分）
- 多维度评估：机构、贡献、实验、结论
- 自动筛选评分 >= 4 且推荐的论文
- 生成标准化简报（包含中文翻译、实验结果等）

**工作流程**：
1. fetch_papers.py 获取论文
2. review_papers.py 生成子代理任务
3. Agent 用 sessions_spawn 调用子代理
4. 子代理阅读、评分、返回 JSON
5. Agent 筛选、生成简报、推送

### Suggested Action
安装 paper-recommendation 技能，配置每日自动推送。

### Metadata
- Source: conversation
- Related Files: paper-recommendation skill
- Tags: papers, recommendation, subagents, parallel-processing
- Pattern-Key: paper.recommendation_workflow

---

## [LRN-20260305-003] best_practice

**Logged**: 2026-03-05T21:45:00+08:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
子代理并行处理是批量任务的优秀模式

### Details
sessions_spawn 可以同时开多个子代理，每个独立执行任务。

**适用场景**：
- 批量阅读论文
- 并行评分任务
- 独立数据处理

**优点**：
- 速度快（并行执行）
- 互不干扰（独立评分）
- 可追溯（每个任务有结果）

**使用方法**：
```python
for task in tasks:
    result = sessions_spawn(
        task=task['task'],
        label=task['label']
    )
```

### Suggested Action
在需要批量处理时优先考虑子代理并行。

### Metadata
- Source: conversation
- Tags: subagents, parallel, performance, scalability
- Pattern-Key: subagent.parallel_pattern

---
## [LRN-20260305-001] best_practice

**Logged**: 2026-03-05T19:52:00+08:00
**Priority**: high
**Status**: pending
**Area**: config

### Summary
ClawHub CLI 需要通过 NODE_OPTIONS 使用代理补丁才能连接 ClawHub 服务器

### Details
直接运行 `clawhub search` 或 `clawhub explore` 会超时。标准的环境变量 `HTTP_PROXY` 和 `HTTPS_PROXY` 不起作用。

必须使用：
```bash
NODE_OPTIONS='--require /home/useradmin/fetch-patch.cjs' clawhub explore
```

这个补丁会通过 127.0.0.1:7897 代理建立 HTTPS 连接。

### Suggested Action
将这个配置添加到 TOOLS.md 的 ClawHub 部分，方便以后参考。

### Metadata
- Source: conversation
- Related Files: /home/useradmin/fetch-patch.cjs, /home/useradmin/.openclaw/workspace/TOOLS.md
- Tags: clawhub, proxy, networking, cli
- Pattern-Key: clawhub.proxy_requirement
- Recurrence-Count: 1
- First-Seen: 2026-03-05
- Last-Seen: 2026-03-05

---
