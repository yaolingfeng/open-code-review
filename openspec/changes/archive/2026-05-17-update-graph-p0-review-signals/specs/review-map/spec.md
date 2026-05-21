## MODIFIED Requirements

### Requirement: Map Architect Orchestration

The Map Architect workflow SHALL use graph context when available to guide topology analysis, flow tracing, dependency grouping, and review ordering. The git-derived canonical changed file list SHALL remain the completeness source of truth.

#### Scenario: Map uses graph topology

- **GIVEN** graph context exists for a map session
- **WHEN** topology and flow analysis run
- **THEN** Map Architect and Flow Analysts SHALL use graph-derived changed symbols, import, call, dependency, impact context, and changed-symbol precision signals to guide grouping and ordering
- **AND** topology analysis SHOULD prefer symbol-level changed nodes over file-level changed nodes when precision is available
- **AND** affected flows and test gaps SHOULD inform map synthesis priority notes
- **AND** all canonical changed files SHALL still appear in the final map

#### Scenario: Unsupported changed files in map

- **GIVEN** changed files include files unsupported by the graph engine
- **WHEN** map synthesis runs
- **THEN** unsupported changed files SHALL still appear in the map checklist
- **AND** the map MAY mark them as not covered by graph context
