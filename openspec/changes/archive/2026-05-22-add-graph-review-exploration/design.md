## Context

`add-code-review-graph-context` 与 `update-graph-p0-review-signals` 已让 OCR
具备稳定的图谱底座：图数据库、增量更新、changed-symbol precision、impact
radius、flows、test gaps，以及 review/map 可消费的 graph context artifact。

这次变更不再解决“能否生成图谱上下文”，而是解决“reviewer 如何直接消费图谱”。
目标是选择一个现实、渐进、面向 review 主线的 P1 范围，而不是追平
`code-review-graph` 的平台级能力。

## Goals / Non-Goals

**Goals**:
- 提供 FTS-first 的 graph search。
- 提供 reviewer-oriented 的 `GraphReviewAnalysis` 聚合结果。
- 提供轻量 module/architecture grouping signals。
- 在 CLI 和 Dashboard 提供 graph-native exploration surface。
- 保持 deterministic heuristic 和 graceful degradation。
- 防止 review/map 和 dashboard graph exploration 触发高 CPU 的全量重建、全表
  查询或重复同步分析。
- 在新增 exploration-oriented outputs 的同时，不破坏现有 `graph-context`
  artifact contract。

**Non-Goals**:
- 不引入 semantic/vector search 或 embedding pipeline。
- 不做 multi-repo graph。
- 不实现 dead-code/refactor recommendation 平台。
- 不提供 watch/hooks/serve/MCP 平台能力。
- 不做复杂交互式大图可视化或 community detection。
- 不在本次 change 中把 architecture grouping 深度耦合进 review-map sectioning。

## Decisions

### D-1: FTS first, not semantic search

**Decision**: 在 `graph.db` 内引入全文搜索索引，优先支持 node name、qualified
name、file path、kind，以及仅在稳定可得时纳入的 normalized signature tokens；
本轮不引入 embedding 或 semantic ranking，也不要求把原始长 signature 作为高质
量检索字段。

**Rationale**: OCR 当前最缺的是 reviewer 可直接使用的可解释检索能力，而不
是高复杂度召回。FTS 成本低、可维护、便于增量更新，且足以支撑 review
exploration P1。对 signature 的要求收敛到“稳定 token 化后可搜”，可以避免各语
言 parser 产出不一致导致的检索质量和维护成本问题。

### D-2: Review analysis 独立于 raw graph context

**Decision**: 新增独立的 `GraphReviewAnalysis` 结构化输出，而不是继续把所有
信号塞进 `graph-context.json` 的原始字段集合中。其增量价值聚焦于 search-driven
 drilldown、review order、boundary crossing、coupling hotspot、weakly
connected change 等 reviewer-native hints，而不是重新包装已有 graph-context
字段。

**Rationale**: `graph-context` 主要面向 workflow 上下文补充；review exploration
需要更高层次、可解释、面向 reviewer 的聚合结果，例如 review order、boundary
crossing、coupling hotspot、possibly unrelated changed file。

这也避免将 exploration-oriented 聚合结果与 workflow-oriented raw context 混在
同一 schema 中，降低向后兼容和消费端演进的复杂度。

### D-3: Module grouping 使用轻量 heuristic

**Decision**: module/architecture grouping 基于目录前缀、文件聚合和边连接信号
构建 touched groups，而不是引入真正的 clustering/community detection。

**Rationale**: reviewer 需要的是稳定、可解释、低成本的分组提示，而不是高复杂度、
高不确定性的自动聚类。启发式分组更易落地，也更符合 OCR 当前 review/map 产品
定位。该输出应被视为 reviewer aid，而不是 authoritative architecture
decomposition。

### D-4: Dashboard 消费结构化 exploration data

**Decision**: Dashboard 保留现有 graph-context card，同时新增 search、review
analysis、module summary 等面板，并优先消费新的结构化 JSON 数据。

**Rationale**: 现有 artifact card 适合作为底层上下文展示；新增 exploration
surface 则服务于直接操作与逐步钻取。两者并存可以兼顾兼容性与增量演进。

### D-5: Review orchestration consumes analysis as context, not verdict

**Decision**: Tech Lead/reviewer 可以消费 `GraphReviewAnalysis`，但系统仍明确
要求 graph output 只是 investigation context，不能直接构成 finding 或 final
verdict。默认注入给 workflow/reviewer 的应是摘要型结果，而不是完整 exploration
payload；需要进一步细节时，通过按需 query 或 dashboard/CLI drilldown 获取。

**Rationale**: 这延续 OCR 的现有原则，避免把 heuristic graph signal 误用为裁决
引擎，同时通过“summary first, query on demand”控制 token 开销，把 graph
exploration 的收益集中在减少盲目源码搜索和重复 tracing 上。

### D-6: Review and dashboard graph exploration are read-only by default

**Decision**: `generateGraphContext()`、review orchestration 和 dashboard 初始渲染默认
只读取已有 graph DB 与 session artifacts。它们不得隐式调用 `updateGraph()`、full
build、search-index rebuild、flow rebuild 或 module bridge summary 重计算。需要刷
新图谱时，用户必须显式运行 `ocr graph update`、`ocr graph build --full`，或使用
显式的 CLI/dashboard refresh action。

**Rationale**: Review 主流程的核心要求是不中断代码评审。图谱 stale 时返回 warning
比在 review 阶段偷偷进行全量派生计算更安全，因为后者会让 AI reviewer 和 dashboard
页面刷新触发同步 CPU 峰值，最终卡住整个 review。

### D-7: Heavy analysis requires bounded execution

**Decision**: `/api/graph/review-analysis` 和 dashboard reanalyze SHALL 使用
single-flight、timeout、cancellation 和短期缓存。实现上优先使用 worker/subprocess
等可硬取消边界，而不是在 Express request handler 内直接执行不可中断的同步
better-sqlite3 重分析。`maxModules` 默认保持 `0`，模块 bridge summary 仅作为高级
手动选项启用。

**Rationale**: single-flight 和短期缓存能防止页面刷新或多个 panel 同时发起重复分析；
timeout 和 cancellation 能保证一次昂贵查询不会占住服务进程。`maxModules=0` 保持
默认路径低成本，把跨模块 bridge 计算留给用户明确需要时再做。

### D-8: Full derived graph computation belongs to explicit build/update

**Decision**: `updateGraph()` SHALL 支持 postprocess level：`none` 只更新 files/nodes/edges，
`minimal` 维护 search rows，`full` 才重建 flows/module/risk summaries。review 阶段
使用 read-only 或 no-postprocess 路径。full-table search-index rebuild 和 full flow
rebuild 只能在 explicit full build 或 explicit full postprocess 中运行。

**Rationale**: 当前高 CPU 风险来自“增量输入触发全量派生计算”。把派生计算拆成层级
可以让 review 只消费已有图谱，同时保留用户显式刷新图谱时的完整性。

### D-8.1: Context discovery and review map inherit shared read-only graph consumption

**Decision**: `context-discovery` 和 `review-map` 不在本次变更中新增独立 graph
spec delta。它们通过 shared `code-graph` 与 `review-orchestration` requirement
继承 read-only graph consumption 行为：可以消费已有 graph context / graph review
analysis artifact，但不得在 workflow 执行期间隐式触发 `updateGraph()`、full
build、search-index rebuild、flow rebuild 或昂贵 module summary。

**Rationale**: 本次变更的边界是 graph exploration surface 与 review workflow
消费规则，而不是重写 context discovery 或 review map 的领域 spec。把 read-only
约束放在 shared graph contract 中，可以避免多个 workflow spec 各自重复描述并产
生分歧；后续如果要把 module grouping 深度接入 review-map sectioning，再用单独
change 扩展 `review-map` spec。

### D-9: Query hot paths must be indexed and benchmarked

**Decision**: graph DB SHALL 增加 flow/node lookup 和 edge traversal 的组合索引；search
默认走 FTS5，若 FTS5 不可用则输出 controlled fallback warning；impact radius 优先
改为 batched frontier queries，recursive CTE 作为经过基准验证后的后续优化；module
bridge summaries SHALL 避免 per-edge correlated subquery，改为预计算或显式降级。

### D-10: FTS5 is the default search path with explicit capability fallback

**Decision**: search-index 基础表负责维护可搜索字段的一致性；FTS5 virtual table
作为默认查询路径，并通过 capability detection 决定是否启用。如果当前 SQLite build
不支持 FTS5，系统 SHALL 返回 controlled fallback warning，并使用 bounded JavaScript
scoring fallback，而不是静默退回全表扫描。

**Rationale**: 这样能把“搜索字段维护”和“FTS5 查询能力”区分清楚：基础
search-index 是数据一致性的底座，FTS5 是默认高性能执行路径。显式 fallback warning
可以避免打包环境或 native SQLite 能力差异被误判为正常性能路径。

**Rationale**: 这些优化先解决已观测到的热点路径，同时避免一次性引入 recursive CTE、
FTS5 fallback、incremental flows 三类高复杂度变更导致正确性风险。

## Architecture

```text
packages/shared/graph
  storage/      -> graph.db schema + FTS maintenance
  indexer/      -> full build / incremental update sync FTS rows
  query/        -> graph search API + edge traversal helpers
  analysis/     -> GraphReviewAnalysis aggregation
  context/      -> existing graph context remains compatible
  grouping/     -> lightweight module / architecture signals (may live under analysis/)

packages/cli
  commands/graph.ts -> search + review-analysis commands

packages/dashboard
  server/routes/graph.ts -> search + review-analysis APIs
  client/features/graph/* -> search UI, analysis panel, module summaries
```

## Data Model

Planned structured outputs:

```text
GraphSearchResult
- status                # ready | missing | stale | degraded | error
- query
- summary?
- limit
- results[]
  - node/file identifiers
  - matchType(s)
  - score/snippet metadata when available
- warnings
- truncated

GraphReviewAnalysis
- status                # ready | missing | stale | degraded | error
- summary
- changedSymbols
- priorities
- hints[]               # capped by maxHints
- modules[]             # capped or summarized when large
- drilldown
  - impactedFiles / impactedNodes
  - flows
  - testGaps
  - unsupportedChangedFiles
- warnings
- truncated
- generatedAt / sourceScope
```

Recommended control knobs:
- `limit` / `maxResults` for search results
- `maxNodes`, `maxFiles`, `maxHints`, `maxModules` for analysis payloads
- `maxModules` defaults to `0`; module bridge summaries require explicit opt-in
- `postprocess` levels for graph update/build paths: `none`, `minimal`, `full`
- summary-first workflow injection; full drilldown fetched on demand
```

Operational metadata:
- graph analysis progress phase / current step
- elapsed time and timeout/cancellation status
- node/edge/file counts used by guards
- truncated or downgraded reason when expensive work is skipped

Status semantics:
- `ready`: graph data is usable for search/analysis with no material degradation
- `missing`: graph DB or required graph inputs do not exist
- `stale`: graph exists but is known to be out of date relative to the changed set
- `degraded`: graph partially works but coverage/precision is reduced
- `error`: graph search/analysis failed to execute successfully


## Risks / Trade-offs

- FTS schema 会增加 graph DB schema 与 update path 复杂度，需要确保 full
  build 与 incremental update 一致维护。
- FTS ranking 在 P1 中会以稳定性和可解释性优先，而不是追求复杂 relevance
  modeling；其价值是可用的 reviewer exploration，而不是“智能搜索”体验。
- 轻量 module grouping 可能不够“智能”，但其优势是稳定、可解释、可测试。
- 如果把 analysis 结果与 existing graph-context 耦合过深，会增加兼容成本；
  因此本次保持独立 artifact/schema 更稳妥。
- Dashboard 若过早追求大型图可视化，会稀释本次以 reviewer UX 为核心的目标。
- Read-only 默认行为会让 stale graph 不再自动刷新；这是为了保护 review 主流程，
  代价是用户需要显式运行 `ocr graph update` 或 `ocr graph build --full`。
- 子进程/worker 取消边界会增加 dashboard route 实现复杂度，但比在 Express 进程
  内运行不可中断的同步分析更可恢复。
- Recursive CTE、FTS5 和 incremental flows 都有正确性风险，应分批上线并由基准
  与回归测试守住。

## Migration Plan

1. 扩 OpenSpec：先定义 code-graph / cli / dashboard /
   review-orchestration 的新 requirement。
2. 在实现阶段为 `graph.db` 增加 FTS 相关 schema、能力检测、组合索引与同步逻辑。
3. 先落地 read-only review/dashboard 路径，确保 review 阶段不会隐式 update/build
   或触发全量派生计算。
4. 新增 review analysis 聚合层与结构化 schema，并为 dashboard refresh 路径增加
   single-flight、timeout、cancellation 和短期缓存。
5. 定义 `GraphReviewAnalysis` 的生成时机与 artifact 生命周期：按需生成，必要时
   可为当前 session/changed set 写入结构化 artifact，但默认 workflow 注入仅使用
   摘要而非完整 payload。
6. 接入 CLI 和 dashboard API/UI。
7. 保持现有 `graph-context` artifact 不变或仅做兼容性扩展，避免破坏现有
   review/map 流程。
8. 增加性能基准与大库 guard，再逐步启用 batched impact traversal、incremental
   search index 和 incremental flows。

## Alternatives Considered

### 1. 直接追平 `code-review-graph`
不采用：范围过大，会把 OCR 从 review 产品拉向 graph platform。

### 2. 先做 semantic/vector search
不采用：复杂度高，且当前主要缺口不是召回，而是 reviewer 可直接消费的 graph
exploration surface。

### 3. 先做大型交互图可视化
不采用：在聚合分析能力不足前，图可视化 ROI 不高。

### 4. 先把 architecture grouping 深度接入 review-map
不采用：map 深度集成可以作为 follow-up change，避免本轮范围扩张。
