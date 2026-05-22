# dashboard Spec Delta

title: "[规格] 图谱 Token 效率 Dashboard"
status: proposed
description: "在 Dashboard 中展示 minimal graph context、bounded review context 和 usage comparison，帮助用户理解 graph-enabled review 的 token 与质量收益。"
specs:
  - dashboard

## ADDED Requirements

### Requirement: Minimal Graph Context Panel

Dashboard SHALL surface minimal graph context separately from full graph artifacts.

#### Scenario: Display minimal graph context

- **GIVEN** minimal graph context exists or can be generated for a session
- **WHEN** 用户打开 review 或 map session
- **THEN** Dashboard SHALL 展示 summary、top priorities、warnings 和 next tool suggestions
- **AND** Dashboard SHALL NOT require loading full graph-context markdown to show this summary

#### Scenario: Display degraded minimal context

- **GIVEN** graph status is missing、stale、degraded 或 error
- **WHEN** Dashboard renders minimal graph context
- **THEN** Dashboard SHALL show a readable status and remediation
- **AND** Dashboard SHALL NOT silently trigger graph build or update

### Requirement: Review Context Snippet Drilldown

Dashboard SHALL allow on-demand review-context snippet retrieval.

#### Scenario: Fetch bounded snippets on demand

- **GIVEN** user asks for graph-guided source context
- **WHEN** Dashboard requests review-context
- **THEN** server SHALL return bounded snippets with file path、line range、reason and truncation metadata
- **AND** Dashboard SHALL show warnings for omitted or unsupported files

### Requirement: Usage Comparison UI

Dashboard SHALL expose usage comparison results for graph-enabled review experiments.

#### Scenario: Show comparison summary

- **GIVEN** user selects baseline and candidate sessions
- **WHEN** Dashboard requests usage comparison
- **THEN** Dashboard SHOULD show token deltas、percentage changes、tool-call telemetry and caveats
- **AND** Dashboard SHOULD avoid claiming token reduction when usage data is incomplete

#### Scenario: Show total-only caveat

- **GIVEN** usage rows contain total tokens but no input/output details
- **WHEN** Dashboard renders usage comparison
- **THEN** Dashboard SHALL show that provider usage details were incomplete
- **AND** Dashboard SHALL keep the comparison available with reduced confidence
