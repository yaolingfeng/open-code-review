# session-management Spec Delta

title: "[规格] Token Efficiency Measurement"
status: proposed
description: "为 session token usage 增加 compare 与探索 telemetry，支持检测 graph-enabled review 是否真正减少 token 和盲搜。"
specs:
  - session-management

## ADDED Requirements

### Requirement: Usage Comparison

系统 SHALL 支持比较两个 workflow session 的 token usage，用于评估 graph-enabled review 的 token efficiency。

#### Scenario: Compare usage summaries

- **GIVEN** baseline workflow 与 candidate workflow 均存在 token usage summary
- **WHEN** 系统比较两者
- **THEN** 输出 SHALL 包含 total、input、output、cache read、cache write、reasoning、cost 和 row count 的差异
- **AND** 输出 SHALL 包含百分比变化，除非 baseline 为 0 或数据缺失

#### Scenario: Report caveats for incomplete usage data

- **GIVEN** 某个 workflow 缺少 usage rows、只有 total tokens、或 raw usage 缺少细分字段
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHALL 包含 caveats
- **AND** verdict SHALL 清楚表达比较可信度受限

### Requirement: Exploration Telemetry

系统 SHALL 从 dashboard event journals 中汇总 review exploration 工具调用，用于判断 graph 是否减少盲搜。

#### Scenario: Count broad source exploration calls

- **GIVEN** workflow event JSONL 可用
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHOULD 汇总 `Read`、`Grep`、`Bash` 等 broad exploration tool calls
- **AND** 输出 SHOULD 区分 graph commands 与普通 shell commands

#### Scenario: Count graph-guided exploration calls

- **GIVEN** workflow event JSONL 可用
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHOULD 汇总 `ocr graph search`、`ocr graph query`、`ocr graph impact`、`ocr graph review-context` 等 graph-guided calls
- **AND** 输出 SHOULD 支持对比 baseline 与 candidate 的调用差异

#### Scenario: Telemetry degrades gracefully

- **GIVEN** event JSONL 缺失、不完整或无法解析
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHALL 保留 token comparison
- **AND** 输出 SHALL 标记 telemetry caveat
