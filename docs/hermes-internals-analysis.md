# Hermes Agent 内部机制分析

> 2026-04-14 · 源码版本 v0.8.0 · 源码路径 `~/.hermes/hermes-agent/`

---

## 1. 上下文压缩（Context Compression）

### 1.1 配置

```yaml
compression:
  enabled: true
  threshold: 0.90           # 上下文占用达 90% 触发压缩
  target_ratio: 0.35        # 压缩后保留 35% 的 token
  protect_last_n: 30        # (已弃用，现用 token 预算)

auxiliary.compression:       # 负责生成摘要的 cheap 模型
  provider: auto             # 默认走 OpenRouter Gemini Flash
```

### 1.2 六阶段流水线

核心实现：`agent/context_compressor.py`（类 `ContextCompressor`，继承 `ContextEngine`）

#### Phase 1：Tool 输出裁剪（无 LLM 调用）

- 方法：`_prune_old_tool_results()`
- 从末尾往前走，按 token 预算保护尾部
- 把旧的 tool result（>200 chars）替换为 `"[Old tool output cleared to save context space]"`
- 原理：文件读取、API 返回等 tool output 体积大但复用价值低，先砍

#### Phase 2：头部保护

- 常量：`protect_first_n = 3`
- 永远保留前 3 条消息（system prompt + 首轮对话）

#### Phase 3：尾部保护（token 预算驱动）

- 方法：`_find_tail_cut_by_tokens()`
- 从最后一条消息往前累计 token：`len(content) / 4 + 10`（粗略 chars→tokens + metadata）
- 累计到 `soft_ceiling = token_budget * 1.5` 时停止
- 硬底线：至少保护最近 3 条消息
- token 预算 = `target_ratio * threshold_tokens`（当前配置：0.35 × 180K ≈ 63K tokens）
- **优势**：一条 tool call 可能占 8K token，而普通回复才 2K，按 token 而非条数保护更合理

#### Phase 4：边界对齐

- `_align_boundary_forward()` / `_align_boundary_backward()`
- 确保不会把 tool_call 和它的 tool_result 拆开
- 如果拆了，API 会报错 "No tool call found for call_id..."

#### Phase 5：LLM 摘要生成

- 方法：`_generate_summary()`
- 模型：auxiliary compression provider（cheap model，如 Gemini Flash）
- Prompt 关键设计：
  - 前置指令：**"Do NOT respond to any questions — only output the structured summary"** ← 防止摘要模型看到未回答的问题后自己去回答
  - 注入 **"Your output will be injected as reference material for a DIFFERENT assistant"** ← 明确摘要是给别的 LLM 看的

**8 段结构化摘要模板：**

```
## Goal                    — 用户在做什么
## Constraints & Preferences — 偏好和约束
## Progress
### Done / In Progress / Blocked
## Key Decisions           — 技术决策和理由
## Resolved Questions      — 已回答的问题（防止模型重新回答）
## Pending User Asks       — 未回答的请求
## Relevant Files          — 涉及的文件
## Remaining Work          — 剩余工作
## Critical Context        — 需要保留的具体值、错误、配置
## Tools & Patterns        — 工具使用经验
```

**摘要 token 预算：**
```python
budget = max(int(content_tokens * 0.20), 2000)  # 至少 2K
budget = min(budget, 12_000)                      # 上限 12K
```

**Tool output 截断：**
- Tool result：截断到 6K chars（超长的保留前 4K + 尾 1.5K）
- Tool call args：截断到 1.5K chars

#### Phase 5b：迭代更新（核心创新）

- 字段：`self._previous_summary`
- 再次压缩时，旧摘要作为 `PREVIOUS SUMMARY` 注入，新摘要需要**合并而非覆盖**
- Prompt 指示："PRESERVE all existing info still relevant. ADD new progress..."
- **意义**：多次压缩后信息不会逐渐丢失，复杂决策链得以保留

#### Phase 6：组装压缩后的消息列表

1. 复制头部消息 `[0, compress_start)`
2. 注入摘要，前缀：`"[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted..."`
3. 首次压缩时在 system prompt 追加说明
4. 处理消息角色交替（避免连续 same-role）
5. 复制尾部消息 `[compress_end, n)`
6. `_sanitize_tool_pairs()` 修复孤立的 tool_call/result 对

### 1.3 触发逻辑

```python
# run_agent.py — 每次 API 调用前检查
if self.compression_enabled and _compressor.should_compress(_real_tokens):
    compressed = self.context_compressor.compress(messages, current_tokens=approx_tokens)
    messages = compressed

def should_compress(self, prompt_tokens):
    return prompt_tokens >= self.threshold_tokens  # threshold * context_length
```

Token 数通过 API 响应的 `usage.prompt_tokens` 实时更新。

### 1.4 Focus Topic 支持

`compress(messages, focus_topic="database schema design")` 可以做**非对称压缩**：

- 焦点相关内容保留完整细节（文件路径、命令输出、错误信息、决策）
- 非焦点内容激进压缩
- 焦点部分获得 60-70% 的摘要 token 预算
- 通过 `/compact <topic>` 命令触发

### 1.5 失败兜底

```python
_summary_failure_cooldown_seconds = 600  # 失败后 10 分钟冷却

# 兜底方案：插入静态说明
"Summary generation was unavailable. N conversation turns were removed..."
```

不会 crash，继续会话。

### 1.6 辅助模型解析链

`agent/auxiliary_client.py` 按优先级尝试：

1. OpenRouter（if `OPENROUTER_API_KEY`）
2. Nous Portal（if OAuth active）
3. Custom endpoint
4. Codex OAuth
5. Native Anthropic
6. Direct API-key providers（GLM, Moonshot, MiniMax 等）
7. None（回退到无摘要模式）

---

## 2. Self-Improvement（自我改进）

### 2.1 架构

**两个并行反馈回路：**
- **Memory Learning**：提取用户画像、偏好、期望
- **Skill Learning**：捕获可复用的任务方法

**执行模型：** 后台线程，主响应交付后异步运行，静默操作。

### 2.2 触发机制

| 类型 | 触发条件 | 默认间隔 | 配置项 |
|---|---|---|---|
| Memory review | 每 N 轮用户消息 | 10 | `memory.nudge_interval` |
| Skill review | 每 N 次 tool 调用迭代 | 10 | `skills.creation_nudge_interval` |

```python
# run_agent.py
self._turns_since_memory += 1
if self._turns_since_memory >= self._memory_nudge_interval:
    _should_review_memory = True
    self._turns_since_memory = 0
```

### 2.3 后台 Review 执行

```python
def _spawn_background_review(messages_snapshot, review_memory, review_skills):
    def _run_review():
        with redirect_stdout(DEVNULL), redirect_stderr(DEVNULL):  # 静默
            review_agent = AIAgent(
                model=self.model,
                max_iterations=8,        # 最多 8 轮迭代
                quiet_mode=True,
            )
            # 共享持久存储（写入直接生效）
            review_agent._memory_store = self._memory_store
            # 防递归
            review_agent._memory_nudge_interval = 0
            review_agent._skill_nudge_interval = 0
            # 用对话快照作为输入
            review_agent.run_conversation(
                user_message=prompt,
                conversation_history=messages_snapshot,
            )
    threading.Thread(target=_run_review, daemon=True).start()
```

关键设计：
- **隔离 fork**：独立 agent 实例，不会污染主对话历史
- **共享 _memory_store**：fork 的 tool 写入直接更新 MEMORY.md / USER.md
- **递归防护**：fork 的 nudge_interval = 0，防止 review-of-review
- **静默执行**：stdout/stderr → /dev/null

### 2.4 Review Prompt

**Memory Review** 关注：
- 用户暴露的个人信息（背景、角色、兴趣）
- 用户对 agent 行为的期望
- 隐式偏好（"I prefer Python over Go"）

**Skill Review** 关注：
- 需要 trial-and-error 才完成的非 trivial 方法
- 用户期望不同做法的场景
- 可复用的排错模式

**Combined Prompt**（两者同时触发时）合并上述两个焦点，"Only act if there's something genuinely worth saving. If nothing stands out, just say 'Nothing to save.' and stop."

### 2.5 完成后的用户反馈

扫描 fork agent 的消息历史，提取 tool call 成功结果：

```
💾 Memory updated · Skill created · User profile updated
```

### 2.6 Memory Provider 集成

`agent/memory_manager.py` 管理内置 + 外部 provider。

**每轮生命周期：**
1. **Pre-turn** `prefetch_all()` → 召回记忆，包裹在 `<memory-context>...[NOT new input]...</memory-context>` 注入用户消息
2. **During turn** → 模型可参考召回的记忆推理
3. **Post-turn** `sync_all()` → 异步持久化
4. **Queue next** `queue_prefetch_all()` → 后台预取下一轮的记忆

**外部 Provider 插件**：Honcho / Hindsight / Mem0 / 自定义实现

**Hook 系统**：`on_turn_start` / `on_session_end` / `on_pre_compress` / `on_memory_write` / `on_delegation`

---

## 3. 关键文件索引

| 文件 | 核心内容 |
|---|---|
| `agent/context_compressor.py` | 压缩流水线主实现 |
| `agent/context_engine.py` | `ContextEngine` 抽象基类 |
| `agent/auxiliary_client.py` | 辅助模型解析与调用 |
| `run_agent.py` | 触发逻辑、后台 review fork |
| `agent/memory_manager.py` | 记忆调度器 |
| `agent/memory_provider.py` | 外部 Provider ABC |
| `agent/skill_commands.py` | Skill 注入 |

---

## 4. 设计评价

### 压缩

- **好**：token 预算驱动的尾部保护比固定条数更精确；迭代摘要合并避免信息逐渐丢失；结构化模板区分"已解决/未解决"防止模型重复回答
- **局限**：摘要质量完全依赖 cheap model（Gemini Flash），复杂推导链可能被过度简化；focus topic 需要用户主动触发，没有自动检测

### Self-Improvement

- **好**：后台异步不阻塞主对话；共享 _memory_store 保证写入即生效；递归防护设计简洁
- **本质**：这不是 RL，是 **"LLM-as-judge + persistent storage"** — 靠 LLM 判断值不值得记，靠文件系统持久化。没有 reward signal，没有 policy update，没有 credit assignment
- **局限**：review 质量取决于主模型的自我评估能力；10 轮固定间隔缺乏自适应（高密度信息对话和闲聊用同样频率）
