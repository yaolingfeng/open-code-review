# code-graph Specification

## Purpose
TBD - created by archiving change add-code-review-graph-context. Update Purpose after archive.
## Requirements
### Requirement: Internal Graph Engine

系统 SHALL 提供一个位于 `packages/shared/graph` 的内部 TypeScript 代码图谱引擎，该引擎随 OCR CLI 和 Dashboard 构建产物一起分发，但 SHALL NOT 作为独立 npm 包发布。

#### Scenario: Graph module is internal only

- **GIVEN** OCR 执行 npm release
- **WHEN** release project 集合被解析
- **THEN** `@open-code-review/graph` SHALL NOT 被发布
- **AND** 用户 SHALL NOT 需要单独安装 `@open-code-review/graph`

### Requirement: Graph Database

系统 SHALL 使用 `.ocr/data/graph.db` 存储代码图谱数据，并与 `.ocr/data/ocr.db` 的 workflow/session 状态分离。

#### Scenario: Graph database isolation

- **GIVEN** 图谱索引运行
- **WHEN** graph nodes 和 graph edges 被写入
- **THEN** 数据 SHALL 写入 `.ocr/data/graph.db`
- **AND** OCR workflow/session 状态 SHALL 继续存储在 `.ocr/data/ocr.db`

### Requirement: Supported Languages

图谱引擎 SHALL 在 v1 支持 Python、JavaScript、TypeScript、Go、Java、Vue 和 SQL 的 Tree-sitter 解析。

#### Scenario: Supported source file

- **GIVEN** 仓库包含受支持语言的源码文件
- **WHEN** 图谱 build 或 update 运行
- **THEN** 系统 SHALL 为该文件生成 File 节点
- **AND** 系统 SHOULD 为可识别的 class、function、type、test 生成节点
- **AND** 系统 SHOULD 为可识别的 contains、import、call、inheritance、test 关系生成边

#### Scenario: Unsupported source file

- **GIVEN** 仓库包含首批语言范围之外的文件
- **WHEN** 图谱 build 或 update 运行
- **THEN** unsupported 文件 SHALL 被跳过
- **AND** unsupported 文件数量 SHALL 被记录在 graph status 中
- **AND** review/map workflow SHALL 继续运行

### Requirement: Node.js Ecosystem Resolution

系统 SHALL 将 Node.js 作为 JavaScript/TypeScript 生态解析能力，而不是单独的 Tree-sitter language。

#### Scenario: CommonJS and ESM resolution

- **GIVEN** JavaScript 或 TypeScript 文件包含 `require()`、`module.exports`、`exports.*`、ESM import/export 或 `package.json` exports/main/imports
- **WHEN** 文件被解析
- **THEN** 图谱引擎 SHOULD 生成对应的 IMPORTS_FROM、DEPENDS_ON 或 metadata
- **AND** Node.js built-in modules SHOULD 被标记为 external/builtin

### Requirement: Full Graph Build

系统 SHALL 支持通过 `ocr graph build --full` 执行全量图谱构建。

#### Scenario: Full build

- **GIVEN** 仓库包含受支持语言源码
- **WHEN** 用户运行 `ocr graph build --full`
- **THEN** 系统 SHALL 清理旧 graph tables
- **AND** 系统 SHALL 重新扫描仓库文件
- **AND** 系统 SHALL 重建 graph files、nodes、edges 和 metadata

### Requirement: Incremental Graph Update

系统 SHALL 支持基于变更文件的增量图谱更新。

#### Scenario: Incremental update

- **GIVEN** `.ocr/data/graph.db` 已存在
- **WHEN** 用户运行 `ocr graph update --base origin/main`
- **THEN** 系统 SHALL 仅重新解析变更且 hash 已变化的受支持文件
- **AND** 已删除文件的图谱数据 SHALL 被移除
- **AND** 未变化文件 SHALL 被跳过

#### Scenario: Workflow-triggered incremental update

- **GIVEN** review 或 map workflow 已获得 canonical changed files
- **WHEN** workflow 在生成 graph context 前执行预处理
- **THEN** 系统 SHALL 尝试执行一次 best-effort incremental graph update
- **AND** incremental update failure SHALL 记录 warning
- **AND** workflow SHALL 继续执行，不得因 graph update failure 中断

### Requirement: Graph Query

系统 SHALL 提供结构化图谱查询能力，供 OCR workflow、CLI 用户和 Dashboard 使用。

#### Scenario: Query graph by pattern

- **WHEN** 用户运行 `ocr graph query callers_of --target <target> --json`
- **THEN** 命令 SHALL 返回包含 status、summary、nodes、edges、warnings 和 truncated 字段的 JSON

### Requirement: Graph Impact Analysis

系统 SHALL 支持按变更文件计算影响半径。

#### Scenario: Impact radius

- **GIVEN** 用户提供 changed files
- **WHEN** 用户运行 `ocr graph impact --files <files> --depth 2 --json`
- **THEN** 系统 SHALL 返回 changed nodes、impacted nodes、impacted files 和连接边

### Requirement: Graph Context

系统 SHALL 为 review 和 map workflow 生成图谱上下文 artifacts。

#### Scenario: Generate graph context

- **GIVEN** review 或 map workflow 运行
- **WHEN** graph context 生成完成
- **THEN** `.ocr/sessions/{id}/graph-context.md` SHALL 被写入
- **AND** `.ocr/sessions/{id}/graph-context.json` SHALL 被写入

#### Scenario: Graph context prefers changed symbols over changed files

- **GIVEN** workflow 已获得 canonical changed files
- **AND** 系统可以读取对应的 git diff ranges
- **WHEN** graph context 生成 changed nodes
- **THEN** 系统 SHALL 记录 `changedRanges`
- **AND** 系统 SHALL 优先选择与 changed ranges 重叠的非 File graph symbols 作为 `changedNodes`
- **AND** `changedFiles` SHALL 继续保留为 canonical workflow 输入

#### Scenario: Graph context falls back when changed symbol mapping is unavailable

- **GIVEN** workflow 已获得 canonical changed files
- **AND** git diff ranges 不可用，或 ranges 未命中任何 graph symbols
- **WHEN** graph context 生成 changed nodes
- **THEN** 系统 SHALL 回退为 file-level changed nodes
- **AND** graph context SHALL 记录 warning 说明发生了精度降级
- **AND** warning SHOULD 区分 `diff_unavailable`、`range_no_overlap`、`parser_coverage_insufficient` 等原因

#### Scenario: Graph context emits explainable test gaps

- **GIVEN** workflow 已获得 changed nodes 和 graph edges
- **WHEN** graph context 计算 `testGaps`
- **THEN** 系统 SHALL 输出可解释的 test gap 列表，而不是仅基于 `TESTED_BY` 边是否存在做布尔判断
- **AND** 每个 test gap SHALL 至少包含 gap 类型和原因说明
- **AND** gap 类型 SHALL 支持 symbol-level、file-level、flow-level 三类缺口

#### Scenario: Graph unavailable

- **GIVEN** 图谱缺失、stale、解析失败或查询失败
- **WHEN** review 或 map workflow 运行
- **THEN** workflow SHALL 继续执行
- **AND** graph context artifact SHALL 记录 warning

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

