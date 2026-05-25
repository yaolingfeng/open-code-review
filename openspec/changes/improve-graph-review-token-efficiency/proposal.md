# Change: Make Graph the Default Review Navigation Layer

## Why

OCR 已经通过 `add-graph-review-exploration` 建立了可用的图谱探索基础：
`graph-context.md/json`、`graph-review-analysis.json`、FTS search、impact
radius、reviewer hints、Dashboard exploration，以及 review 阶段 read-only 的性能
保护。

但当前图谱能力还没有稳定转化成 OCR 的核心产品收益。问题不在于 graph
“不够强”，而在于 graph 还没有成为 review workflow 的默认导航层：默认注入仍然
偏长，reviewer 仍然容易回到无方向的 `Read/Grep/Bash`，而系统也缺少足够直接的
对比手段来证明 graph 是否真的减少了 token 和盲搜。

本变更只聚焦一个核心目标：

- **让 graph 从“可查看的 artifact”变成“review 的默认入口与导航层”**

围绕这个目标，首发只验证三个产品收益：

- **更少 token**：默认只注入极短、可行动的 graph summary，而不是完整 graph
  artifact。
- **更少盲搜**：reviewer 优先沿着 graph 给出的下一步建议探索，而不是先做 broad
  source reads。
- **更稳定的 review 质量**：graph 负责缩小调查范围，但 finding 仍必须回到源码、
  diff、测试或运行证据。

## What Changes

### P0: 首发范围（必须）

- **新增 minimal graph context**：提供 `ocr graph minimal-context` 与 shared API，
  输出短小且可行动的 summary、top priorities、key warnings 和 next tool
  suggestions。review workflow 默认优先注入该摘要，而不是完整 `graph-context.md`
  或完整 `graph-review-analysis`。
- **新增结构化 next tool suggestions**：为 minimal-context、search、query、impact
  和 review-analysis 输出少量、确定性、去重后的下一步建议，优先把 reviewer 引导到
  bounded graph query 或按需源码验证，而不是整文件读取。
- **收缩 workflow 默认注入策略**：Tech Lead 和 reviewer 默认只收到 minimal graph
  context + top hints；完整 graph artifacts 继续保留，但只作为按需参考或 drill-down
  入口。
- **新增 usage compare 最小闭环**：提供 `ocr usage compare`，比较 baseline session
  与 graph-enabled session 的 token、cost、row_count，以及基础的 `Read/Grep/Bash` 与
  `ocr graph *` 调用差异，用于验证 graph 是否真正减少了 broad exploration。
- **新增 quality guardrails**：graph 输出只能作为调查线索；任何 finding 仍必须引用
  源码、diff、测试或运行证据。token 降低不能以 review 变浅为代价。

### P1: 首发后的增强（应该）

- **新增 bounded graph review context**：提供 `ocr graph review-context`，先聚焦
  changed symbols 和 top impacted symbols 的小范围源码片段提取，作为按需证据收集
  工具，而不是默认注入内容。
- **增强 exploration telemetry**：在 usage compare 中补充更完整的 broad exploration
  与 graph-guided exploration 指标，在 P0 基础调用计数之外提供更丰富的调查路径信号，
  帮助判断 reviewer 是否真的改变了调查路径。
- **增强 dashboard 展示**：Dashboard 展示 minimal context、next suggestions 和 usage
  comparison artifact，但不阻塞 P0 落地。

### 明确不在首发范围内

- semantic/vector search
- multi-repo registry
- MCP server
- dead-code / refactor apply
- wiki generation
- 复杂大图可视化
- 追平 `code-review-graph` 全部平台能力
- 把 `review-context` 一次性扩展到所有 flow / test-gap / 大规模 snippet merge 场景

## Product Acceptance Criteria

本变更的成功标准不是“新增了更多 graph 功能”，而是 graph 是否真正改变了 OCR 的
review 默认路径。

P0 验收时应至少满足：

- **默认注入收缩**：review workflow 默认不再注入完整 graph artifacts，而是注入
  bounded minimal graph context。
- **探索行为改善**：在同 diff、同 model、同 reviewer team 的比较下，graph-enabled
  workflow 的 `Read/Grep/Bash` broad exploration 中位数下降，或更早被 graph-guided
  exploration 替代。
- **token 成本改善**：graph-enabled workflow 的 total token、cost 或等价成本指标出现
  可解释的改善；若 input tokens 上升，也必须由更少的盲搜或更低的 total tokens 抵消。
- **质量不下降**：blocker / should-fix 发现质量不下降；findings 继续保持源码、diff、
  测试或运行证据引用。

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
- **Performance guardrails**: minimal-context、next suggestions 和首发版
  review-context 必须 bounded，不得触发 graph update/build、full search-index rebuild、
  full flow rebuild 或昂贵 module summary 计算。
- **Token budget guardrails**: workflow 默认注入内容必须可控；完整 graph artifacts 只能
  作为 artifact 或按需 drill-down，不得默认塞入 reviewer prompt。
- **Quality guardrails**: token 降低必须与 review 质量一起衡量；任何 graph-derived
  finding 都必须经过源码、diff、测试或运行证据验证。

