# cli Spec Delta

## ADDED Requirements

### Requirement: Graph Commands

CLI SHALL provide `ocr graph status`, `ocr graph build`, `ocr graph update`, `ocr graph query`, `ocr graph impact`, and `ocr graph context` commands.

#### Scenario: Show graph status

- **WHEN** user runs `ocr graph status --json`
- **THEN** CLI SHALL report graph database status, file count, node count, edge count, supported language count, unsupported file count, and warnings

#### Scenario: Build graph

- **WHEN** user runs `ocr graph build --full`
- **THEN** CLI SHALL perform a full graph rebuild using the internal graph engine

#### Scenario: Update graph

- **WHEN** user runs `ocr graph update --base origin/main`
- **THEN** CLI SHALL update graph data for changed files only

#### Scenario: Query graph

- **WHEN** user runs `ocr graph query file_summary --target src/foo.ts --json`
- **THEN** CLI SHALL return structured JSON query results

#### Scenario: Generate context

- **WHEN** user runs `ocr graph context --workflow review --json`
- **THEN** CLI SHALL generate a review graph context payload

#### Scenario: Missing graph

- **GIVEN** `.ocr/data/graph.db` does not exist
- **WHEN** user runs a read-only graph command
- **THEN** CLI SHALL return a clear missing graph status instead of throwing an unhandled error
