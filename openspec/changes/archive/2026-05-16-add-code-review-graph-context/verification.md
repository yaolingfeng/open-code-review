# 验证记录

## 2026-05-16：补齐 orchestration 自动调用点

本次检查发现，原实现中 `generateGraphContext` 只有 `ocr graph context` 手动命令和 workflow 文档调用点，缺少核心 runtime/orchestration 中的直接调用。

已补充 `stateTransition` 级自动触发：

- review workflow 进入 `change-context` 时，best-effort 生成 `graph-context.md` 和 `graph-context.json`。
- map workflow 进入 `map-context` 时，best-effort 生成 `graph-context.md` 和 `graph-context.json`。
- graph DB 缺失、git 信息不可用或 graph 解析失败时，不阻塞 state transition。

已执行验证：

- `pnpm exec vitest run packages/cli/src/lib/state/__tests__/state.test.ts`
- `pnpm exec nx build cli`
- `pnpm exec vitest run --config packages/cli-e2e/vitest.config.ts packages/cli-e2e/src/workflow-graph-context.test.ts`

补充说明：workflow e2e 同时覆盖了无 graph DB 时的 missing artifact 与有 graph DB 时 review/map 自动生成 ready `graph-context.md/json`。
