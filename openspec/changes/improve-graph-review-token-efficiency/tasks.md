## 1. OpenSpec

- [x] 1.1 创建 `improve-graph-review-token-efficiency` 变更目录，包含 proposal、design、tasks 和 spec deltas
- [x] 1.2 为 `code-graph`、`cli`、`dashboard`、`review-orchestration`、`session-management` 添加 spec deltas
- [x] 1.3 运行 `openspec validate improve-graph-review-token-efficiency --strict`

## 2. P0 — Minimal Graph Context

- [x] 2.1 定义 `GraphMinimalContext` shared type、预算字段和 `ready/missing/stale/degraded` 状态语义
- [x] 2.2 实现 `generateGraphMinimalContext()`，复用 graph status、changed symbols、review priorities、test gaps 和 warnings
- [x] 2.3 为 minimal context 增加 bounded output guardrails：summary、priorities、warnings 和 suggestions 均需上限
- [x] 2.4 增加 `ocr graph minimal-context --workflow review|map --files ... --json`
- [x] 2.5 增加 ready/missing/stale/degraded 状态测试和 token/size budget 测试

## 3. P0 — Structured Next Tool Suggestions

- [x] 3.1 定义 `NextToolSuggestion` shared type，约束建议命令、原因、预期价值和证据要求字段
- [x] 3.2 为 minimal-context 输出少量、稳定排序、去重后的 next suggestions
- [x] 3.3 为 graph search、query、impact 和 review-analysis 输出 next suggestions
- [x] 3.4 约束 suggestions 优先使用 bounded graph query 或 review-context，再回退到 broad source reads
- [x] 3.5 更新 CLI human-readable 输出，简洁展示建议命令和原因
- [x] 3.6 增加稳定排序、去重和 fallback 行为测试

## 4. P0 — Summary-First Review Workflow

- [x] 4.1 更新 bundled agent workflow references：默认读取 minimal graph context，而不是完整 graph artifacts
- [x] 4.2 Tech Lead analysis 阶段仅注入 minimal context + top hints，并把完整 graph artifacts 作为按需参考
- [x] 4.3 Reviewer task prompt 增加“先用 nextToolSuggestions，再按需 review-context，最后才 broad read”的探索规则
- [x] 4.4 明确 graph 输出只是调查线索，finding 仍必须引用源码、diff、测试或运行证据
- [x] 4.5 验证没有 graph DB 或 graph stale 时，workflow graceful degradation 行为不变

## 5. P0 — Usage Compare 最小闭环

- [x] 5.1 定义 `UsageComparison` 输出结构
- [x] 5.2 实现 `ocr usage compare --baseline <workflow> --candidate <workflow> --json`
- [x] 5.3 比较 summary token 字段：total/input/output/cache/reasoning/cost/row_count
- [x] 5.4 从 event JSONL 中统计 `Read`、`Grep`、`Bash` 和 `ocr graph *` 调用数
- [x] 5.5 当 usage rows 缺失、只有 total、或 event JSONL 不完整时输出 caveats
- [x] 5.6 定义初版 verdict 规则：证据不足时不得宣称 token efficiency 已改善
- [x] 5.7 增加 usage compare 单元测试和 fixture

## 6. P1 — Bounded Review Context

- [x] 6.1 定义 `GraphReviewContext` shared type，包含 snippets、line ranges、reason、budget 和 truncation
- [x] 6.2 基于 changed ranges / changed symbols 抽取 changed source snippets
- [x] 6.3 基于 top impacted symbols 抽取少量 impacted source snippets
- [x] 6.4 支持 snippet 合并与去重，避免同文件相邻片段重复输出
- [x] 6.5 增加 `ocr graph review-context --workflow review|map --files ... --max-lines-per-snippet ... --json`
- [x] 6.6 增加 unsupported files、missing graph、truncated snippets 的测试
- [x] 6.7 明确 test gaps、affected flows 和更复杂 snippet 策略不阻塞首发

## 7. P1 — Dashboard 与 Telemetry 深化

- [x] 7.1 Dashboard graph panel 展示 minimal context summary 和 next suggestions
- [x] 7.2 Dashboard 支持按需请求 review-context snippets
- [x] 7.3 Token Usage 卡片增加 compare 入口或展示 comparison artifact
- [x] 7.4 对 total-only usage、missing rows、event telemetry missing 输出可读 caveat
- [x] 7.5 增加 UI 测试覆盖 minimal context、review-context 和 usage compare states

## 8. Benchmark 与质量验收

- [x] 8.1 新增 graph token efficiency benchmark 文档：同 diff、同 model、同 reviewer team、3-5 轮中位数
- [x] 8.2 定义推荐验收阈值：median total tokens 变化、Read/Grep/Bash 调用下降、review 质量不下降
- [x] 8.3 增加 benchmark fixture，覆盖 graph-enabled 与 graph-missing 两种 session
- [x] 8.4 文档化如何解读 input tokens 上升但 total tokens 下降的情况
- [x] 8.5 文档化质量抽查清单，防止 token 降低来自 review 变浅

## 9. Verification

- [x] 9.1 `pnpm exec vitest run --config packages/shared/graph/vitest.config.ts`
- [x] 9.2 `pnpm exec vitest run --config packages/cli/vitest.config.ts`
- [x] 9.3 `pnpm exec vitest run --config packages/dashboard/vitest.config.ts`
- [ ] 9.4 在一个中型仓库上手动验证 `minimal-context`、`usage compare` 和 summary-first review workflow
- [ ] 9.5 在一个中型仓库上手动验证 `review-context` 的按需调查路径
- [x] 9.6 记录 token efficiency benchmark 示例输出
