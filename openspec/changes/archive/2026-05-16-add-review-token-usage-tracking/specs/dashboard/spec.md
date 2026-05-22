# dashboard Spec Delta

title: "[规格] Dashboard Token 用量接入"
status: proposed
description: "定义 Dashboard command runner 和 AI CLI adapter 如何接入 token usage 事件。"
specs:
  - dashboard

## ADDED Requirements

### Requirement: Normalized Usage Event

Dashboard SHALL 支持 AI CLI adapter 输出标准化 `usage` event。

#### Scenario: Persist vendor usage event

- **GIVEN** AI CLI adapter 输出 `usage` event
- **AND** 当前 command execution 已绑定 `workflow_id` 和 `vendor`
- **WHEN** command runner 处理该 event
- **THEN** 系统 SHALL 写入 `agent_token_usage`
- **AND** 系统 SHALL 继续把该 event 写入 JSONL stream

#### Scenario: Usage event before workflow link

- **GIVEN** AI CLI adapter 输出 `usage` event
- **AND** 当前 command execution 尚未绑定 `workflow_id`
- **WHEN** command runner 处理该 event
- **THEN** 系统 SHALL 不阻塞 workflow
- **AND** 系统 SHOULD 保留 JSONL event，供后续补偿或诊断使用

#### Scenario: Usage card

- **GIVEN** workflow 已记录 token usage
- **WHEN** 用户打开该 session 的 Dashboard 详情页
- **THEN** Dashboard SHALL 展示 Token Usage 卡片
- **AND** 卡片 SHOULD 展示 total、input、output、cache、reasoning、cost 和按 agent 聚合的摘要
