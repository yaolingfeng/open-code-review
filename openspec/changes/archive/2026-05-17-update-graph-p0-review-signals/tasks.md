# Tasks: Update Graph P0 Review Signals

## 1. OpenSpec

- [x] 1.1 创建 `update-graph-p0-review-signals` change 目录
- [x] 1.2 编写 `proposal.md`、`design.md`、`tasks.md`
- [x] 1.3 编写 spec deltas：`code-graph`、`context-discovery`、`review-orchestration`、`review-map`
- [x] 1.4 运行 `openspec validate update-graph-p0-review-signals --strict`

## 2. Test Gap Signal Quality

- [x] 2.1 梳理 `TESTED_BY` 边的现有生成与查询路径（`packages/shared/graph/src/storage/`）
- [x] 2.2 设计 `findTestGaps()` 的缺口分类规则：symbol-level / file-level / flow-level / no-gap
- [x] 2.3 为 `findTestGaps()` 输出结构添加 `gapType` 和 `reason` 字段
- [x] 2.4 补充单元测试覆盖 symbol-level / file-level / flow-level / no-gap 场景
- [x] 2.5 更新 `graph-context.json` 的 test gap 输出格式

## 3. Auto-incremental Update Behavior

- [x] 3.1 在 `context-discovery` spec 中明确 review/map phase transition 的 auto-update 要求
- [x] 3.2 在 `code-graph` spec 中新增 workflow-triggered incremental update scenario
- [x] 3.3 评估 git hook 作为增强路径的接入点（不作为必需路径）
- [x] 3.4 为 auto-update failure 不阻塞 workflow 的场景补充集成测试
- [x] 3.5 更新 `stateTransition()` 中的 auto-update boundary documentation

## 4. Changed Symbol Precision

- [x] 4.1 梳理 `git diff range` → symbol overlap → fallback 的完整路径
- [x] 4.2 为 `analyzeChangedSymbols()` 定义 warning 分类：`diff_unavailable` / `range_no_overlap` / `parser_coverage_insufficient`
- [x] 4.3 为 `graph-context.json` 添加 `precision` 字段：`symbol-level` / `file-level` / `unknown`
- [x] 4.4 补充单元测试覆盖：复杂 diff / range miss / unsupported file type / fallback chain
- [x] 4.5 更新 `graph-context.md` 的 changed symbols 输出，说明精度等级和 warning

## 5. Verification

- [x] 5.1 运行 `openspec validate update-graph-p0-review-signals --strict`
- [x] 5.2 验证 `packages/shared/graph` 单元测试（`graph.test.ts`）全部通过
- [x] 5.3 验证 `packages/cli/src/lib/state/__tests__/state.test.ts` 中 review/map transition 自动 graph context 生成不被破坏
- [x] 5.4 用真实 session 目录验证 `graph-context.md/json` 在 review/map 仍能 best-effort 产出

## Dependencies

- 任务 2、3、4 相互独立，可并行执行
- 任务 5 依赖任务 2、3、4 完成后执行
