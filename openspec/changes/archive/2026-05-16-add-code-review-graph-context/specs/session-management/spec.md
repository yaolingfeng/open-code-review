# session-management Spec Delta

## MODIFIED Requirements

### Requirement: Session Directory Structure

Session root artifacts MUST support optional graph context artifacts shared by review rounds and map runs.

#### Scenario: Graph context artifacts

- **GIVEN** graph context generation has run for a session
- **WHEN** session files are inspected
- **THEN** `.ocr/sessions/{id}/graph-context.md` MAY exist
- **AND** `.ocr/sessions/{id}/graph-context.json` MAY exist
- **AND** these artifacts SHALL be shared across review rounds and map runs in the same session
