## 1. OpenSpec

- [x] 1.1 创建 `add-graph-review-exploration` 变更目录，包含 proposal、design、tasks 和 spec deltas
- [x] 1.2 为 `code-graph`、`cli`、`dashboard` 和 `review-orchestration` 添加 spec deltas
- [x] 1.3 运行 `openspec validate add-graph-review-exploration --strict`
- [x] 1.4 对齐高 CPU 防护涉及的 spec 范围：为 `context-discovery` / `review-map` 增加 read-only graph consumption 的 spec delta，或明确这些 workflow 通过 shared `code-graph` requirement 继承该行为

## 2. Shared Graph 基础能力

- [x] 2.1 为 searchable node/file 字段增加 graph DB search-index schema 与迁移
- [x] 2.2 定义 indexed search 使用的 normalized signature token 规则，不要求支持原始长 signature 的高保真检索
- [x] 2.3 在 full graph build 和 incremental update 中维护 search-index rows
- [x] 2.4 定义 `GraphSearchResult` schema、状态枚举和 shared query API
- [x] 2.5 增加覆盖 search indexing、update consistency、bounded result size 和 degraded states 的测试
- [x] 2.6 增加明确的 FTS5 schema / capability 规划说明，避免把已完成的 search-index 基础能力误认为 9.2 中仍待完成的 FTS5 默认查询路径

## 3. Review Analysis 聚合

- [x] 3.1 定义 `GraphReviewAnalysis` shared types、状态枚举和 JSON schema
- [x] 3.2 定义 session/changed-set scoped review analysis 的生成时机和 artifact 生命周期
- [x] 3.3 实现 summary-first 聚合，突出 review order、boundary crossing、coupling hotspots、weakly connected changes 和 drilldown entry points
- [x] 3.4 仅在能提供增量 reviewer 价值时复用已有 graph-context signals，避免重新包装完整 raw context
- [x] 3.5 增加 deterministic 且可解释的 hints，覆盖 boundary crossing、coupling hotspots、weakly connected changes 和 suggested review order
- [x] 3.6 增加 token-budget guardrails，例如 `maxNodes`、`maxHints`、`maxModules`，并输出 truncation markers
- [x] 3.7 增加覆盖稳定输出形状和 graceful degradation 路径的测试

## 4. Architecture / Module Grouping

- [x] 4.1 基于目录、文件和 edge signals 实现 lightweight touched-module grouping
- [x] 4.2 计算 cross-group coupling、bridge files 和 bridge symbols
- [x] 4.3 为 changed sets 生成 architecture summary output
- [x] 4.4 增加覆盖 module grouping heuristics 和 explainability 的测试

## 5. CLI Surface

- [x] 5.1 增加 `ocr graph search`，支持 human-readable 和 `--json` 输出
- [x] 5.2 增加 `ocr graph review-analysis`，支持 human-readable 和 `--json` 输出
- [x] 5.3 在 CLI 结果中暴露 `ready | missing | stale | degraded | error` 状态
- [x] 5.4 为 search 和 review-analysis 命令支持 bounded result controls 与 truncation markers
- [x] 5.5 对 missing/stale/degraded 状态返回受控结果，不抛出未处理错误
- [x] 5.6 增加覆盖 search、review-analysis 和 degraded graph states 的 CLI 测试

## 6. Dashboard Surface

- [x] 6.1 增加 graph search 和 review-analysis server routes
- [x] 6.2 增加带 query input 与 structured result list 的 graph search UI
- [x] 6.3 增加 review analysis panel，展示 summary-first priorities、hints 和 module summaries
- [x] 6.4 增加按需展开 summary payload 之外内容的 drilldown UX
- [x] 6.5 在 graph UI 中展示可读的 missing/stale/degraded states
- [x] 6.6 增加 dashboard API 和 UI 测试，覆盖新的 exploration surfaces

## 7. Review Workflow 集成

- [x] 7.1 更新 review orchestration consumption，使 Tech Lead 和 reviewers 可以消费 `GraphReviewAnalysis` 以及 raw graph context
- [x] 7.2 默认注入 summary-first graph review analysis，更深层 detail 仅按需获取
- [x] 7.3 保留原则：graph outputs 只是 investigation context，不是 authoritative findings 或 verdicts
- [x] 7.4 验证现有 `graph-context` artifact contract 未被破坏

## 8. Verification

- [x] 8.1 验证 full build 和 incremental update 会维护 FTS/search data
- [x] 8.2 验证 search 和 review-analysis 对 `ready | missing | stale | degraded | error` 的显式状态处理
- [x] 8.3 验证 `ocr graph search --json` 和 `ocr graph review-analysis --json`
- [x] 8.4 验证 dashboard summary-first search UI、analysis panel、drilldown 和 degraded-state UX
- [x] 8.5 验证 graph search/analysis missing、stale、degraded 或 partially unsupported 时 review workflows 仍会继续

## 9. 高 CPU 与 Full-Scan Hardening

### 9.1 阻止 review/dashboard 触发重型 graph 工作

- [x] 9.1.1 将 `generateGraphContext()` 默认改为 read-only：review/map context generation 期间 SHALL NOT 调用 `updateGraph()`；stale graph SHALL 返回 stale warning，并提示显式运行 `ocr graph update` 或 `ocr graph build --full`
- [x] 9.1.2 为手动 CLI 使用增加显式 opt-in update 路径，例如 `ocr graph context --update`，同时确保 review/map workflows 永远不会传入该选项
- [x] 9.1.3 更新 review workflow 文档和 bundled agent references，明确 review orchestration 期间 graph context 和 review analysis 都是 read-only
- [x] 9.1.4 修改 dashboard Graph Exploration：打开页面时优先渲染已有 `graph-context` / `graph-review-analysis` artifacts，不自动触发 live analysis
- [x] 9.1.5 增加显式 dashboard “reanalyze” 操作，只在用户明确意图后请求 fresh graph review analysis
- [x] 9.1.6 确保 dashboard review-analysis 请求默认 `maxModules=0`，module summaries 只能通过显式 advanced option 启用
- [x] 9.1.7 为 `/api/graph/review-analysis` 增加 single-flight、timeout、cancellation 和 short-lived cache，避免 refresh 或多个 panel 并发运行 high-CPU `better-sqlite3` analysis
- [x] 9.1.8 确保 `/api/graph/review-analysis` 不在 Express request path 内直接运行不可取消的同步分析；fresh analysis 应使用 worker/subprocess 或等价 hard cancellation boundary

### 9.2 降低 Hot SQL 与 Graph Traversal 成本

- [x] 9.2.1 为 `graph_flow_nodes(node_qualified)` 增加 SQLite index，优化 `flowsForNodes()` lookup
- [x] 9.2.2 为 graph edge traversal 增加 composite SQLite indexes：`(source_qualified, kind, line)`、`(target_qualified, kind, line)` 和 `(file_path, kind)`
- [x] 9.2.3 增加 node/file search fields 的 FTS5 virtual table schema 和 migration
- [x] 9.2.4 将默认 graph search 替换为 FTS5 table path；仅在 FTS5 不可用或 migration 未运行时保留现有 JavaScript scoring fallback
- [x] 9.2.5 增加 FTS5 capability detection 和 controlled fallback warning，避免假设所有 packaged SQLite build 都支持 FTS5
- [x] 9.2.6 重写 `moduleBridgeSummaries()`，默认 analysis 不得执行 per-edge correlated target-file subqueries；改用 precomputed target module data，或在未显式请求时跳过 module bridge summaries
- [x] 9.2.7 先用 batched frontier query 替换 impact-radius 的 N+1 traversal queries；recursive CTE 仅在 correctness 和 performance benchmark 通过后作为后续优化
- [x] 9.2.8 在 flow rebuild 中用 indexed name/file maps 替换 linear flow target fallback lookups
- [x] 9.2.9 在 Node resolver 中缓存 nearest package.json lookup results，避免 repeated import resolution 为每条 edge 重读相同 package metadata

### 9.3 将 Full Derived Computation 移到显式 Build/Update 路径

- [x] 9.3.1 扩展 graph update result，增加 `filesRemoved` 和派生的 `filesChanged` signal，确保 deleted files 能触发必要 postprocessing
- [x] 9.3.2 增加 graph postprocess levels：`none` 只更新 files/nodes/edges，`minimal` 额外更新 search rows，`full` 才重建 flows/module/risk summaries
- [x] 9.3.3 通过 CLI contract 暴露 graph postprocess levels，例如 `ocr graph update --postprocess none|minimal|full`；定义安全默认值，例如 review context 为 read-only、`graph update` 默认 `minimal`、显式 full build/postprocess 使用 `full`
- [x] 9.3.4 review-phase graph analysis 必须使用 read-only/no-postprocess 行为；review 期间 SHALL NOT 运行 full search-index rebuild 或 full flow rebuild
- [x] 9.3.5 修改 `rebuildSearchIndex()`，支持 changed-file incremental maintenance；full-table rebuild 仅保留给 explicit full build 或 explicit full postprocess
- [x] 9.3.6 修改 `rebuildFlows()`，支持 incremental affected-flow rebuild；当 graph 过大或 affected entries 无法界定时，跳过 full rebuild 并标记 flow summaries stale，不阻塞 review
- [x] 9.3.7 确保 `updateGraph()` 只有在 `filesIndexed > 0`、`filesErrored > 0` 或 `filesRemoved > 0` 时才运行 postprocessing

### 9.4 Product、Operations 与 Benchmark Guardrails

- [x] 9.4.1 在 structured output 或 progress state 中记录 graph analysis progress phases、current step 或 SQL class、elapsed time、node/edge counts 和 truncation reason
- [x] 9.4.2 让 dashboard cancellation 真正停止 graph analysis work，使用 abortable worker/subprocess path 或等价 hard cancellation boundary
- [x] 9.4.3 为 CLI 和 dashboard routes 增加 CPU-risk guards：large graphs 搭配 `maxModules > 0`、deep traversal 或 full postprocess 时 SHALL 要求显式确认，或自动降级到 safe defaults
- [x] 9.4.4 增加 pangu-level performance benchmarks，并设置具体 latency thresholds：`graph status` 应在 2s 内完成，`review-analysis maxModules=0` 在 10s 内完成，indexed `search` 在 2s 内完成，bounded `impact radius` 在 5s 内完成，dashboard cached/single-flight analysis response 在 10s 内完成，cancellation 应在用户 cancel 后 2s 内停止底层 graph analysis
  - 验收记录：在 `/Users/yaojunchao/code-review-workspace/pangu` 上使用 214MB graph DB（2930 indexed files、16717 nodes、212732 edges）验证；`graph status` 1.02s，CLI `review-analysis --workflow review --base master --max-modules 0` 2.22s，indexed `search repay` 1.15s，bounded `impact --depth 2` 2.03s，dashboard fresh analysis 1.512s，dashboard cached analysis 3ms，dashboard single-flight pair 453ms，dashboard timeout/cancellation boundary 10ms 返回 504。
  - Review smoke：通过 dashboard socket 启动 `review master --fresh --team principal:1`，约 154s 时已生成/读取 `graph-context.md` 与 `graph-context.json` 并继续进入源码路径分析；dashboard CPU 约 3.5%、Claude 子进程约 19%，未复现 graph DB 高 CPU 卡死。为避免完整 AI review 继续消耗，180s 主动取消该 smoke run。
- [x] 9.4.5 增加 benchmark assertions，确认默认 graph exploration 不会使用 JS full-table search scoring、full search-index rebuild、full flow rebuild 或 module bridge summary queries，除非用户显式请求
- [x] 9.4.6 文档化 `ocr review --fresh` 不会 rebuild 或 update graph；graph refresh 必须显式运行 `ocr graph update` 或 `ocr graph build --full`
