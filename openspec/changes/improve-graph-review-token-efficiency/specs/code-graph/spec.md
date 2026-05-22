# code-graph Spec Delta

title: "[规格] 图谱驱动的 Token 效率上下文"
status: proposed
description: "为 OCR code graph 增加 minimal context、bounded review context 和 next tool suggestions，减少 reviewer token 与盲目探索。"
specs:
  - code-graph

## ADDED Requirements

### Requirement: Minimal Graph Context

系统 SHALL 提供极简 graph context，用于 review/map workflow 的默认图谱注入。

#### Scenario: Generate minimal graph context

- **GIVEN** graph DB 存在且 workflow 提供 changed files
- **WHEN** 系统生成 minimal graph context
- **THEN** 输出 SHALL 包含 summary、risk、changed file count、changed symbol count、impacted file count、test gap count、top priorities、key warnings 和 next tool suggestions
- **AND** 输出 SHALL 避免包含完整 impacted nodes、完整 affected flows 或完整 raw graph artifact

#### Scenario: Minimal context is bounded for token efficiency

- **WHEN** minimal graph context 被生成
- **THEN** 输出 SHALL 支持 top priorities、warnings 和 suggestions 的数量上限
- **AND** 输出 SHALL 包含 budget 或 truncation metadata
- **AND** workflow 默认注入 SHALL 使用该 bounded 输出

#### Scenario: Minimal context degrades gracefully

- **GIVEN** graph DB missing、stale、degraded 或部分文件 unsupported
- **WHEN** 系统生成 minimal graph context
- **THEN** 输出 SHALL 返回受控 status 与 warnings
- **AND** 不得阻断 review/map workflow
- **AND** 不得隐式触发 graph update、full build、search-index rebuild 或 flow rebuild

### Requirement: Bounded Graph Review Context

系统 SHALL 提供 bounded graph review context，用小范围源码片段替代 reviewer 整文件盲读。

#### Scenario: Extract source snippets for changed symbols

- **GIVEN** changed ranges 或 changed symbols 可用
- **WHEN** 系统生成 graph review context
- **THEN** 输出 SHALL 包含相关源码 snippets
- **AND** 每个 snippet SHALL 包含 file path、line range、qualified names、选择原因和源码文本

#### Scenario: Extract snippets for high-priority impacted symbols

- **GIVEN** graph impact radius 产生 high-priority impacted symbols
- **WHEN** 系统生成 graph review context
- **THEN** 输出 MAY 包含 impacted symbol snippets
- **AND** 输出 SHALL 明确这些 snippets 是辅助调查上下文，而不是 finding 证据本身

#### Scenario: Extract snippets for test gaps

- **GIVEN** graph analysis 发现 changed function 或 flow entry 缺少 TESTED_BY edge
- **WHEN** 系统生成 graph review context
- **THEN** 输出 SHOULD 包含对应函数或 flow entry 的 bounded snippet
- **AND** 输出 SHOULD 给出后续 tests_for 或源码验证建议

#### Scenario: Review context is bounded and deduplicated

- **WHEN** graph review context 包含多个 snippets
- **THEN** 系统 SHALL 合并同文件相邻或重叠 snippets
- **AND** 系统 SHALL 支持 max files、max snippets、max lines per snippet、max chars 或等价预算
- **AND** 超出预算时 SHALL 输出 truncation markers

#### Scenario: Review context handles unsupported or unreadable files

- **GIVEN** changed files 包含 unsupported、missing 或不可读文件
- **WHEN** 系统生成 graph review context
- **THEN** 输出 SHALL 在 warnings 或 omitted files 中说明原因
- **AND** 不得生成伪造源码片段

### Requirement: Graph Next Tool Suggestions

系统 SHALL 在 graph exploration 输出中提供结构化下一步建议，减少 reviewer 盲搜。

#### Scenario: Suggestions include command and reason

- **WHEN** graph search、query、impact、minimal context、review analysis 或 review context 返回结果
- **THEN** 输出 SHOULD 包含 `nextToolSuggestions`
- **AND** 每个 suggestion SHALL 包含建议命令或动作、原因、预期价值和证据要求

#### Scenario: Suggestions are bounded and deterministic

- **WHEN** 系统生成 next tool suggestions
- **THEN** 输出 SHALL 有数量上限
- **AND** 排序 SHALL deterministic
- **AND** 重复或等价建议 SHALL 被去重

#### Scenario: Suggestions prefer graph queries before broad source reads

- **GIVEN** graph 能回答 callers、callees、imports、tests 或 impact 问题
- **WHEN** 系统生成 next tool suggestions
- **THEN** 建议 SHOULD 优先使用 bounded graph query 或 review-context
- **AND** 不 SHOULD 默认建议整文件读取，除非 graph 不足以定位相关片段
