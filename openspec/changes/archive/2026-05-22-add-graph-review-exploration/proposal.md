# Change: Add Graph Review Exploration

## Why

OCR 已具备可靠的图谱基础设施：持久化 graph DB、增量更新、impact
radius、changed-symbol precision、lightweight flows、graph context artifacts，
并已接入 review/map 和 dashboard。

但当前图谱能力仍主要停留在“生成上下文”层，缺少 reviewer 和 agent 可直接
消费的图谱原生探索面。结果是图谱虽然能提供 context，却还不能高效支持
review 过程中最关键的几个决策：先看哪里、哪些改动跨越模块边界、哪些文件
可能只是弱相关或潜在无关改动、以及应该按什么顺序理解 changed set。

相较 `code-review-graph`，OCR 当前更现实的下一步不是追求平台化或全量能力
对齐，而是在现有 review 主线上补齐一个务实、渐进、可扩展的 graph review
exploration surface。

## What Changes

- **新增 graph review exploration 能力范围**：以 reviewer UX 为中心，补齐
  graph-native exploration，而不是扩展为完整 graph platform。
- **新增 FTS-first graph search**：在 graph DB 中维护全文搜索索引，优先覆盖
  node name、qualified name、file path、kind，以及仅在稳定可得时纳入的
  normalized signature tokens；不要求把原始长 signature 直接作为高质量检索面。
- **新增 graph review analysis 聚合层**：围绕 search-driven drilldown、review
  order、boundary crossing、coupling hotspot、weakly connected change 等
  reviewer-native hint，生成结构化 `GraphReviewAnalysis` 输出，作为 shared graph
  capability surface 供 CLI、Dashboard 和 review orchestration 共同消费，而不
  是重新包装已有 `graph-context` 字段。
- **新增轻量 architecture/module grouping**：基于目录前缀、文件聚合和边
  连接信号，输出 touched modules、cross-group coupling、bridge
  files/symbols 和 architecture summary。
- **扩展 CLI surface**：新增 `ocr graph search` 与 `ocr graph review-analysis`
  命令；如后续需要再单独提案补 `ocr graph architecture`。
- **扩展 Dashboard surface**：新增 graph search UI、review analysis panel、
  module/architecture summary cards，以及 stale/missing/degraded 状态展示。
- **扩展 review orchestration**：Tech Lead 和 reviewer 可消费 graph review
  analysis 聚合结果，但默认只注入摘要而非完整 exploration payload；reviewer
  需要更深信息时再按需 query。graph 输出仍是调查上下文，不是最终裁决依据。
- **定义明确的状态与生命周期**：统一 graph exploration 状态为
  `ready | missing | stale | degraded | error`，并明确 search、analysis、
  workflow continuation 与 artifact 返回字段在各状态下的行为。
- **新增高 CPU 止血与全表查询防护**：review/map 和 dashboard 默认不得触发
  graph update/build、search-index rebuild、flow rebuild 或 module summary 重查询；
  graph refresh 和重分析必须通过显式用户动作或显式 CLI 参数触发。
- **新增 graph performance guardrails**：为 graph search、impact radius、review
  analysis 和 dashboard exploration 增加索引、缓存、single-flight、超时、取消、
  大库降级和基准测试要求，避免图谱探索拖住主 review 流程。

## Impact

- **Affected specs**: `code-graph`, `cli`, `dashboard`,
  `review-orchestration`
- **Affected code**:
  - `packages/shared/graph`
  - `packages/cli/src/commands/graph.ts`
  - `packages/dashboard/src/server/routes/graph.ts`
  - `packages/dashboard/src/client/features/graph/*`
  - review orchestration graph artifact consumption paths
- **Breaking changes**: 无。graph search、analysis 或 grouping 不可用时，
  review/map 和现有 graph-context 仍必须 graceful degradation；默认 read-only
  graph exploration 可能让 stale 图谱只返回 warning 而不自动刷新，这是有意的
  性能保护。
- **Performance guardrails**: review/map workflow 和 dashboard 默认 SHALL NOT
  触发 graph update/build、全量 search-index rebuild、全量 flow rebuild 或昂贵的
  module bridge summary。fresh analysis 需要显式动作，并应具备 single-flight、
  timeout、cancellation、短期缓存和大库降级。
- **Token budget guardrails**: 本次能力以减少 reviewer 手工探索和无效 token
  消耗为目标；默认只注入摘要，search/analysis 结果 SHALL 支持 limit 类约束，
  不默认向 reviewer 注入完整 search result 或完整 analysis payload。
- **Deferred integration**: `review-map` 不在本次变更范围内；如果后续决定把
  architecture/module grouping 用于 map sectioning，将通过单独 follow-up
  change 提案推进。
- **Out of scope**: semantic/vector search、multi-repo、dead-code/refactor
  analysis、watch/hook 平台、MCP serve、复杂交互式大图可视化。
