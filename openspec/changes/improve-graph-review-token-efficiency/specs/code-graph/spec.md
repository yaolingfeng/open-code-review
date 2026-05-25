# code-graph Spec Delta

title: "[规格] Graph 作为 Review 默认导航层"
status: proposed
description: "为 OCR code graph 增加 minimal context、structured next tool suggestions 和 bounded review-context，将 graph 从可见 artifact 变成 review 默认入口与导航层。"
specs:
  - code-graph

## ADDED Requirements

### Requirement: Minimal Graph Context (P0)

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

### Requirement: Graph Next Tool Suggestions (P0)

系统 SHALL 在 graph exploration 输出中提供结构化下一步建议，减少 reviewer 盲搜。

#### Scenario: Suggestions include command and reason

- **WHEN** graph search、query、impact、minimal context 或 review-analysis 返回结果
- **THEN** 输出 SHALL 包含 `nextToolSuggestions`
- **AND** 每个 suggestion SHALL 包含建议命令或动作、原因、预期价值和证据要求
- **AND** suggestion SHALL 优先引导到 bounded graph query 或按需源码验证

#### Scenario: Suggestions are bounded and deterministic

- **WHEN** 系统生成 next tool suggestions
- **THEN** 输出 SHALL 有数量上限
- **AND** 排序 SHALL deterministic
- **AND** 重复或等价建议 SHALL 被去重

#### Scenario: Suggestions prefer graph queries before broad source reads

- **GIVEN** graph 能回答 callers、callees、imports、tests 或 impact 问题
- **WHEN** 系统生成 next tool suggestions
- **THEN** 建议 SHALL 优先使用 bounded graph query 或 review-context
- **AND** 系统 SHALL 避免默认建议整文件读取，除非 graph 不足以定位相关片段

### Requirement: Bounded Graph Review Context (P1)

系统 SHALL 提供 bounded graph review context，用小范围源码片段替代 reviewer 整文件盲读。首发版仅覆盖 changed symbols 和 top impacted symbols；test gaps 和 affected flows 在后续迭代中扩展。

#### Scenario: Extract source snippets for changed symbols

- **GIVEN** changed ranges 或 changed symbols 可用
- **WHEN** 系统生成 graph review context
- **THEN** 输出 SHALL 包含相关源码 snippets
- **AND** 每个 snippet SHALL 包含 file path、line range、qualified names、选择原因和源码文本

#### Scenario: Extract snippets for top impacted symbols

- **GIVEN** graph impact radius 产生 top impacted symbols
- **WHEN** 系统生成 graph review context
- **THEN** 输出 SHALL 包含少量 top impacted symbol snippets
- **AND** 输出 SHALL 明确这些 snippets 是辅助调查上下文，而不是 finding 证据本身

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

#### Scenario: Test gaps and affected flows are out of P0 scope

- **GIVEN** system generates bounded graph review context for P0 release
- **WHEN** system extracts source snippets
- **THEN** system SHALL NOT be required to extract snippets for test gaps or affected flows
- **AND** system SHALL produce a compliant output without those snippet categories