## MODIFIED Requirements

### Requirement: Tech Lead Orchestration

The Tech Lead workflow SHALL use graph context when available to guide code exploration, reviewer assignment, test-gap awareness, and impact analysis. Graph context SHALL NOT be the sole basis for review findings or final verdict.

#### Scenario: Tech Lead uses graph context

- **GIVEN** graph context exists for a review session
- **WHEN** Tech Lead performs analysis
- **THEN** Tech Lead SHALL consider changed symbols, impacted files, test gaps, unsupported changed files, graph warnings, and changed-symbol precision signals
- **AND** review prioritization SHOULD be influenced by test gaps, affected flows, and symbol-level impact
- **AND** Tech Lead SHALL treat graph output as context for investigation rather than authoritative evidence

#### Scenario: Reviewer receives graph context

- **GIVEN** graph context exists for a review session
- **WHEN** reviewer tasks are spawned
- **THEN** each reviewer SHALL receive graph context
- **AND** reviewers MAY use `ocr graph query` for focused exploration
- **AND** reviewers SHALL NOT report findings solely because graph output says a node is risky
