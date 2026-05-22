# session-management Spec Delta

title: "[规格] Session Token 用量 Artifact"
status: proposed
description: "定义完整评审 session 中 token 用量记录与 artifact 的行为。"
specs:
  - session-management

## ADDED Requirements

### Requirement: Review Token Usage Summary

系统 SHALL 支持按 workflow 汇总一次 review/map 的 LLM token 用量。

#### Scenario: Summarize complete review usage

- **GIVEN** 一个 review workflow 已记录多条 token usage
- **WHEN** 系统汇总该 workflow
- **THEN** 汇总 SHALL 包含 input、output、cache read、cache write、reasoning、total token
- **AND** 汇总 SHOULD 包含按 agent/model 分组的 token 总量
- **AND** 如果成本已记录，汇总 SHOULD 包含 `cost_usd`

#### Scenario: Missing usage does not block review

- **GIVEN** vendor 未输出 token usage
- **WHEN** review workflow 进入 synthesis 或 complete
- **THEN** workflow SHALL 正常完成
- **AND** 系统 MAY 显示 token usage unavailable

#### Scenario: Usage artifacts

- **GIVEN** review workflow 完成
- **WHEN** presentation 阶段运行 token usage export
- **THEN** `.ocr/sessions/{id}/usage.md` SHALL 存在
- **AND** `.ocr/sessions/{id}/usage.json` SHALL 存在
- **AND** usage 不可用时 artifact SHALL 记录空汇总而不是阻塞 workflow
