## ADDED Requirements

### Requirement: Graph Review Exploration Display

The dashboard SHALL expose graph-native review exploration surfaces in addition to
existing graph context artifacts.

#### Scenario: Search graph from dashboard

- **WHEN** client calls the dashboard graph search surface with a text query
- **THEN** the dashboard SHALL return structured graph search results
- **AND** the UI SHALL present a readable result list for matched symbols or files

#### Scenario: View graph review analysis panel

- **GIVEN** graph review analysis exists for the selected changed set or session
- **WHEN** the user opens the graph exploration area
- **THEN** the dashboard SHALL display priorities, explainable hints, impacted
  areas, and module or architecture summaries
- **AND** the default view SHALL prefer summary-level information over full
  drilldown payloads

#### Scenario: Drill down into module summaries

- **GIVEN** graph review analysis contains touched module groups
- **WHEN** the user inspects a module summary
- **THEN** the dashboard SHALL show changed files, bridge files or symbols, and
  cross-group coupling hints for that group

#### Scenario: Graph exploration states are explicit in dashboard responses

- **WHEN** dashboard graph search or review analysis APIs return data
- **THEN** the returned payload SHALL expose
  `ready | missing | stale | degraded | error`
- **AND** warnings or reasons SHALL be available for UI rendering

#### Scenario: Missing or degraded graph state remains readable

- **GIVEN** graph data is missing, stale, partially unsupported, or analysis fails
- **WHEN** the user opens graph exploration UI
- **THEN** the dashboard SHALL show readable status and warning states
- **AND** existing graph-context displays SHALL remain available when possible

#### Scenario: Dashboard does not auto-run heavy graph analysis

- **GIVEN** a user opens a session or Graph Exploration page
- **WHEN** existing graph artifacts are available
- **THEN** the dashboard SHALL prefer rendering those artifacts
- **AND** SHALL NOT automatically trigger live graph review analysis, graph update,
  full build, search-index rebuild, flow rebuild, or module summary computation

#### Scenario: User explicitly reruns graph analysis

- **WHEN** the user clicks a reanalyze or refresh action for graph exploration
- **THEN** the dashboard MAY request fresh graph review analysis
- **AND** the request SHALL use default `maxModules: 0` unless the user explicitly
  enables advanced module summary analysis

#### Scenario: Dashboard graph analysis avoids duplicate high-CPU work

- **WHEN** multiple dashboard components or page refreshes request the same graph
  review analysis
- **THEN** the server SHALL coalesce equivalent requests using single-flight or an
  equivalent mechanism
- **AND** SHALL apply a short-lived cache for identical changed-set analysis results

#### Scenario: Dashboard graph analysis can be timed out and cancelled

- **WHEN** graph review analysis exceeds configured runtime bounds or the user
  cancels the request
- **THEN** the dashboard SHALL stop the underlying analysis work, not only update UI
  state
- **AND** the UI SHALL display a readable timeout or cancellation status

#### Scenario: Dashboard guards expensive graph options

- **GIVEN** graph size or requested options indicate high CPU risk
- **WHEN** the user enables module summaries, deep traversal, or other expensive
  graph exploration options
- **THEN** the dashboard SHALL require explicit confirmation or automatically
  downgrade to safe defaults with a visible explanation
