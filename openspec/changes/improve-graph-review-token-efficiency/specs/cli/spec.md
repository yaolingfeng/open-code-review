# cli Spec Delta

title: "[规格] 图谱 Token 效率 CLI"
status: proposed
description: "新增 minimal-context、review-context 和 usage compare CLI，用于减少 graph-enabled review 的 token 与盲搜。"
specs:
  - cli

## ADDED Requirements

### Requirement: Minimal Context CLI

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

### Requirement: Review Context CLI

系统 SHALL 提供 `ocr graph review-context` 命令。

#### Scenario: Print bounded source snippets

- **GIVEN** 用户运行 `ocr graph review-context --workflow review --files src/a.ts --json`
- **WHEN** graph DB 和源码文件可用
- **THEN** CLI SHALL 输出 `GraphReviewContext`
- **AND** snippets SHALL 包含 file path、line range、reason 和源码文本
- **AND** 输出 SHALL 包含 budget 与 truncation metadata

#### Scenario: Review context supports budget flags

- **WHEN** 用户运行 `ocr graph review-context`
- **THEN** CLI SHALL 支持 max files、max snippets、max lines per snippet、max chars 或等价预算参数
- **AND** 超出预算时 SHALL 标记 truncated

### Requirement: Usage Compare CLI

系统 SHALL 提供 `ocr usage compare` 命令，用于比较 baseline workflow 与 candidate workflow 的 token 使用差异。

#### Scenario: Compare two workflow usage summaries

- **GIVEN** 两个 workflow 都有 usage rows
- **WHEN** 用户运行 `ocr usage compare --baseline <id-a> --candidate <id-b> --json`
- **THEN** CLI SHALL 输出 baseline、candidate、delta 和 verdict
- **AND** delta SHALL 包含 total/input/output/cache/reasoning/cost 的绝对变化和百分比变化

#### Scenario: Compare tool-call exploration telemetry

- **GIVEN** 两个 workflow 的 event JSONL 可用
- **WHEN** 用户运行 `ocr usage compare`
- **THEN** 输出 SHOULD 包含 `Read`、`Grep`、`Bash`、`ocr graph` 调用数对比
- **AND** 缺失 event JSONL 时 SHALL 输出 caveat，而不是失败

#### Scenario: Compare handles incomplete usage data

- **GIVEN** usage rows 缺失、只有 total tokens，或 provider 未返回 cost
- **WHEN** 用户运行 `ocr usage compare`
- **THEN** 输出 SHALL 包含 caveats
- **AND** verdict SHALL 避免在证据不足时宣称 token efficiency 已改善
