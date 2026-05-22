## MODIFIED Requirements

### Requirement: Incremental Graph Update

系统 SHALL 支持基于变更文件的增量图谱更新。

#### Scenario: Incremental update

- **GIVEN** `.ocr/data/graph.db` 已存在
- **WHEN** 用户运行 `ocr graph update --base origin/main`
- **THEN** 系统 SHALL 仅重新解析变更且 hash 已变化的受支持文件
- **AND** 已删除文件的图谱数据 SHALL 被移除
- **AND** 未变化文件 SHALL 被跳过

#### Scenario: Workflow-triggered incremental update

- **GIVEN** review 或 map workflow 已获得 canonical changed files
- **WHEN** workflow 在生成 graph context 前执行预处理
- **THEN** 系统 SHALL 尝试执行一次 best-effort incremental graph update
- **AND** incremental update failure SHALL 记录 warning
- **AND** workflow SHALL 继续执行，不得因 graph update failure 中断

### Requirement: Graph Context

系统 SHALL 为 review 和 map workflow 生成图谱上下文 artifacts。

#### Scenario: Generate graph context

- **GIVEN** review 或 map workflow 运行
- **WHEN** graph context 生成完成
- **THEN** `.ocr/sessions/{id}/graph-context.md` SHALL 被写入
- **AND** `.ocr/sessions/{id}/graph-context.json` SHALL 被写入

#### Scenario: Graph context prefers changed symbols over changed files

- **GIVEN** workflow 已获得 canonical changed files
- **AND** 系统可以读取对应的 git diff ranges
- **WHEN** graph context 生成 changed nodes
- **THEN** 系统 SHALL 记录 `changedRanges`
- **AND** 系统 SHALL 优先选择与 changed ranges 重叠的非 File graph symbols 作为 `changedNodes`
- **AND** `changedFiles` SHALL 继续保留为 canonical workflow 输入

#### Scenario: Graph context falls back when changed symbol mapping is unavailable

- **GIVEN** workflow 已获得 canonical changed files
- **AND** git diff ranges 不可用，或 ranges 未命中任何 graph symbols
- **WHEN** graph context 生成 changed nodes
- **THEN** 系统 SHALL 回退为 file-level changed nodes
- **AND** graph context SHALL 记录 warning 说明发生了精度降级
- **AND** warning SHOULD 区分 `diff_unavailable`、`range_no_overlap`、`parser_coverage_insufficient` 等原因

#### Scenario: Graph context emits explainable test gaps

- **GIVEN** workflow 已获得 changed nodes 和 graph edges
- **WHEN** graph context 计算 `testGaps`
- **THEN** 系统 SHALL 输出可解释的 test gap 列表，而不是仅基于 `TESTED_BY` 边是否存在做布尔判断
- **AND** 每个 test gap SHALL 至少包含 gap 类型和原因说明
- **AND** gap 类型 SHALL 支持 symbol-level、file-level、flow-level 三类缺口

#### Scenario: Graph unavailable

- **GIVEN** 图谱缺失、stale、解析失败或查询失败
- **WHEN** review 或 map workflow 运行
- **THEN** workflow SHALL 继续执行
- **AND** graph context artifact SHALL 记录 warning
