# cli Spec Delta

title: "[规格] Graph Token 效率 CLI — 默认导航层"
status: proposed
description: "新增 minimal-context、structured suggestions 和 usage compare CLI，用于让 graph 成为 review 默认入口，并提供可量化的 token/行为对比。"
specs:
  - cli

## ADDED Requirements

### Requirement: Minimal Context CLI (P0)

系统 SHALL 提供 `ocr graph minimal-context` 命令。

#### Scenario: Print minimal context as JSON

- **GIVEN** 用户运行 `ocr graph minimal-context --workflow review --files src/a.ts --json`
- **WHEN** graph DB 可用
- **THEN** CLI SHALL 输出结构化 `GraphMinimalContext`
- **AND** 输出 SHALL 包含 bounded summary、top priorities、warnings 和 next tool suggestions

#### Scenario: Minimal context handles missing graph

- **GIVEN** graph DB 不存在
- **WHEN** 用户运行 `ocr graph minimal-context --workflow review --files src/a.ts --json`
- **THEN** CLI SHALL 输出 `missing` 或等价 status
- **AND** CLI SHALL 输出可读 warning
- **AND** 命令 SHALL NOT 以未处理异常失败

### Requirement: Usage Compare CLI (P0)

系统 SHALL 提供 `ocr usage compare` 命令，用于比较 baseline workflow 与 candidate workflow 的 token 使用和探索行为差异。

#### Scenario: Compare two workflow usage summaries

- **GIVEN** 两个 workflow 都有 usage rows
- **WHEN** 用户运行 `ocr usage compare --baseline <id-a> --candidate <id-b> --json`
- **THEN** CLI SHALL 输出 baseline、candidate、delta 和 verdict
- **AND** delta SHALL 包含 total/input/output/cache/reasoning/cost/row_count 的绝对变化和百分比变化

#### Scenario: Compare tool-call exploration telemetry

- **GIVEN** 两个 workflow 的 event JSONL 可用
- **WHEN** 用户运行 `ocr usage compare`
- **THEN** 输出 SHALL 包含 `Read`、`Grep`、`Bash` 和 `ocr graph *` 调用数对比
- **AND** 缺失 event JSONL 时 SHALL 输出 caveat，而不是失败

#### Scenario: Compare handles incomplete usage data

- **GIVEN** usage rows 缺失、只有 total tokens，或 provider 未返回 cost
- **WHEN** 用户运行 `ocr usage compare`
- **THEN** 输出 SHALL 包含 caveats
- **AND** verdict SHALL 避免在证据不足时宣称 token efficiency 已改善

### Requirement: Usage Benchmark CLI (P1)

系统 SHALL 提供 `ocr usage benchmark` 命令，用于将 3-5 组 baseline/candidate usage comparison 聚合为可重复的 graph token efficiency benchmark。

#### Scenario: Aggregate paired usage comparisons

- **GIVEN** 用户提供多组 `--pair <baseline>:<candidate>`
- **WHEN** 用户运行 `ocr usage benchmark --json`
- **THEN** CLI SHALL 输出每组 comparison、total token 中位数变化、Read/Grep/Bash broad exploration 中位数变化和 graph call 变化
- **AND** 输出 SHALL 包含阈值、quality gate 状态、verdict 和 caveats

#### Scenario: Benchmark remains conservative without quality gate

- **GIVEN** paired comparisons 的 token 和 broad exploration 均下降
- **WHEN** 用户未显式标记质量门禁通过
- **THEN** verdict SHALL NOT claim benchmark passed
- **AND** 输出 SHALL 提醒 token 降低不能单独视为 review 质量不下降

#### Scenario: Benchmark documents incomplete evidence

- **GIVEN** 某组 pair 存在 missing usage rows、total-only usage 或 event telemetry 缺失
- **WHEN** 用户运行 `ocr usage benchmark`
- **THEN** 输出 SHALL 汇总对应 caveats
- **AND** verdict SHALL 保持 inconclusive

### Requirement: Review Context CLI (P1)

系统 SHALL 提供 `ocr graph review-context` 命令，支持 changed symbols 和 top impacted symbols 的源码片段提取。

#### Scenario: Print bounded source snippets

- **GIVEN** 用户运行 `ocr graph review-context --workflow review --files src/a.ts --json`
- **WHEN** graph DB 和源码文件可用
- **THEN** CLI SHALL 输出 `GraphReviewContext`
- **AND** snippets SHALL 包含 file path、line range、reason 和源码文本
- **AND** 输出 SHALL 包含 budget 与 truncation metadata

#### Scenario: Review context supports budget flags

- **WHEN** 用户运行 `ocr graph review-context`
- **THEN** CLI SHALL 支持 max snippets 和 max lines per snippet 参数
- **AND** 超出预算时 SHALL 标记 truncated
