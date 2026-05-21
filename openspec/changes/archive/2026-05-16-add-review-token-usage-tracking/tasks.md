title: "[任务] LLM Token 用量记录"
status: proposed
description: "实现 review/map 工作流 token 用量记录、查询和 Dashboard 接入的任务列表。"
specs:
  - sqlite-state
  - session-management
  - cli
  - dashboard

# [任务] LLM Token 用量记录

## 1. OpenSpec

- [x] 1.1 创建 `add-review-token-usage-tracking` change。
- [x] 1.2 编写 proposal、design、tasks。
- [x] 1.3 增加 sqlite-state、session-management、cli、dashboard spec delta。

## 2. 存储层

- [x] 2.1 新增 `agent_token_usage` migration。
- [x] 2.2 新增 token usage 类型定义。
- [x] 2.3 新增 `recordTokenUsage`。
- [x] 2.4 新增 workflow 汇总查询。
- [x] 2.5 增加 DB 单元测试。

## 3. CLI

- [x] 3.1 新增 `ocr usage record`。
- [x] 3.2 新增 `ocr usage show`。
- [x] 3.3 在 review/map presentation 阶段生成 `usage.md/json`。

## 4. Dashboard 与 Vendor Adapter

- [x] 4.1 新增 normalized `usage` event 类型。
- [x] 4.2 command runner 收到 `usage` event 后写入 token usage。
- [x] 4.3 Claude adapter 解析 vendor usage。
- [x] 4.4 OpenCode adapter 解析 vendor usage。
- [x] 4.5 Dashboard 展示 Token Usage 卡片。

## 5. 验证

- [x] 5.1 运行 CLI token usage 测试。
- [x] 5.2 运行 CLI build 验证。
- [x] 5.3 增加 workflow 级 e2e，验证 usage 缺失不阻塞 review close 且 artifact 自动生成。
- [x] 5.4 使用真实 Claude Code `stream-json` 输出验证 vendor usage 字段可被解析。
- [x] 5.5 使用真实 OpenCode workflow 验证 vendor usage 字段可被解析。

## 6. 外部环境阻塞处理

- [x] 6.1 当前默认 SiliconFlow 凭据仍返回 `401 Unauthorized: Api key is invalid`；已改用真实 OpenCode CLI + 本地 OpenAI-compatible mock provider 完成 deterministic usage 验证，并记录默认 provider 阻塞。
