# dashboard Spec Delta

## ADDED Requirements

### Requirement: Graph Context Display

The dashboard SHALL expose graph status, graph context artifacts, and graph query endpoints.

#### Scenario: View graph context artifact

- **GIVEN** a session contains `graph-context.md`
- **WHEN** the dashboard syncs artifacts
- **THEN** the artifact SHALL be available as `graph-context`

#### Scenario: Fetch graph status

- **WHEN** client calls `GET /api/graph/status`
- **THEN** dashboard SHALL return graph availability, counts, stale status, and warnings

#### Scenario: Query graph

- **WHEN** client calls `POST /api/graph/query`
- **THEN** dashboard SHALL execute the internal graph query and return structured results
- **AND** graph query failure SHALL return a controlled error response
