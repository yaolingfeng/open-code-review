title: "[设计] LLM Token 用量记录"
status: proposed
description: "定义 OCR 记录一次完整评审 token 用量的数据模型、CLI 入口和 vendor 事件接入方式。"
specs:
  - sqlite-state
  - session-management
  - cli
  - dashboard

# [设计] LLM Token 用量记录

## 核心决策

### D-1：使用独立明细账表

**Decision**：新增 `agent_token_usage` 表，而不是把 token 字段直接加到 `command_executions`。

**Rationale**：一次 agent session 可能产生多段 usage，例如中途 checkpoint、多个 vendor summary 或人工补录。独立明细账能保留来源、原始 JSON 和多次记录，避免覆盖生命周期字段。

### D-2：关联到 `command_executions.uid`

**Decision**：`agent_session_id` 指向 OCR 暴露给 workflow 的 agent session id，也就是 `command_executions.uid`。

**Rationale**：当前 `agent_sessions` 已经从物理表合并为 `command_executions` 的逻辑视图。继续使用 `agent_session_id` 这个概念可以保持 workflow 和 Dashboard 语义稳定，同时不恢复已退役的表。

### D-3：允许 workflow 级总账

**Decision**：`agent_session_id` 可为空，但 `workflow_id` 必填。

**Rationale**：部分 AI CLI 只在父进程结束时输出总 usage，无法可靠拆分到每个 reviewer。workflow 级记录保证完整评审仍然有总用量，不阻塞后续更细粒度归因。

### D-4：来源必须显式

**Decision**：`source` 只能是 `manual`、`vendor_event`、`estimated`。

**Rationale**：token 用量会被用于成本和配置调优，必须区分真实 vendor 输出、人工补录和估算，避免误读。

## 数据模型

`agent_token_usage` 记录以下关键字段：

- `workflow_id`：所属 review/map workflow。
- `agent_session_id`：可选，关联 reviewer/Tech Lead agent。
- `vendor`、`vendor_session_id`、`model`：供应商和模型归因信息。
- `input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`reasoning_tokens`、`total_tokens`：token 细分。
- `cost_usd`：可选成本。
- `source`：用量来源。
- `raw_usage_json`：vendor 原始 usage 载荷。

## 事件接入

AI CLI adapter 的标准事件中新增：

```ts
{ type: "usage", inputTokens, outputTokens, totalTokens, costUsd, raw }
```

Dashboard command runner 收到该事件后，如果当前 execution 已经绑定 `workflow_id` 和 `vendor`，则写入 `agent_token_usage`；如果 workflow 尚未绑定，则至少保留 JSONL event，后续可通过事件重放补偿。

## 降级策略

- vendor 不输出 usage：review 正常完成，usage 为空。
- usage 无法归因到单个 reviewer：记录 workflow 级总账。
- cost 不可得：记录 token，不记录 cost。
- raw JSON 非法：拒绝写入该行，避免审计数据不可解析。
