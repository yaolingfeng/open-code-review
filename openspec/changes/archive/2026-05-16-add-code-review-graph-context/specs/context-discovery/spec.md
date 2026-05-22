# context-discovery Spec Delta

## MODIFIED Requirements

### Requirement: Command-Agnostic Discovery

The context discovery workflow SHALL be shared by OCR commands that require project context, including `/ocr:review` and `/ocr:map`. When graph context is enabled, context discovery SHALL run graph context generation after standard project context discovery.

#### Scenario: Review command generates graph context

- **GIVEN** `/ocr:review` is initiated
- **AND** graph context is enabled
- **WHEN** standard project context discovery completes
- **THEN** the workflow SHALL attempt to generate `graph-context.md` and `graph-context.json`
- **AND** graph context failure SHALL NOT stop review

#### Scenario: Map command generates graph context

- **GIVEN** `/ocr:map` is initiated
- **AND** graph context is enabled
- **WHEN** standard project context discovery completes
- **THEN** the workflow SHALL attempt to generate `graph-context.md` and `graph-context.json`
- **AND** graph context failure SHALL NOT stop map generation
