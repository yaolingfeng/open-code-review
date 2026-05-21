# code-graph Specification

## Purpose
TBD - created by archiving change add-code-review-graph-context. Update Purpose after archive.
## Requirements
### Requirement: Internal Graph Engine

系统 SHALL 提供一个位于 `packages/shared/graph` 的内部 TypeScript 代码图谱引擎，该引擎随 OCR CLI 和 Dashboard 构建产物一起分发，但 SHALL NOT 作为独立 npm 包发布。

#### Scenario: Graph module is internal only

- **GIVEN** OCR 执行 npm release
- **WHEN** release project 集合被解析
- **THEN** `@open-code-review/graph` SHALL NOT 被发布
- **AND** 用户 SHALL NOT 需要单独安装 `@open-code-review/graph`

### Requirement: Graph Database

系统 SHALL 使用 `.ocr/data/graph.db` 存储代码图谱数据，并与 `.ocr/data/ocr.db` 的 workflow/session 状态分离。

#### Scenario: Graph database isolation

- **GIVEN** 图谱索引运行
- **WHEN** graph nodes 和 graph edges 被写入
- **THEN** 数据 SHALL 写入 `.ocr/data/graph.db`
- **AND** OCR workflow/session 状态 SHALL 继续存储在 `.ocr/data/ocr.db`

### Requirement: Supported Languages

图谱引擎 SHALL 在 v1 支持 Python、JavaScript、TypeScript、Go、Java、Vue 和 SQL 的 Tree-sitter 解析。

#### Scenario: Supported source file

- **GIVEN** 仓库包含受支持语言的源码文件
- **WHEN** 图谱 build 或 update 运行
- **THEN** 系统 SHALL 为该文件生成 File 节点
- **AND** 系统 SHOULD 为可识别的 class、function、type、test 生成节点
- **AND** 系统 SHOULD 为可识别的 contains、import、call、inheritance、test 关系生成边

#### Scenario: Unsupported source file

- **GIVEN** 仓库包含首批语言范围之外的文件
- **WHEN** 图谱 build 或 update 运行
- **THEN** unsupported 文件 SHALL 被跳过
- **AND** unsupported 文件数量 SHALL 被记录在 graph status 中
- **AND** review/map workflow SHALL 继续运行

### Requirement: Node.js Ecosystem Resolution

系统 SHALL 将 Node.js 作为 JavaScript/TypeScript 生态解析能力，而不是单独的 Tree-sitter language。

#### Scenario: CommonJS and ESM resolution

- **GIVEN** JavaScript 或 TypeScript 文件包含 `require()`、`module.exports`、`exports.*`、ESM import/export 或 `package.json` exports/main/imports
- **WHEN** 文件被解析
- **THEN** 图谱引擎 SHOULD 生成对应的 IMPORTS_FROM、DEPENDS_ON 或 metadata
- **AND** Node.js built-in modules SHOULD 被标记为 external/builtin

### Requirement: Full Graph Build

系统 SHALL 支持通过 `ocr graph build --full` 执行全量图谱构建。

#### Scenario: Full build

- **GIVEN** 仓库包含受支持语言源码
- **WHEN** 用户运行 `ocr graph build --full`
- **THEN** 系统 SHALL 清理旧 graph tables
- **AND** 系统 SHALL 重新扫描仓库文件
- **AND** 系统 SHALL 重建 graph files、nodes、edges 和 metadata

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

### Requirement: Graph Query

系统 SHALL 提供结构化图谱查询能力，供 OCR workflow、CLI 用户和 Dashboard 使用。

#### Scenario: Query graph by pattern

- **WHEN** 用户运行 `ocr graph query callers_of --target <target> --json`
- **THEN** 命令 SHALL 返回包含 status、summary、nodes、edges、warnings 和 truncated 字段的 JSON

### Requirement: Graph Impact Analysis

系统 SHALL 支持按变更文件计算影响半径。

#### Scenario: Impact radius

- **GIVEN** 用户提供 changed files
- **WHEN** 用户运行 `ocr graph impact --files <files> --depth 2 --json`
- **THEN** 系统 SHALL 返回 changed nodes、impacted nodes、impacted files 和连接边

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

