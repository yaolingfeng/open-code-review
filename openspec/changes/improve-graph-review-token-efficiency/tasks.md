## 1. OpenSpec

- [x] 1.1 创建 `improve-graph-review-token-efficiency` 变更目录，包含 proposal、design、tasks 和 spec deltas
- [x] 1.2 为 `code-graph`、`cli`、`dashboard`、`review-orchestration`、`session-management` 添加 spec deltas
- [x] 1.3 运行 `openspec validate improve-graph-review-token-efficiency --strict`

## 2. Minimal Graph Context

- [ ] 2.1 定义 `GraphMinimalContext` shared type、预算字段和 degraded status 语义
- [ ] 2.2 实现 `generateGraphMinimalContext()`，复用 graph status、changed symbols、review priorities、test gaps 和 warnings
- [ ] 2.3 为 minimal context 增加 bounded output guardrails：top priorities、warnings 和 suggestions 均需上限
- [ ] 2.4 增加 `ocr graph minimal-context --workflow review|map --files ... --json`
- [ ] 2.5 增加 ready/missing/stale/degraded 状态测试和 token/size budget 测试

## 3. Bounded Review Context

- [ ] 3.1 定义 `GraphReviewContext` shared type，包含 snippets、line ranges、reason、budget 和 truncation
- [ ] 3.2 基于 changed ranges / changed symbols 抽取 changed source snippets
- [ ] 3.3 基于 high-priority impacted symbols 抽取 impacted source snippets
- [ ] 3.4 基于 test gaps 抽取待验证函数或 flow entry snippets
- [ ] 3.5 实现 snippet 合并与去重，避免同文件相邻片段重复输出
- [ ] 3.6 增加 `ocr graph review-context --workflow review|map --files ... --max-lines-per-snippet ... --json`
- [ ] 3.7 增加大文件、unsupported files、missing graph、truncated snippets 的测试

## 4. Next Tool Suggestions

- [ ] 4.1 定义 `NextToolSuggestion` shared type
- [ ] 4.2 为 graph search 输出 follow-up query/test/source-grounding suggestions
- [ ] 4.3 为 graph query 输出 callers/callees/tests/review-context 的下一步建议
- [ ] 4.4 为 impact、review-analysis、minimal-context 和 review-context 输出 next suggestions
- [ ] 4.5 更新 CLI human-readable 输出，简洁展示建议命令和原因
- [ ] 4.6 增加稳定排序和去重测试

## 5. Review Workflow 集成

- [ ] 5.1 更新 bundled agent workflow references：默认读取 minimal graph context，而不是完整 graph artifacts
- [ ] 5.2 Tech Lead analysis 阶段仅注入 minimal context + top hints，并把完整 graph artifacts 作为按需参考
- [ ] 5.3 Reviewer task prompt 增加“先用 nextToolSuggestions，再按需 review-context”的探索规则
- [ ] 5.4 明确 graph review-context 是调查辅助，finding 仍必须引用源码、diff、测试或运行证据
- [ ] 5.5 验证没有 graph DB 或 graph stale 时，workflow graceful degradation 行为不变

## 6. Usage Compare 与 Telemetry

- [ ] 6.1 定义 `UsageComparison` 输出结构
- [ ] 6.2 实现 `ocr usage compare --baseline <workflow> --candidate <workflow> --json`
- [ ] 6.3 比较 summary token 字段：total/input/output/cache/reasoning/cost/row_count
- [ ] 6.4 从 event JSONL 中统计 `Read`、`Grep`、`Bash` 和 `ocr graph *` 调用数
- [ ] 6.5 当 usage rows 缺失、只有 total、或 event JSONL 不完整时输出 caveats
- [ ] 6.6 增加 usage compare 单元测试和 fixture

## 7. Dashboard

- [ ] 7.1 Dashboard graph panel 展示 minimal context summary 和 next suggestions
- [ ] 7.2 Dashboard 支持按需请求 review-context snippets
- [ ] 7.3 Token Usage 卡片增加 compare 入口或展示 comparison artifact
- [ ] 7.4 对 total-only usage、missing rows、event telemetry missing 输出可读 caveat
- [ ] 7.5 增加 UI 测试覆盖 minimal context、review-context 和 usage compare states

## 8. Benchmark 与文档

- [ ] 8.1 新增 graph token efficiency benchmark 文档：同 diff、同 model、同 team、3-5 轮中位数
- [ ] 8.2 定义推荐验收阈值：median total tokens 降低、Read/Grep/Bash 调用下降、review 质量不下降
- [ ] 8.3 增加 benchmark fixture，覆盖 graph-enabled 与 graph-missing 两种 session
- [ ] 8.4 文档化如何解读 input tokens 上升但 total tokens 下降的情况
- [ ] 8.5 文档化质量抽查清单，防止 token 降低来自 review 变浅

## 9. Verification

- [ ] 9.1 `pnpm exec vitest run --config packages/shared/graph/vitest.config.ts`
- [ ] 9.2 `pnpm exec vitest run --config packages/cli/vitest.config.ts`
- [ ] 9.3 `pnpm exec vitest run --config packages/dashboard/vitest.config.ts`
- [ ] 9.4 在一个中型仓库上手动验证 `minimal-context`、`review-context` 和 `usage compare`
- [ ] 9.5 记录 token efficiency benchmark 示例输出
