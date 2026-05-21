# Design: Update Graph P0 Review Signals

## Context

### Current State

OCR 的 graph engine 已从 `add-code-review-graph-context` change 落地基础能力，但仍存在以下缺口：

1. **Test gap 计算**：`findTestGaps()`（`packages/shared/graph/src/context/context.ts:160`）当前仅判断 changed symbol 是否存在 `TESTED_BY` 边。没有缺口分类、没有 symbol-level vs file-level 区分、没有 flow-level 信号。

2. **Auto-incremental update**：虽然 `generateGraphContext()` 在生成 artifact 前会 best-effort 调用 `updateGraph()`（`packages/shared/graph/src/context/context.ts:30`），且 `stateTransition()` 在 review/map phase transition 时也会触发 graph context 生成（`packages/cli/src/lib/state/index.ts:85`），但尚未形成明确的规范说明何时应触发增量更新、何时应降级。

3. **Changed symbol 精度**：`analyzeChangedSymbols()`（`packages/shared/graph/src/analysis/changes.ts:13`）基于 `git diff --unified=0` + range overlap + file-level fallback，但 fallback warning 缺少分类（diff unavailable / range no-overlap / parser coverage insufficient），影响精度可解释性。

### Reference Architecture

```
packages/shared/graph
  context/context.ts   -> generateGraphContext(), findTestGaps()
  analysis/changes.ts  -> analyzeChangedSymbols(), getChangedRanges()
  indexer/indexer.ts   -> updateGraph(), getChangedFiles()
  storage/             -> GraphStore, edges model
```

```
packages/cli/src/lib/state/index.ts
  stateTransition()    -> review/map phase transition triggers graph context
```

## Goals / Non-Goals

**Goals**:
- 提高 graph context 作为 review/map 信号的可信度和可解释性
- 保持现有 CLI surface，不引入新的必需命令
- 保持 graceful degradation，不让 graph 阻塞 workflow
- 明确增量更新的触发策略与降级边界

**Non-Goals**:
- 不新增 MCP server
- 不做 semantic search / embeddings / community detection
- 不扩语言集
- 不引入 dashboard 新页面
- 不重写 `add-code-review-graph-context` 的基础设计

## Decisions

### D-1: Test gap 从"无边"升级为可解释缺口分类

**Decision**: Test gap 继续复用 `TESTED_BY` 边作为基础事实源，但在 graph context 输出中补充可解释的缺口分类：

- **Symbol-level gap**：changed symbol 没有 `TESTED_BY` 边
- **File-level gap**：changed symbol 有 file-level test 命中，但没有 symbol-level test 命中
- **Flow-level gap**：changed symbol 位于高风险 flow（被高频调用 / 处于关键路径），但没有对应 test signal
- **No gap**：存在 `TESTED_BY` 边且覆盖充分

**Rationale**: 当前 `GraphStore` / edges 模型已支持 `TESTED_BY` 边，只需在 `findTestGaps()` 的输出结构中增加分类维度和原因说明，而不是重造 schema。

### D-2: Auto-incremental update 以 workflow trigger 为主路径

**Decision**: 将 workflow phase transition 触发 graph context 生成作为主路径，在 spec 中明确：

- review/map 在 `change-context` / `map-context` 时 SHALL attempt incremental graph update
- auto-update failure SHALL NOT block workflow
- git hook 作为可选增强路径，不设为唯一必需路径

**Git hook evaluation**:

- hook 可以作为未来的可选预热路径，在开发者进入 workflow 前提前刷新图谱
- 但 hook 安装状态、执行环境、跨平台行为与仓库权限都不稳定，不能承担规范中的唯一触发责任
- 因此本次 P0 仍以 phase transition 上的 best-effort auto-update 作为唯一必需路径，hook 仅保留为后续增强候选

**Rationale**: `stateTransition()` 中已有的 phase transition 挂点已稳定，无需引入新的触发机制。hook 安装成功率不可控。

### D-3: Changed symbol 精度增强优先复用现有 pipeline

**Decision**: 保持 `git diff --unified=0` → `parseUnifiedDiffRanges()` → overlap 的主链路，补充：

- 更明确的 range 命中策略：优先非 File symbol，再 File symbol
- Fallback warning 分类：
  - `diff_unavailable`：git diff 不可读或为空
  - `range_no_overlap`：ranges 未命中任何 graph symbol
  - `parser_coverage_insufficient`：文件类型不在 parser 覆盖范围内
- 精度标记：`symbol-level` / `file-level` / `unknown`

**Rationale**: 当前 `packages/shared/graph/src/analysis/changes.ts` 已有良好骨架，可在现有函数上扩展，而不是替换整个 pipeline。

## Risks / Trade-offs

- **Risk**: Test gap 分类依赖 `TESTED_BY` 边质量，若边缺失或错误，会导致分类不准。
  - **Mitigation**: 在 graph context 输出中包含 `confidence` 字段，标记 gap 分类的可信度。

- **Risk**: 增量更新在大型仓库中可能慢。
  - **Mitigation**: `updateGraph()` 已支持增量解析；在 spec 中明确 "best-effort" 策略，失败时降级。

## Open Questions

- Q1: Flow-level test gap 是否需要引入新的边类型（如 `CALLS` 链分析），还是复用现有 `DEPENDS_ON` 边计算？

  **Current approach**: 复用现有 edges，通过调用深度和关键路径标记高风险 symbol，暂不引入新边类型。

- Q2: Auto-update 是否需要 graph staleness check（如 "超过 N 小时才触发 update"）？

  **Current approach**: 暂不在 spec 中要求 staleness check；在 `updateGraph()` 实现中评估性能后再决定。

## Migration Plan

1. 先更新 spec delta（本次产出）
2. 再按 `tasks.md` 实现 `findTestGaps()` 分类、`analyzeChangedSymbols()` warning 分类、auto-update 边界说明
3. 补充单元测试
4. 用真实 session 验证 graph context 质量提升

No breaking changes. All changes are additive to existing behavior.