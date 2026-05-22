# sqlite-state Spec Delta

title: "[规格] SQLite Token 用量明细账"
status: proposed
description: "为 OCR SQLite 状态库增加 token 用量明细账，支持 workflow 和 agent 级别汇总。"
specs:
  - sqlite-state

## ADDED Requirements

### Requirement: Token Usage Ledger

系统 SHALL 在 `.ocr/data/ocr.db` 中维护 `agent_token_usage` 表，用于记录 review/map workflow 中 LLM token 用量。

#### Scenario: Token usage table exists

- **GIVEN** OCR 数据库完成初始化
- **WHEN** 检查 SQLite schema
- **THEN** 数据库 SHALL 包含 `agent_token_usage` 表
- **AND** 表 SHALL 至少包含 `workflow_id`、`agent_session_id`、`vendor`、`vendor_session_id`、`model`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、`reasoning_tokens`、`total_tokens`、`cost_usd`、`source`、`raw_usage_json`、`recorded_at`

#### Scenario: Workflow-level usage

- **GIVEN** vendor 只能提供整次 workflow 的 usage
- **WHEN** 系统记录 token 用量
- **THEN** `agent_session_id` MAY 为空
- **AND** `workflow_id` MUST 被记录

#### Scenario: Agent-level usage

- **GIVEN** token usage 可以归因到某个 reviewer agent
- **WHEN** 系统记录 token 用量
- **THEN** `agent_session_id` SHALL 使用 `command_executions.uid`
- **AND** 系统 SHOULD 从该 execution 继承 `workflow_id`、`vendor` 和 `model`

#### Scenario: Usage source

- **GIVEN** token usage 被记录
- **WHEN** 查看 `source`
- **THEN** `source` SHALL 为 `manual`、`vendor_event` 或 `estimated` 之一
