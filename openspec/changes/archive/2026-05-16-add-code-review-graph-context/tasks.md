## 1. OpenSpec

- [x] 1.1 创建 `add-code-review-graph-context` change 目录
- [x] 1.2 添加 `proposal.md`、`design.md`、`tasks.md`
- [x] 1.3 添加 `code-graph` 新 spec delta
- [x] 1.4 修改 `cli`、`context-discovery`、`review-orchestration`、`review-map`、`dashboard`、`session-management` spec delta
- [x] 1.5 运行 `openspec validate add-code-review-graph-context --strict`

## 2. 内部模块与构建

- [x] 2.1 新增 `packages/shared/graph`
- [x] 2.2 配置 `private: true` package、Nx test target、tsconfig path alias
- [x] 2.3 确保 `@open-code-review/graph` 不进入 release/publish
- [x] 2.4 配置 CLI/Dashboard build 可 bundle graph 源码
- [x] 2.5 配置 Tree-sitter WASM assets 的复制和运行时路径解析

## 3. 图谱存储

- [x] 3.1 实现 `.ocr/data/graph.db` 初始化
- [x] 3.2 实现 graph schema 和 migration runner
- [x] 3.3 实现 GraphStore CRUD：files、nodes、edges、metadata
- [x] 3.4 实现按文件清理旧 nodes/edges
- [x] 3.5 补齐 storage 单元测试

## 4. Tree-sitter 解析

- [x] 4.1 实现语言识别和扩展名映射
- [x] 4.2 实现 ignore 规则和 unsupported file 统计
- [x] 4.3 实现 Python parser adapter
- [x] 4.4 实现 JavaScript parser adapter
- [x] 4.5 实现 TypeScript parser adapter
- [x] 4.6 实现 Node.js resolver：CommonJS、ESM、package.json、built-ins、测试框架识别
- [x] 4.7 实现 Go parser adapter
- [x] 4.8 实现 Java parser adapter
- [x] 4.9 实现 Vue parser adapter，解析 script/script lang=ts
- [x] 4.10 实现 SQL parser adapter
- [x] 4.11 为七种语言各增加 fixture 测试

## 5. 全量与增量索引

- [x] 5.1 实现 `buildGraph({ mode: "full" })`
- [x] 5.2 实现 `updateGraph({ base | staged | workingTree })`
- [x] 5.3 支持新增、修改、删除文件
- [x] 5.4 parser/grammar version 变化时标记 stale
- [x] 5.5 实现 postprocess：TESTED_BY、DEPENDS_ON、轻量 flow detection
- [x] 5.6 补齐 full build 和 incremental update 测试

## 6. 查询与上下文

- [x] 6.1 实现 `queryGraph` pattern queries
- [x] 6.2 实现 `getImpactRadius`
- [x] 6.3 实现 `generateGraphContext`
- [x] 6.4 实现 `renderGraphContextMarkdown`
- [x] 6.5 处理 unsupported changed files
- [x] 6.6 补齐 query/context 测试
- [x] 6.7 支持 `git diff` changed ranges 解析，并把 graph context 的 changed nodes 提升为 changed symbols 粒度
- [x] 6.8 为 changed symbol 命中与 file-level fallback 补齐单元测试

## 7. CLI

- [x] 7.1 新增 `ocr graph status`
- [x] 7.2 新增 `ocr graph build --full`
- [x] 7.3 新增 `ocr graph update`
- [x] 7.4 新增 `ocr graph query`
- [x] 7.5 新增 `ocr graph impact`
- [x] 7.6 新增 `ocr graph context`
- [x] 7.7 补齐 CLI 单元测试和 e2e smoke test

## 8. Review/Map Workflow

- [x] 8.1 更新 review workflow，在 context discovery 后生成 graph context
- [x] 8.2 更新 reviewer task，允许使用 `ocr graph query`，但 finding 必须有源码/diff 证据
- [x] 8.3 更新 map workflow，在 topology/flow-analysis/synthesis 中使用 graph context
- [x] 8.4 更新 session file manifest，加入 `graph-context.md/json`
- [x] 8.5 同步更新 `packages/agents` 和 `.ocr/skills`
- [x] 8.6 在 `stateTransition` orchestration 中自动触发 graph context 生成：review 进入 `change-context`、map 进入 `map-context` 时 best-effort 写入 `graph-context.md/json`

## 9. Dashboard

- [x] 9.1 FilesystemSync 支持 `graph-context.md`
- [x] 9.2 Artifact API 支持 `graph-context`
- [x] 9.3 新增 `GET /api/graph/status`
- [x] 9.4 新增 `POST /api/graph/query`
- [x] 9.5 Review/Map 页面展示 graph risk、test gaps、unsupported files、impacted files
- [x] 9.6 补齐 Dashboard API/UI 测试

## 10. 验收

- [x] 10.1 无 graph DB 时 review/map 不失败
- [x] 10.2 有 graph DB 时 review/map 生成 `graph-context.md/json`
- [x] 10.3 首批七种语言 fixture 均通过
- [x] 10.4 unsupported 文件被统计且不阻断流程
- [x] 10.5 `@open-code-review/graph` 不发布，CLI 包含 graph runtime/assets
- [x] 10.6 补充 workflow 级 e2e，证明自动生成 graph context 且 graph 缺失不阻塞 review/map

## 当前边界

- SQL 当前使用启发式解析器，不是独立 Tree-sitter SQL grammar；v1 仅提取表/视图/函数节点和基础依赖信号。
- changed symbol 目前优先依赖 `git diff --unified=0`；若 workflow 只提供文件列表且没有可用 diff，则 graph context 会降级为 file-level changed nodes。
