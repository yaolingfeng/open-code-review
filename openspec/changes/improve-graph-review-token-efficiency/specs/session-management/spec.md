# session-management Spec Delta

title: "[规格] Token Efficiency Measurement — 行为与质量闭环"
status: proposed
description: "为 session token usage 增加 compare 与 exploration telemetry，支持验证 graph-enabled review 是否真正减少 token 和盲搜，并在证据不足时诚实报告。"
specs:
  - session-management

## ADDED Requirements

### Requirement: Usage Comparison (P0)

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

### Requirement: Exploration Telemetry (P0)

系统 SHALL 从 dashboard event journals 中汇总基础 review exploration 工具调用，用于判断 graph 是否减少盲搜。

#### Scenario: Count broad source exploration calls

- **GIVEN** workflow event JSONL 可用
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHALL 汇总 `Read`、`Grep`、`Bash` 等 broad exploration tool calls
- **AND** 输出 SHALL 区分 graph commands 与普通 shell commands

#### Scenario: Count graph-guided exploration calls

- **GIVEN** workflow event JSONL 可用
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHALL 汇总 `ocr graph search`、`ocr graph query`、`ocr graph impact`、`ocr graph review-context` 等 graph-guided calls
- **AND** 输出 SHALL 支持对比 baseline 与 candidate 的调用差异

#### Scenario: Telemetry degrades gracefully

- **GIVEN** event JSONL 缺失、不完整或无法解析
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 SHALL 保留 token comparison
- **AND** 输出 SHALL 标记 telemetry caveat

### Requirement: Enhanced Exploration Telemetry (P1)

系统 SHALL 在基础调用计数之上支持更丰富的 exploration telemetry，用于更准确判断 reviewer 是否改变了调查路径。

#### Scenario: Add richer exploration signals

- **GIVEN** workflow event journals 可用且包含足够细节
- **WHEN** 系统生成 usage comparison
- **THEN** 输出 MAY 包含更细粒度的 broad exploration 与 graph-guided exploration 指标
- **AND** 这些增强指标 SHALL NOT 阻塞 P0 usage comparison 输出

### Requirement: Token Efficiency Verdict (P0)

Usage comparison SHALL produce a structured verdict that reflects both cost and behavioral evidence, and SHALL NOT claim success when evidence is insufficient.

#### Scenario: Verdict reflects token and exploration changes together

- **GIVEN** baseline 与 candidate 的 token comparison 和 exploration telemetry 均可用
- **WHEN** system produces usage comparison
- **THEN** verdict SHALL reflect whether total tokens、cost 或 exploration calls improved
- **AND** verdict SHALL highlight cases where input tokens rose but total tokens fell due to reduced exploration

#### Scenario: Verdict is conservative when evidence is incomplete

- **GIVEN** usage comparison has missing rows、only total tokens available、或 telemetry unavailable
- **WHEN** system produces usage comparison
- **THEN** verdict SHALL state that evidence is insufficient to confirm token efficiency improvement
- **AND** verdict SHALL NOT overclaim success based on partial data

### Requirement: Graph Token Efficiency Benchmark (P1)

系统 SHALL 支持将多组 usage comparison 聚合为可重复运行的 graph token efficiency benchmark，用于判断“更少 token、更少盲搜、质量不下降”是否同时成立。

#### Scenario: Compute median benchmark metrics

- **GIVEN** 3-5 组 baseline/candidate workflow pair
- **WHEN** 系统生成 benchmark
- **THEN** 输出 SHALL 包含 median total token delta
- **AND** 输出 SHALL 包含 median Read/Grep/Bash broad exploration delta
- **AND** 输出 SHALL 保留每组 pair 的 caveats，便于追溯异常样本

#### Scenario: Enforce token and exploration thresholds

- **GIVEN** benchmark 配置了 total token reduction 和 broad exploration reduction 阈值
- **WHEN** median 指标未达到阈值
- **THEN** verdict SHALL NOT claim benchmark passed
- **AND** 输出 SHALL 说明未达到的具体阈值

#### Scenario: Require quality gate for success

- **GIVEN** median token 与 broad exploration 指标均改善
- **WHEN** review quality gate 未标记为通过
- **THEN** benchmark verdict SHALL remain inconclusive
- **AND** 输出 SHALL 包含质量抽查清单，提醒人工确认 blocker/should-fix finding、证据引用和覆盖范围未退化
