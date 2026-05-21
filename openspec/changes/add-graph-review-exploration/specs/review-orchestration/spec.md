## ADDED Requirements

### Requirement: Graph Review Analysis Consumption

The Tech Lead and reviewer workflow SHALL be able to consume graph review analysis
in addition to raw graph context, while preserving source-based review judgment.

#### Scenario: Tech Lead consumes graph review analysis

- **GIVEN** graph review analysis exists for a review session
- **WHEN** the Tech Lead performs investigation and reviewer guidance
- **THEN** the Tech Lead SHALL consider graph-native priorities, explainable
  hints, and module or architecture summaries
- **AND** SHALL still corroborate findings with source code, diff, and other
  investigation

#### Scenario: Reviewer consumes graph review analysis

- **GIVEN** reviewer tasks are spawned for a session with graph review analysis
- **WHEN** a reviewer explores the changed set
- **THEN** the reviewer MAY use graph review analysis to choose review order,
  focus areas, or follow-up graph queries
- **AND** SHALL NOT treat graph analysis output as sufficient evidence for a
  finding by itself

#### Scenario: Workflow injects summary-first graph review analysis

- **GIVEN** graph review analysis exists for a review session
- **WHEN** Tech Lead 或 reviewer context 被注入
- **THEN** 默认注入内容 SHALL 以 summary、priorities、review order 和关键 hints
  为主
- **AND** SHALL NOT 默认注入完整 search 结果或完整 analysis drilldown payload
- **AND** deeper graph detail SHALL 通过按需 query 获取

#### Scenario: Review proceeds when graph review analysis is unavailable

- **GIVEN** graph review analysis is missing, stale, degraded, or failed
- **WHEN** the review workflow executes
- **THEN** the workflow SHALL proceed using existing context discovery and graph
  context behavior
- **AND** any graph review analysis limitation SHALL be surfaced as context,
  not as a workflow blocker

#### Scenario: Review workflow graph consumption is read-only

- **GIVEN** review orchestration consumes graph context or graph review analysis
- **WHEN** the graph database is stale, partially unsupported, or unavailable
- **THEN** the workflow SHALL NOT trigger `updateGraph`, full build, search-index rebuild,
  flow rebuild, or expensive module summary computation as a side effect
- **AND** stale or degraded status SHALL be surfaced as warnings or context notes

#### Scenario: Graph refresh requires explicit user or CLI action

- **WHEN** a stale graph needs updating before review
- **THEN** the workflow SHALL surface a prompt to run explicit `ocr graph update` or
  `ocr graph build --full`
- **AND** SHALL NOT silently run those commands as part of the automated review flow
