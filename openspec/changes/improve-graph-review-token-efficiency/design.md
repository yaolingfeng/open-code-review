title: "[设计] Graph 作为 Review 默认导航层"
status: proposed
description: "将 OCR 图谱从可见 artifact 变成 review 默认入口与导航层。新增 minimal context（P0）、structured next suggestions（P0）、bounded review-context（P1）和 usage compare（P0），在可量化验证 token 和探索行为改善的同时，确保 review 质量不下降。"
specs:
  - code-graph
  - cli
  - dashboard
  - review-orchestration
  - session-management

# [设计] Graph 作为 Review 默认导航层

## 背景

`add-graph-review-exploration` 让 OCR 具备了 graph search、review analysis、module
summary 和 Dashboard exploration。它解决的是“reviewer 能不能消费图谱”。

本变更解决下一层问题：图谱是否真正成为 review workflow 的默认入口，而不是默认
注入后又让 reviewer 回到无方向的 `Read/Grep/Bash`。核心是把图谱从“额外的 artifact”
转成“默认导航层”，并用可量化的指标验证收益。

## 核心决策

### D-1：默认注入 minimal graph context（P0）

**Decision**：新增 `GraphMinimalContext`，作为 review workflow 的默认图谱注入。
输出包含：status、summary、risk、changed/impacted file count、test gap count、
top priorities、key warnings、nextToolSuggestions 和 budget metadata。

**Rationale**：完整 `graph-context.md` 和 `graph-review-analysis.json` 适合 artifact
与 Dashboard 展示，但不适合作为每个 reviewer 的默认 prompt。默认注入越大，
图谱越可能增加 input tokens。minimal context 让 LLM 知道“从哪里开始”，
但不承担完整证据载荷；完整 graph artifacts 作为按需 drill-down 入口。

**P0 要求**：summary 和 top priorities 必须 bounded；不得隐式触发 graph build、
update、search-index rebuild、full flow rebuild 或昂贵 module summary 计算。

### D-2：next tool suggestions 是 graph 变成导航层的关键（P0）

**Decision**：为 minimal-context、search、query、impact 和 review-analysis 输出
结构化 `nextToolSuggestions`。每条 suggestion 包含 command、reason、expectedValue、
groundingRequirement 和 priority。

**Rationale**：LLM 盲搜常来自不知道下一步查什么。结构化建议能把 graph traversal
变成 guided review path，减少重复 `Grep`、宽泛 `Read` 和无效 `Bash`。

**P0 要求**：suggestions 必须 bounded（数量上限）、deterministic（排序稳定）、
deduplicated（去重）；优先建议 bounded graph query 或按需源码验证，
只有当 graph 不足以定位相关片段时才回退到整文件读取。

### D-3：Bounded review-context 是按需调查工具，不是默认 payload（P1）

**Decision**：新增 `GraphReviewContext`，从 changed symbols 和 top impacted
symbols 中抽取 bounded source snippets。snippet 必须包含 file path、line range、
reason 和源码文本，并附带 budget 和 truncation metadata。

**Rationale**：token 节省的关键不只是少注入 graph metadata，而是减少 reviewer
读取无关源码。`code-review-graph` 的 `get_review_context` 证明了“图谱 + 精准源码
片段”比“图谱 + 让 reviewer 自己读文件”更接近最终产品收益。

**P0 out of scope**：test gaps snippets、affected flows snippets、更复杂的
snippet merge 策略。这些在 P1 及后续迭代中逐步扩展。

**P1 要求**：snippet 合并与去重；支持 maxSnippets 和 maxLinesPerSnippet 预算；
超出预算时输出 truncation markers；不支持的文件输出 warnings 而非伪造片段。

### D-4：usage compare 是图谱能力的验收入口（P0）

**Decision**：新增 `ocr usage compare --baseline <id> --candidate <id>`，比较两次
workflow 的 token summary（total/input/output/cache/reasoning/cost/row_count）、
基础工具调用统计（`Read`/`Grep`/`Bash` vs `ocr graph *` 调用数），以及结构化
verdict。

**Rationale**：如果没有 A/B 评测，图谱能力是否省 token 只能靠主观感受。usage compare
将“更少 token”和“更少盲搜”从愿景变成可持续的回归检测。

**P0 要求**：verdict 必须保守——证据不足时不得宣称 token efficiency 已改善；
当 usage rows 缺失、只有 total、或 event JSONL 不完整时，必须输出 caveat。

**P1 增强**：在 P0 基础调用计数之上，补充更丰富的 exploration 指标（如更细粒度
的调用分布），帮助更准确判断 reviewer 是否真正改变了调查路径。P1 增强不得
阻塞 P0 usage compare 输出。

### D-5：质量门控与 token 门控同等重要（P0）

**Decision**：usage compare 的 verdict 和 benchmark 输出不只比较 token，
也记录 review artifact 质量信号（blocker/should-fix 数量、evidence 引用、
graph-only finding 是否被禁止）。finding 不得仅凭 graph signal 写成，
必须引用源码、diff、测试或运行证据。

**Rationale**：token 下降可能来自 review 变浅。OCR 的产品收益必须是
“更少无效探索”，不是“少做 review”。质量门控防止图谱被误用为降低审查
深度的借口。

## 数据结构

### GraphMinimalContext

```text
GraphMinimalContext
- status              // ready | missing | stale | degraded
- summary             // 一句话总结这次变更的风险范围
- riskLevel
- changedFileCount
- changedSymbolCount
- impactedFileCount
- testGapCount
- topPriorities[]     // 每条必须是"去哪看 + 为什么"
- keyWarnings[]
- nextToolSuggestions[]
- budget
  - truncated
  - omittedSections[]
```

### GraphReviewContext（P1）

```text
GraphReviewContext
- status
- summary
- snippets[]
  - filePath
  - lineStart
  - lineEnd
  - reason             // 为什么选这个片段
  - qualifiedNames[]
  - text
- omittedFiles[]
- warnings[]
- nextToolSuggestions[]
- budget
  - maxSnippets
  - maxLinesPerSnippet
  - truncated
  - omittedFiles[]
```

### NextToolSuggestion

```text
NextToolSuggestion
- command             // 建议命令或动作
- reason              // 为什么推荐这个方向
- expectedValue       // 预期能获得什么
- groundingRequirement // 需要什么证据才能确认风险
- priority            // 优先级（用于排序）
```

### UsageComparison

```text
UsageComparison
- baseline
  - workflowId
  - summary            // total/input/output/cache/reasoning/cost/row_count
  - toolCallSummary    // Read/Grep/Bash vs ocr graph * 调用数
- candidate
  - workflowId
  - summary
  - toolCallSummary
- delta
  - totalTokens / totalReductionPct
  - inputTokens / inputPct
  - outputTokens / outputPct
  - reasoningTokens / reasoningPct
  - costUsd
  - rowCount
  - readGrepBashCalls
  - graphCalls
- verdict
  - tokenEfficiency    // improved | degraded | inconclusive
  - explorationEfficiency // improved | degraded | inconclusive
  - caveats[]          // 数据缺失或解释受限的原因
```

## Workflow 注入策略

### P0：默认注入

review workflow 默认 prompt 注入：

- minimal graph context summary
- 最多 N 条 top priorities（bounded）
- 最多 N 条 nextToolSuggestions（bounded）
- missing/stale/degraded warning（如适用）

### P0：按需 drill-down

完整 graph artifacts（`graph-context.md`、`graph-review-analysis.json`、
完整 impacted nodes/files、完整 affected flows）继续保留，但作为按需参考，
不得默认塞入 reviewer prompt。

### P1：按需调查

`ocr graph review-context` 返回 bounded snippets，供 reviewer 在 graph
suggestion 指向特定符号时主动调用；输出不得自动注入到 reviewer 默认 prompt。

### 不注入

- 完整 `graph-context.md`
- 完整 `graph-review-analysis.json`
- 源码片段（除非明确调用 `ocr graph review-context`）

## 验收标准

本变更的成功标准不是“新增了更多 graph 功能”，而是 graph 是否真正改变了
OCR 的 review 默认路径。

### P0 验收

- **默认注入收缩**：review workflow 默认不再注入完整 graph artifacts，
  改为注入 bounded minimal graph context。
- **探索行为改善**：同 diff、同 model、同 reviewer team 比较下，
  `Read`/`Grep`/`Bash` broad exploration 中位数下降，或更早被 graph-guided
  exploration 替代。
- **token 成本改善**：graph-enabled workflow 的 total token、cost 或等价
  成本指标出现可解释的改善；若 input tokens 上升，由更少的盲搜或更低的
  total tokens 抵消。
- **质量不下降**：blocker/should-fix 发现质量不下降；findings 继续保持
  源码、diff、测试或运行证据引用；graph-only signal 不得作为唯一证据。

### P1 验收

- `GraphReviewContext` 比直接读取 changed files 全文更小，保留源码行号；
  snippet 选择有明确 reason；truncation 有 markers。
- Dashboard 展示 minimal context 和 usage comparison artifact；按需 drill-down
  展示 review-context snippets。
- 更丰富的 exploration telemetry 在 baseline vs candidate 对比中可观察。

## 风险与权衡

- **minimal context 太短可能遗漏重要线索**：nextToolSuggestions 作为按需
  drill-down 入口，必须能覆盖关键调查路径。priority 排序必须能反映出
  “真正影响最大的方向”。
- **review-context 片段选择不准可能误导 reviewer**：输出必须附带 reason
  和 next suggestions；reviewer 仍须引用原始源码，不能只凭 snippet 写 finding。
- **usage compare 受 provider usage 事件质量影响**：usage 缺失或只有 total 时，
  报告必须明确 caveat；verdict 不得在证据不足时宣称 success。
- **event JSONL 完整性决定 telemetry 准确性**：缺失事件时应降级为 token-only
  compare；telemetry caveat 不得阻塞 P0 compare 输出。
- **test gaps 和 affected flows 在 P0 不支持**：这意味着 P0 review-context
  不能覆盖所有调查场景；reviewer 仍可能需要 broad read 来覆盖这些路径。
  这是预期内的范围约束，不是 bug。

## 非目标

- 不引入 embedding 或 semantic/vector search（P1 后亦需明确评估）。
- 不实现 code-review-graph MCP server。
- 不做跨仓库图谱。
- 不做自动 refactor、dead code 删除或 wiki 生成。
- 不把 graph signal 变成 finding 判定器。
- 不在 P0 把 review-context 扩展到 test gaps / affected flows / 大规模 snippet merge。