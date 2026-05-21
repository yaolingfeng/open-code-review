# Change: Add Code Review Graph Context

## Why

OCR 当前的 `review` 和 `map` 流程主要依赖 AI agent 自主阅读 diff、源码和项目上下文。对于中大型变更，agent 需要反复手动追踪 import、调用关系、测试覆盖和上下游影响，容易遗漏跨文件影响范围，也会消耗大量 token。

我们需要在 `open-code-review` 内部引入代码图谱能力，为 review 和 map 流程提供结构化上下文：变更文件对应的符号、调用关系、依赖关系、影响半径、测试缺口、受影响文件和建议审查重点。该能力必须是 OCR 内部能力，不依赖用户额外安装 `code-review-graph`、Python 或 MCP server。

## What Changes

- **新增内部图谱模块**：在 `packages/shared/graph` 新增 `@open-code-review/graph` 源码模块，`private: true`，不单独发布到 npm，由 CLI/Dashboard 构建时 bundle 进现有产物。
- **新增图谱数据库**：使用 `.ocr/data/graph.db` 存储代码图谱，与现有 `.ocr/data/ocr.db` 分离，避免图谱数据影响 session/workflow 状态库。
- **新增 Tree-sitter 解析层**：首批支持 `python`、`javascript`、`typescript`、`go`、`java`、`vue`、`sql` 七类语言，解析 File/Class/Function/Type/Test 节点和 CONTAINS/IMPORTS_FROM/CALLS/INHERITS/IMPLEMENTS/TESTED_BY/DEPENDS_ON/REFERENCES 边。
- **新增 Node.js 生态解析能力**：在 JavaScript/TypeScript adapter 下支持 CommonJS `require`、`module.exports`、`exports.*`、ESM import/export、`package.json` main/exports/imports、Node built-in module 标记和常见测试框架识别。
- **新增全量和增量索引命令**：提供 `ocr graph build --full` 和 `ocr graph update`，支持按 git diff/staged/working-tree 更新图谱。
- **新增图谱查询命令**：提供 `ocr graph status/query/impact/context`，供 AI workflow、用户和 Dashboard 查询图谱。
- **新增 review/map 图谱上下文 artifact**：生成 `.ocr/sessions/{id}/graph-context.md` 和 `.ocr/sessions/{id}/graph-context.json`，供 Tech Lead、Reviewer、Map Architect、Flow Analyst 使用。
- **修改 review 流程**：在 context discovery 后生成图谱上下文，Tech Lead 用图谱影响范围和测试缺口辅助 reviewer 选择与指导，Reviewer 可按需调用 `ocr graph query` 深挖。
- **修改 map 流程**：在 map-context 后生成图谱上下文，Topology/Flow Analysis 使用图谱辅助分组、上下游依赖和 review order，但 canonical changed files 仍来自 git。
- **修改 Dashboard**：展示 graph status、graph context artifact、unsupported changed files、risk/test gap/impact 摘要，并提供 graph query API。

## Impact

- **Affected specs**：新增 `code-graph`，修改 `cli`、`context-discovery`、`review-orchestration`、`review-map`、`dashboard`、`session-management`。
- **Affected code**：`packages/shared/graph` 新模块；`packages/cli` 新增 graph commands；`packages/dashboard` 新增 graph API/UI；`packages/agents` 和 `.ocr/skills` 更新 workflow 文档。
- **Breaking changes**：无。图谱缺失、stale、解析失败或遇到 unsupported language 时，review/map 必须继续按现有流程运行。
- **New dependencies**：Tree-sitter WASM runtime/grammar assets、纯 JS 图遍历依赖；不得引入 Python runtime 或 native SQLite。
- **Initial language scope**：仅支持 `python`、`javascript`、`typescript`、`go`、`java`、`vue`、`sql`。其他语言 v1 不支持，记录为 unsupported，不阻断 OCR。
