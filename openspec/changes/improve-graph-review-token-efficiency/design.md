title: "[设计] 图谱驱动的 Token 效率与 Review 质量闭环"
status: proposed
description: "在现有 OCR 图谱探索能力基础上，新增 minimal context、bounded review context、next suggestions 和 usage compare，把 code-review-graph 的核心价值转化为更少 token、更少盲搜、更稳定的 review 质量。"
specs:
  - code-graph
  - cli
  - dashboard
  - review-orchestration
  - session-management

# [设计] 图谱驱动的 Token 效率与 Review 质量闭环

## 背景

`add-graph-review-exploration` 让 OCR 具备了 graph search、review analysis、module
summary 和 Dashboard exploration。它解决的是“reviewer 能不能消费图谱”。

本变更解决下一层问题：“图谱消费是否真正减少 token、减少盲搜，并保持 review
质量稳定”。这需要把图谱从一个 artifact 扩展成一个 **token-efficient review
protocol**：先给最小摘要，再按需查询，最后用 usage 和质量指标验证效果。

## 核心决策

### D-1：默认注入 minimal graph context，而不是完整 artifact

**Decision**：新增 `GraphMinimalContext`，作为 review workflow 的默认图谱注入。
它只包含 summary、risk、top entities、top priorities、test gap count、warnings 和
recommended next queries。

**Rationale**：完整 `graph-context.md` 和 `graph-review-analysis.json` 适合 artifact
与 Dashboard，但不适合作为每个 reviewer 的默认 prompt。默认注入越大，图谱越可能
增加 input tokens。minimal context 可以让 LLM 知道“应该从哪里开始”，但不承担完整
证据载荷。

### D-2：review-context 输出源码片段，而不是要求 reviewer 整文件读取

**Decision**：新增 `GraphReviewContext`，从 changed symbols、impacted priorities、
test gaps 和 affected flows 中抽取 bounded source snippets。它必须包含文件路径、
行号范围、片段内容、选择原因和 truncation 信息。

**Rationale**：token 节省的关键不只是少注入 graph metadata，而是减少 reviewer
读取无关源码。`code-review-graph` 的 `get_review_context` 证明了“图谱 + 精准源码
片段”比“图谱 + 让 reviewer 自己读文件”更接近最终产品收益。

### D-3：所有图谱查询返回 nextToolSuggestions

**Decision**：为 search、query、impact、minimal-context、review-analysis 和
review-context 增加 `nextToolSuggestions`。建议项包含 command、reason、expectedValue
和 groundingRequirement。

**Rationale**：LLM 的盲搜常来自不知道下一步该查什么。结构化建议能把 graph traversal
变成 guided review path，减少重复 `Grep`、宽泛 `Read` 和无效 Bash。

### D-4：usage compare 是图谱能力的验收入口

**Decision**：新增 `ocr usage compare --baseline <id> --candidate <id>`，比较两次
workflow 的 token summary、rows、cost 和工具调用摘要。benchmark 文档要求至少 3-5
轮同 diff 对照并看中位数。

**Rationale**：如果没有 A/B 评测，图谱能力是否省 token 只能靠主观感受。usage compare
将“更少 token”从愿景变成可持续回归检测。

### D-5：质量门控与 token 门控同等重要

**Decision**：benchmark 输出不只比较 token，也记录 review artifact 质量信号：
blocker/should-fix/suggestion 数量、final.md 是否包含源码证据、graph-only finding
是否被禁止、人工抽查备注。

**Rationale**：token 下降可能来自 review 变浅。OCR 的产品收益必须是“更少无效探索”，
不是“少做 review”。质量门控防止图谱被误用为降低审查深度的借口。

## 数据结构

### GraphMinimalContext

```text
GraphMinimalContext
- status
- summary
- riskLevel / riskScore
- changedFileCount
- changedSymbolCount
- impactedFileCount
- testGapCount
- topPriorities[]
- keyWarnings[]
- nextToolSuggestions[]
- budget
  - approxTokens
  - truncated
  - omittedSections[]
```

### GraphReviewContext

```text
GraphReviewContext
- status
- summary
- snippets[]
  - filePath
  - lineStart
  - lineEnd
  - reason
  - qualifiedNames[]
  - text
- omittedFiles[]
- warnings[]
- nextToolSuggestions[]
- budget
  - maxFiles
  - maxSnippets
  - maxLinesPerSnippet
  - maxChars
  - truncated
```

### NextToolSuggestion

```text
NextToolSuggestion
- command
- reason
- expectedValue
- groundingRequirement
- priority
```

### UsageComparison

```text
UsageComparison
- baseline
  - workflowId
  - summary
  - toolCallSummary
- candidate
  - workflowId
  - summary
  - toolCallSummary
- delta
  - totalTokens
  - totalReductionPct
  - inputTokens
  - outputTokens
  - reasoningTokens
  - costUsd
  - readGrepBashCalls
  - graphCalls
- verdict
  - tokenEfficiency
  - explorationEfficiency
  - caveats[]
```

## Workflow 注入策略

默认 review prompt 只注入：

- minimal graph context summary
- 最多 N 条 top priorities
- 最多 N 条 nextToolSuggestions
- missing/stale/degraded warning

不默认注入：

- 完整 `graph-context.md`
- 完整 `graph-review-analysis.json`
- 完整 impacted nodes/files
- 完整 affected flows
- 源码片段，除非 workflow 明确调用 `ocr graph review-context`

## 验收标准

- `GraphMinimalContext` 默认输出应控制在约 100-300 tokens。
- `GraphReviewContext` 必须比直接读取 changed files 全文更小，并保留源码行号。
- 在同 diff、同 team、同 model 的 A/B benchmark 中，candidate 的 median
  `total_tokens` 应可观察下降；若下降不足，应输出 caveat 而不是宣称成功。
- `Read/Grep/Bash` 调用数下降或被 bounded graph query/review-context 替代。
- final review 不得包含仅凭 graph signal 得出的 finding。

## 风险与权衡

- minimal context 太短可能遗漏重要图谱线索，因此必须提供 nextToolSuggestions 作为按需
  drilldown 入口。
- review-context 若片段选择不准，可能让 reviewer 过度依赖局部代码。因此输出必须说明
  选择原因，并保留 fallback 建议。
- usage compare 受 provider usage 事件质量影响；当 usage 缺失或只有 total 时，报告必须
  明确 caveat。
- 自动统计工具调用依赖 event JSONL 完整性；缺失事件时应降级为 token-only compare。

## 非目标

- 不引入 embedding 或 semantic/vector search。
- 不实现 code-review-graph MCP server。
- 不做跨仓库图谱。
- 不做自动 refactor、dead code 删除或 wiki 生成。
- 不把 graph signal 变成 finding 判定器。
