title: "[提案] 记录完整评审中的 LLM Token 用量"
status: proposed
description: "为 review/map 工作流增加 token 用量明细账和汇总能力，支持按 workflow、agent、模型和供应商追踪一次完整评审的输入、输出、缓存、推理 token 与成本。"
specs:
  - sqlite-state
  - session-management
  - cli
  - dashboard

# [提案] 记录完整评审中的 LLM Token 用量

## 背景

OCR 的 review 流程已经通过 `command_executions` 记录 Tech Lead、Reviewer 和底层 AI CLI 的生命周期信息，也能记录 `vendor_session_id` 与 `resolved_model`。但一次完整评审结束后，目前无法回答以下问题：

- 本次 review 总共消耗了多少 input/output token？
- 哪个 reviewer、哪个模型或哪个 vendor 消耗最高？
- token 统计来自 vendor 原始 usage、人工补录还是估算？
- 后续 Dashboard 如何展示一次评审的成本和用量趋势？

这会让多 reviewer、多模型评审的成本不可见，也不利于团队调优 reviewer 配置。

## 目标

- 新增 token 用量明细账，按 workflow 和 agent session 记录用量。
- 支持 workflow 级别总账，即使无法归因到单个 reviewer 也能记录整次评审总量。
- 支持 `manual`、`vendor_event`、`estimated` 三类来源，保留 vendor 原始 usage JSON 便于审计。
- 提供 CLI 入口用于记录和查看 token 用量。
- 为 Dashboard/vendor adapter 接入标准化 `usage` 事件预留接口。

## 非目标

- 本提案不要求立即完成所有 vendor 的 usage parser。
- 本提案不定义各模型的价格表，也不自动推导费用；`cost_usd` 只记录 vendor 或调用方提供的值。
- 本提案不把 token 用量作为 review verdict 的判断依据。

## 任务拆分

- [x] 1. 新增 OpenSpec change、设计和规格增量。
- [x] 2. 新增 SQLite `agent_token_usage` 表和索引。
- [x] 3. 新增 DB 类型与记录/汇总 helper。
- [x] 4. 新增 `ocr usage record/show` CLI。
- [x] 5. 在 AI CLI normalized event 中新增 `usage` 事件类型。
- [x] 6. Dashboard command runner 在收到 `usage` 事件时写入 token 用量。
- [ ] 7. 接入 Claude Code usage parser。
- [ ] 8. 接入 OpenCode usage parser。
- [ ] 9. Dashboard 展示 Token Usage 卡片。
- [ ] 10. 评审结束时生成 `.ocr/sessions/{id}/usage.md/json` artifact。

## 验收标准

- 初始化数据库后存在 `agent_token_usage` 表。
- `ocr usage record --workflow <id> --vendor <vendor> ...` 可以记录 workflow 级用量。
- `ocr usage record --agent-session <id> ...` 可以自动继承 workflow、vendor、model 信息。
- `ocr usage show --workflow <id> --json` 可以返回总量和按 agent 聚合的用量。
- 如果 vendor 暂未输出 usage，review 流程不能失败。
