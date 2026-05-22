# Change: Update Graph P0 Review Signals

## Why

OCR 已有基础 graph context 能力（来自已归档的 `add-code-review-graph-context`），但当前 review/map 仍存在三类信号质量问题：

1. **Test gap 过粗**：`findTestGaps()` 目前仅判断 changed symbol 是否存在 `TESTED_BY` 边，无法区分 symbol-level / file-level / flow-level 缺口，导致 review prioritization 和 risk 可信度不足。

2. **增量更新缺少明确触发策略**：`generateGraphContext()` 在生成 artifact 前会 best-effort 调用 `updateGraph()`，`stateTransition()` 在 review/map phase transition 时也会触发 graph context 生成，但尚未形成明确的"自动增量更新策略/触发约束"提案，导致 behavior 不够可预期。

3. **Changed symbol 精度不足**：`analyzeChangedSymbols()` 基于 `git diff --unified=0` 和 range overlap，精度降级到 file-level 时缺少可解释的 warning 分类，影响 map topology 和 reviewer guidance 的准确性。

这些问题会直接影响 reviewer prioritization、risk 可信度、以及 graph context 的稳定性。

## What Changes

- **强化 graph context 的 test gap 计算与展示语义**：从“无 `TESTED_BY` 边=有缺口”升级为可解释的缺口分类（symbol-level / file-level / flow-level），并补充场景示例与测试覆盖信号。

- **明确 review/map/context-discovery 阶段的自动增量更新行为与 graceful degradation**：在 `context-discovery` spec 中明确 review/map 触发 graph context 生成时的 auto-update 行为；在 `code-graph` spec 中新增 workflow-triggered incremental update scenario。

- **提升 changed symbol 分析精度，并规范 fallback/warning 行为**：在 `code-graph` spec 中补充 range 命中策略和 fallback warning 分类；在 `review-orchestration` / `review-map` spec 中补充 changed symbol 精度信号的使用要求。

## Impact

- **Affected specs**: `code-graph` (MODIFIED), `context-discovery` (MODIFIED), `review-orchestration` (MODIFIED), `review-map` (MODIFIED)
- **Affected code**: `packages/shared/graph/src/context/context.ts`, `packages/shared/graph/src/analysis/changes.ts`, `packages/cli/src/lib/state/index.ts`
- **Non-affected specs**: `cli` (本次不新增 CLI surface)、`dashboard` (本次不新增 UI 功能)
- **Breaking changes**: 无。本次是补强已有 graph capability 的信号质量，不改变现有 CLI 命令或 workflow phase 结构。