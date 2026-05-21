## Context

该变更把图谱能力内置到 OCR，而不是外接 `code-review-graph`。图谱引擎服务于 review/map 上下文补充，不能替代 git diff、OCR session state、`round-meta.json` 或 `map-meta.json` 的权威地位。

## Goals / Non-Goals

**Goals**:
- 内部 TypeScript 图谱模块，不单独发布。
- Tree-sitter-first 解析，首批支持 Python、JavaScript、TypeScript、Go、Java、Vue、SQL。
- 支持全量构建和增量更新。
- 支持结构化查询：callers、callees、imports、importers、tests、file summary、impact radius、review/map context。
- 为 review/map 生成 `graph-context.md/json`。
- 图谱缺失或失败时 graceful degradation。

**Non-Goals**:
- 不支持 CRG 全量语言集。
- 不实现 MCP server。
- 不实现 embeddings、semantic search、wiki、community detection。
- 不引入 Python、`better-sqlite3` 或 native build 依赖。
- 不把 graph tables 放进 `.ocr/data/ocr.db`。

## Decisions

### D-1: `packages/shared/graph` 内部模块

**Decision**: 图谱代码放入 `packages/shared/graph`，包名 `@open-code-review/graph`，`private: true`，不进入 npm release。

**Rationale**: CLI 和 Dashboard 都需要复用图谱能力；放入 CLI 私有目录会造成 Dashboard 依赖 CLI 实现细节。`packages/shared/*` 已被 release 配置排除，符合“不单独发布”的要求。

### D-2: `.ocr/data/graph.db` 独立数据库

**Decision**: 图谱数据存入 `.ocr/data/graph.db`，不混入 `.ocr/data/ocr.db`。

**Rationale**: 代码图谱的数据规模和写入频率与 session/workflow 状态不同。分库可以保护现有 Dashboard/CLI 状态读写路径，降低迁移风险。

### D-3: Tree-sitter WASM over Python Tree-sitter

**Decision**: OCR 使用 Node 可运行的 Tree-sitter WASM runtime 和 grammar assets。

**Rationale**: 用户不应安装 Python 或外部 CRG。WASM 方案符合 OCR 零原生依赖方向，也便于随 CLI bundle 分发。

### D-4: 首批七种语言

**Decision**: v1 只支持 `python`、`javascript`、`typescript`、`go`、`java`、`vue`、`sql`。

**Rationale**: CRG 支持语言很多，全部迁移会显著拉长实现和测试周期。首批语言覆盖主流后端、前端和 SQL 依赖分析，能先支撑 review/map 核心收益。

### D-5: Node.js 是 ecosystem，不是 Tree-sitter language

**Decision**: 不新增 `nodejs` 语言；Node.js 能力作为 JS/TS parser 的 resolver/postprocess。

**Rationale**: Node.js 代码语法仍是 JavaScript/TypeScript。需要单独支持的是 CommonJS、ESM、package.json resolution、Node built-ins 和测试框架约定。

### D-6: Graph Context 从 changed files 提升到 changed symbols

**Decision**: review/map 使用的 `graph-context` 以 `git diff --unified=0` 推导的 changed ranges 为优先输入，再映射到重叠的 graph symbols；只有在 diff ranges 不可用或未命中任何符号时，才回退到 file-level changed nodes。

**Rationale**: file-level 粒度会把同文件内未变更符号一并纳入影响分析，导致 review/map 的拓扑、测试缺口和优先级信号偏噪。先用 diff ranges 限定变更区域，可以在不改变 canonical changed files 来源的前提下，把图谱上下文提升到 symbol 级精度。

## Architecture

```
packages/shared/graph
  storage/   -> graph.db schema, migrations, GraphStore
  indexer/   -> git ls-files, ignore rules, full build, incremental update
  parsers/   -> Tree-sitter runtime, language adapters
  query/     -> callers/callees/imports/importers/tests/file_summary
  analysis/  -> impact radius, test gaps, risk score, affected files
  context/   -> GraphContext JSON + Markdown rendering
```

## Data Model

Node kinds:

```text
File | Class | Function | Type | Test
```

Edge kinds:

```text
CONTAINS | IMPORTS_FROM | CALLS | INHERITS | IMPLEMENTS | TESTED_BY | DEPENDS_ON | REFERENCES
```

Core tables:

```text
graph_metadata
graph_files
graph_nodes
graph_edges
graph_flows
graph_flow_nodes
```

## Query Model

Workflow 和 Dashboard 不直接读取 `graph.db`，统一通过内部 API 或 CLI 查询：

```bash
ocr graph status --json
ocr graph query callers_of --target "<qualified-name>" --json
ocr graph query file_summary --target "src/foo.ts" --json
ocr graph impact --files "src/foo.ts" --depth 2 --json
ocr graph context --workflow review --base origin/main --json
```

## Changed Symbol Resolution

`graph-context` 的 changed symbol 计算分三步：

1. 仍然由 git 提供 canonical `changedFiles`，作为 workflow 完整性和 unsupported 统计的基础输入。
2. 当存在可读取的 diff 时，系统使用 `git diff --unified=0` 提取 `changedRanges`，并选择与范围重叠的非 File 节点作为 `changedNodes`。
3. 当 diff 不可读、没有 hunk、或 hunk 未命中任何图谱符号时，系统回退为该文件下的 file-level changed nodes，并在 `warnings` 中记录降级原因。

这样可以保证：

- map/review 不会因为图谱精度升级而漏掉 changed files；
- 图谱能在常见场景下更准确地标记真正变更的函数、类或类型；
- 没有 git diff 或 parser 覆盖不足时，行为仍保持 graceful degradation。

## Risks

- Tree-sitter WASM grammar asset 分发路径复杂，需要 dev/source、CLI dist、Dashboard dist 三种路径测试。
- 多语言 parser 容易质量不均，必须用 fixture 锁定最低可用行为。
- 增量更新的 resolver 可能先采用轻量全局刷新，后续再优化性能。
- SQL 和 Vue 解析深度有限，v1 只承诺结构化依赖和 script 部分，不承诺完整语义分析。
