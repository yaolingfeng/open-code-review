# review-orchestration Spec Delta

title: "[规格] Summary-first 图谱 Review 编排"
status: proposed
description: "调整 review workflow 的图谱消费策略，默认注入 minimal context，按需获取 review-context snippets，减少 token 与盲搜。"
specs:
  - review-orchestration

## ADDED Requirements

### Requirement: Summary-First Graph Injection

Review orchestration SHALL use minimal graph context as the default graph injection surface.

#### Scenario: Tech Lead receives minimal graph context

- **GIVEN** graph context or graph review analysis exists for a review session
- **WHEN** Tech Lead performs analysis
- **THEN** workflow SHALL inject minimal graph context summary, top priorities, key warnings, and bounded next tool suggestions
- **AND** workflow SHALL NOT inject complete graph-context markdown or full review-analysis drilldown by default

#### Scenario: Reviewer receives graph exploration guidance

- **GIVEN** reviewer tasks are spawned
- **WHEN** reviewer prompt is constructed
- **THEN** prompt SHALL include minimal graph context or a degraded warning
- **AND** prompt SHOULD instruct reviewer to use next tool suggestions and bounded graph review-context before broad source reads

#### Scenario: Full graph detail remains on demand

- **GIVEN** reviewer needs deeper graph information
- **WHEN** reviewer follows graph suggestions
- **THEN** reviewer MAY call graph query、impact、search 或 review-context commands
- **AND** workflow SHALL treat these outputs as investigation context

### Requirement: Source-Grounded Findings

Review orchestration SHALL preserve source-grounded review quality while reducing token usage.

#### Scenario: Graph-only finding is not accepted

- **GIVEN** graph output flags a risk、test gap、affected flow 或 coupling hotspot
- **WHEN** reviewer writes a finding
- **THEN** finding SHALL cite source code、diff、test、runtime behavior 或等价证据
- **AND** graph signal alone SHALL NOT be sufficient evidence

#### Scenario: Token reduction must not come from shallow review

- **WHEN** graph-enabled review is evaluated for token efficiency
- **THEN** evaluation SHOULD include review quality signals such as blocker/should-fix counts, evidence references, and human spot-check notes
- **AND** token reduction SHALL NOT be considered successful if key findings are missed due to reduced investigation depth

### Requirement: Guided Exploration Before Broad Reads

Review orchestration SHALL reduce blind search by preferring graph-guided exploration.

#### Scenario: Reviewer follows bounded graph path

- **GIVEN** next tool suggestions are present
- **WHEN** reviewer needs more context
- **THEN** reviewer SHOULD prefer suggested graph query、impact、tests_for 或 review-context commands
- **AND** reviewer SHOULD use broad `Read`、`Grep` 或 `Bash` only when graph output is insufficient, stale, missing, or unsupported
