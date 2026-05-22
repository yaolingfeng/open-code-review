# Change: Improve Graph Review Token Efficiency

## Why

OCR 已经通过 `add-graph-review-exploration` 建立了可用的图谱探索基础：
`graph-context.md/json`、`graph-review-analysis.json`、FTS search、impact
radius、reviewer hints、Dashboard exploration，以及 review 阶段 read-only 的性能
保护。

但当前图谱能力距离 `code-review-graph` 的核心产品收益还差最后一段：图谱已经
“能被看到”，但还没有系统性地把 reviewer 从盲目 `Read/Grep/Bash` 中解放出来。
如果默认注入仍偏长、reviewer 仍要整文件阅读、graph query 结果缺少下一步建议、
并且没有 token A/B 评测闭环，那么图谱很容易变成额外上下文，而不是稳定减少
token 的工作流能力。

本变更聚焦三个产品收益：

- **更少 token**：默认只注入极短 graph summary，把详细图谱、源码片段和 drilldown
  改为按需获取。
- **更少盲搜**：用 graph-native next step suggestions 和 bounded review context
  替代无方向的 `Read/Grep/Bash` 探索。
- **更稳定的 review 质量**：通过 source-grounded snippets、质量门控和 usage compare
  确保 token 降低不是因为 review 变浅。

## What Changes

- **新增 minimal graph context**：提供 `ocr graph minimal-context` 与对应 shared API，
  输出 100-300 token 级别的 summary、top priorities、test gap count、warnings 和
  recommended next graph queries。review workflow 默认优先注入该摘要，而不是完整
  `graph-context.md` 或完整 `graph-review-analysis`。
- **新增 bounded graph review context**：提供 `ocr graph review-context`，从 changed
  symbols、high-priority impacted symbols、test gaps 和 affected flows 中提取小范围
  源码片段，替代 reviewer 整文件读取。输出必须带 line ranges、source grounding、
  truncation markers 和 token/line budget。
- **新增 next tool suggestions**：为 graph search、query、impact、minimal-context、
  review-analysis、review-context 输出结构化 `nextToolSuggestions`，明确建议的下一步
  graph query 或源码验证动作，减少 reviewer 自行猜测探索路径。
- **收缩 workflow 默认注入策略**：Tech Lead 和 reviewer 默认只收到 minimal graph
  context + 少量 top hints；完整 `graph-context`、完整 analysis drilldown 和源码片段
  只能按需读取或通过明确命令获取。
- **新增 token efficiency measurement**：提供 `ocr usage compare`，用于比较 baseline
  session 和 graph-enabled session 的 token、cost、row_count 和分项变化；新增文档化
  benchmark 流程，支持多轮中位数比较。
- **新增 graph review quality guardrails**：定义 token 降低的验收条件：不得降低 blocker /
  should-fix 发现质量；graph findings 仍必须引用源码、diff、测试或运行证据；graph-only
  signal 只能作为调查线索。
- **新增 exploration telemetry**：从 event JSONL 中汇总 reviewer 的 `Read/Grep/Bash`、
  `ocr graph query/search/impact/review-context` 等工具调用数，为“少盲搜”提供可观测
  指标。
- **新增 token budget tests 与 fixtures**：为 minimal-context、review-context 和
  nextToolSuggestions 增加稳定输出、预算上限、truncation 和 degraded graph 状态测试。

## Impact

- **Affected specs**: `code-graph`, `cli`, `dashboard`, `review-orchestration`,
  `session-management`
- **Affected code**:
  - `packages/shared/graph`
  - `packages/cli/src/commands/graph.ts`
  - `packages/cli/src/commands/usage.ts`
  - `packages/dashboard/src/server/routes/graph.ts`
  - `packages/dashboard/src/client/features/graph/*`
  - `packages/dashboard/src/client/features/usage/*`
  - `packages/agents/skills/ocr/references/*`
- **Breaking changes**: 无。现有 `graph-context.md/json` 与 `graph-review-analysis.json`
  继续可用；本变更只改变默认注入偏好和新增更小的上下文入口。
- **Performance guardrails**: minimal-context 和 review-context 必须 bounded，
  不得触发 graph update/build、full search-index rebuild、full flow rebuild 或昂贵
  module summary 计算。源码片段提取必须受文件数、行数、字符数或 token 预算限制。
- **Token budget guardrails**: workflow 默认注入内容必须可控；完整 graph artifacts 只能
  作为 artifact 或按需 drilldown，不得默认塞入 reviewer prompt。
- **Quality guardrails**: token 降低必须与 review 质量一起衡量；任何 graph-derived
  finding 都必须经过源码、diff、测试或运行证据验证。
- **Out of scope**: semantic/vector search、multi-repo registry、MCP server、dead-code /
  refactor apply、wiki generation、复杂大图可视化、追平 `code-review-graph` 全部平台能力。
