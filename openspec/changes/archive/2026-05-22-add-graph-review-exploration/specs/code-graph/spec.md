## ADDED Requirements

### Requirement: Graph Full-Text Search

系统 SHALL 提供基于 graph database 的全文搜索能力，供 reviewer、CLI、
Dashboard 和 workflow 使用。

#### Scenario: Search graph by symbol or file terms

- **WHEN** 用户运行 `ocr graph search auth service --json`
- **THEN** 系统 SHALL 返回结构化 `GraphSearchResult`
- **AND** 结果 SHALL 支持匹配 node name、qualified name、file path、kind
- **AND** signature 检索 SHALL 仅要求支持稳定可得的 normalized signature
  tokens，而不要求把原始长 signature 直接暴露为高质量检索字段

#### Scenario: Full build and incremental update maintain search index

- **GIVEN** graph DB 已建立搜索索引
- **WHEN** 系统执行 full build 或 incremental update
- **THEN** 搜索索引 SHALL 与 graph files/nodes 保持一致
- **AND** 已删除文件或节点对应的搜索记录 SHALL 被移除

#### Scenario: Search result size is bounded for token efficiency

- **WHEN** 系统返回 graph search 结果
- **THEN** 输出 SHALL 支持 `limit` 或等价上限控制
- **AND** 返回结构 SHALL 标记 `truncated` 或等价字段以说明结果被裁剪

#### Scenario: Search status uses explicit graph exploration states

- **GIVEN** graph search 被调用
- **WHEN** graph 状态被判定
- **THEN** `GraphSearchResult.status` SHALL 使用
  `ready | missing | stale | degraded | error`
- **AND** 每种状态 SHALL 保留 `warnings` 或等价原因字段

#### Scenario: Search degrades gracefully when graph is unavailable

- **GIVEN** graph 处于 `missing`、`stale`、`degraded` 或 `error` 状态
- **WHEN** 用户或 workflow 请求 graph search
- **THEN** 系统 SHALL 返回受控状态与 warnings
- **AND** 不得阻断 review/map workflow

### Requirement: Graph Review Analysis

系统 SHALL 提供面向 reviewer 的 graph review analysis 聚合结果，而不仅是
raw graph context。

#### Scenario: Graph review analysis provides incremental reviewer value

- **GIVEN** workflow 或用户提供 changed files 或 changed symbols
- **WHEN** 系统生成 graph review analysis
- **THEN** 输出 SHALL 聚焦 search-driven drilldown、review order、boundary
  crossing、coupling hotspot、weakly connected change 等 reviewer-native hints
- **AND** SHALL NOT 仅仅重新包装已有 `graph-context` 字段

#### Scenario: Aggregate reviewer-oriented graph analysis

- **GIVEN** workflow 或用户提供 changed files 或 changed symbols
- **WHEN** 系统生成 graph review analysis
- **THEN** 输出 MAY 复用 changed symbols、impacted nodes/files、flows、
  test gaps、unsupported changed files 等已有图谱信号
- **AND** 这些信号 SHALL 被组织为 summary-first 的 review exploration 结果

#### Scenario: Review analysis emits explainable hints

- **GIVEN** graph review analysis 可读取 changed set、edge traversal 和 flow
  信息
- **WHEN** 系统生成 reviewer hints
- **THEN** 输出 SHALL 支持 boundary crossing、coupling hotspot、weakly
  connected change、suggested review order 等 explainable hints
- **AND** 每个 hint SHALL 包含类型和原因说明

#### Scenario: Review analysis remains deterministic and lightweight

- **WHEN** 系统生成 graph review analysis
- **THEN** 分析 SHALL 采用 deterministic heuristic
- **AND** SHALL NOT 依赖 embedding、semantic ranking 或重型聚类算法

#### Scenario: Review analysis payload is bounded for token efficiency

- **WHEN** 系统返回 graph review analysis
- **THEN** 输出 SHALL 支持 `maxNodes`、`maxHints`、`maxModules` 或等价上限控制
- **AND** 默认 workflow 注入 SHALL 仅包含摘要，而不是完整 drilldown payload
- **AND** 返回结构 SHALL 标记 `truncated` 或等价字段以说明结果被裁剪

#### Scenario: Review analysis status uses explicit graph exploration states

- **GIVEN** graph review analysis 被调用
- **WHEN** graph 状态被判定
- **THEN** `GraphReviewAnalysis.status` SHALL 使用
  `ready | missing | stale | degraded | error`
- **AND** 每种状态 SHALL 保留 `warnings` 或等价原因字段

#### Scenario: Review analysis generation is on-demand and lifecycle-aware

- **WHEN** CLI、Dashboard 或 workflow 需要 graph review analysis
- **THEN** 系统 SHALL 按需生成 analysis
- **AND** 如为 session 或 changed set 持久化 artifact，系统 SHALL 使其 scope
  和生成时机可判定
- **AND** 不得要求每次 review 默认注入完整 analysis artifact

### Requirement: Graph Performance Safety

系统 SHALL prevent review-time graph exploration from triggering high-CPU full
rebuilds, repeated full-table scans, or unbounded traversal.

#### Scenario: Graph context generation is read-only by default

- **GIVEN** graph context is generated for review or map workflows
- **WHEN** the graph database exists but is stale or partially out of date
- **THEN** `generateGraphContext` SHALL return a controlled stale or degraded status
  with warnings
- **AND** SHALL NOT call `updateGraph`, `buildGraph`, full search-index rebuild, or
  full flow rebuild unless an explicit update option is provided

#### Scenario: Explicit graph refresh remains available

- **WHEN** a user explicitly runs graph update or build commands, or passes an
  explicit graph context update option intended for manual CLI use
- **THEN** the system MAY update graph files/nodes/edges and run configured
  postprocessing
- **AND** review/map orchestration SHALL NOT use that opt-in path by default

#### Scenario: Incremental update avoids unnecessary postprocessing

- **GIVEN** `updateGraph` scans a changed set
- **WHEN** no files are indexed, errored, or removed
- **THEN** the system SHALL skip search-index and flow postprocessing
- **AND** update results SHALL expose enough counts, including removed files, to
  explain why postprocessing did or did not run

#### Scenario: Postprocess levels bound derived graph work

- **WHEN** graph update or build code runs derived graph computation
- **THEN** it SHALL support levels equivalent to `none`, `minimal`, and `full`
- **AND** `none` SHALL update only files/nodes/edges
- **AND** `minimal` SHALL update search data without full flow/module recomputation
- **AND** `full` SHALL be required for full flow, module, or risk-summary rebuilds

#### Scenario: Search uses indexed path by default

- **GIVEN** graph search is available
- **WHEN** the user searches graph data
- **THEN** the system SHALL use an indexed search path such as FTS5 by default
- **AND** JavaScript full-table scoring SHALL only be used as a controlled fallback
  with a warning when the indexed path is unavailable

#### Scenario: Traversal queries are indexed and bounded

- **WHEN** impact radius, flow lookup, or edge traversal is executed
- **THEN** the graph database SHALL provide indexes for flow node lookup and common
  edge traversal predicates
- **AND** traversal SHALL use bounded, batched, or otherwise limited queries instead
  of unbounded per-node N+1 SQL loops

#### Scenario: Expensive module summaries are opt-in or precomputed

- **WHEN** graph review analysis is generated with default options
- **THEN** module bridge summaries SHALL NOT execute expensive correlated per-edge
  target resolution queries
- **AND** cross-module bridge data SHALL either use precomputed summaries or remain
  disabled until explicitly requested

#### Scenario: Graph analysis exposes progress and downgrade reasons

- **WHEN** graph analysis or heavy graph queries execute
- **THEN** the system SHALL expose phase, elapsed time, relevant graph sizes, and
  truncated or downgraded reasons in structured output or progress state

#### Scenario: Performance benchmarks guard graph exploration

- **WHEN** graph performance changes are implemented
- **THEN** benchmarks SHALL cover graph status, review-analysis with `maxModules=0`,
  search, impact radius, and dashboard analysis request paths
- **AND** benchmark thresholds SHALL prevent regressions that would block normal
  review workflow

### Requirement: Graph Architecture Grouping

系统 SHALL 提供轻量 architecture/module grouping signals，用于帮助 reviewer
理解 changed set 的模块边界与跨模块连接。

#### Scenario: Summarize touched modules for a changed set

- **GIVEN** graph review analysis 读取 changed files、nodes 和边连接
- **WHEN** 系统生成 architecture grouping
- **THEN** 输出 SHALL 包含 touched modules/groups、每组涉及的 changed files，
  以及面向 reviewer 的 architecture summary

#### Scenario: Detect cross-group coupling and bridge entities

- **GIVEN** changed set 涉及多个 module groups
- **WHEN** 系统分析组间依赖
- **THEN** 输出 SHALL 标记 cross-group coupling
- **AND** SHALL 标记 bridge files 或 bridge symbols 以解释连接关系

#### Scenario: Grouping degrades gracefully for sparse or partial graphs

- **GIVEN** graph coverage 不完整、部分文件 unsupported，或边连接过稀疏
- **WHEN** 系统生成 grouping summary
- **THEN** 系统 SHALL 输出可读 warnings 或 reduced-confidence summary
- **AND** 不得伪造高置信度 architecture inference
