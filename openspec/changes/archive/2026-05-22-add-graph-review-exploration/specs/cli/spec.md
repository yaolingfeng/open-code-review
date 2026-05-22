## ADDED Requirements

### Requirement: Graph Exploration Commands

CLI SHALL provide graph-native exploration commands in addition to existing graph
status/query/context commands.

#### Scenario: Search graph from CLI

- **WHEN** user runs `ocr graph search auth service --json`
- **THEN** CLI SHALL return structured graph search results
- **AND** human-readable mode SHALL summarize the matched files or symbols

#### Scenario: Generate graph review analysis from CLI

- **WHEN** user runs `ocr graph review-analysis --files src/a.ts,src/b.ts --json`
- **THEN** CLI SHALL return structured `GraphReviewAnalysis` output
- **AND** human-readable mode SHALL summarize priorities, hints, and module groups

#### Scenario: CLI exposes explicit graph exploration states

- **WHEN** user runs `ocr graph search` or `ocr graph review-analysis`
- **THEN** CLI SHALL expose `ready | missing | stale | degraded | error`
  through the returned status field or equivalent output contract
- **AND** warnings or reasons SHALL be returned in a machine-readable way

#### Scenario: CLI bounds exploration payload size

- **WHEN** user runs `ocr graph search` or `ocr graph review-analysis`
- **THEN** CLI SHALL support bounded result sizes such as `limit`, `maxNodes`,
  or `maxHints`
- **AND** CLI SHALL indicate when results were truncated

#### Scenario: Readable degraded states for exploration commands

- **GIVEN** `.ocr/data/graph.db` is missing, stale, or partially unsupported
- **WHEN** user runs `ocr graph search` or `ocr graph review-analysis`
- **THEN** CLI SHALL return a controlled status with warnings
- **AND** SHALL NOT throw an unhandled error

#### Scenario: Graph context CLI is read-only unless explicitly updated

- **GIVEN** user runs `ocr graph context` without an explicit update option
- **WHEN** the graph database is stale or partially out of date
- **THEN** CLI SHALL return graph context with stale or degraded warnings
- **AND** SHALL NOT run incremental update, full build, search-index rebuild, or flow
  rebuild as a side effect

#### Scenario: Manual graph context update is opt-in

- **WHEN** user runs an explicit update-bearing graph command such as
  `ocr graph context --update`
- **THEN** CLI MAY refresh graph data before rendering context
- **AND** output SHALL make the update or skipped update status visible

#### Scenario: CLI guards expensive graph options

- **GIVEN** graph status indicates a large graph or an expensive option such as
  module summaries, deep traversal, or full postprocess is requested
- **WHEN** user runs graph exploration commands
- **THEN** CLI SHALL require explicit opt-in or downgrade to safe defaults
- **AND** SHALL explain the CPU-risk reason in human-readable and JSON output

#### Scenario: Fresh review does not imply graph rebuild

- **WHEN** user runs review workflow with a fresh-session option
- **THEN** CLI or workflow docs SHALL clarify that fresh review state does not imply
  graph update or rebuild
- **AND** graph refresh SHALL require explicit `ocr graph update` or
  `ocr graph build --full`
