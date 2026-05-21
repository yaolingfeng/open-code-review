# cli Spec Delta

title: "[规格] Token 用量 CLI"
status: proposed
description: "新增 `ocr usage` 命令用于记录和查看 LLM token 用量。"
specs:
  - cli

## ADDED Requirements

### Requirement: Usage CLI

系统 SHALL 提供 `ocr usage` 命令，用于记录和查看 workflow token 用量。

#### Scenario: Record workflow usage

- **GIVEN** 用户执行 `ocr usage record --workflow <id> --vendor claude --input-tokens 100 --output-tokens 50`
- **WHEN** 命令成功
- **THEN** 系统 SHALL 写入一条 `agent_token_usage`
- **AND** 如果未提供 `--total-tokens`，系统 SHALL 使用已提供 token 细分计算 total

#### Scenario: Record agent usage

- **GIVEN** 用户执行 `ocr usage record --agent-session <id> --input-tokens 100`
- **WHEN** `<id>` 对应 `command_executions.uid`
- **THEN** 系统 SHALL 从该 execution 继承 workflow、vendor 和 model 信息

#### Scenario: Show usage

- **GIVEN** workflow 已有 token usage
- **WHEN** 用户执行 `ocr usage show --workflow <id> --json`
- **THEN** 输出 SHALL 包含 `summary` 和 `rows`

#### Scenario: Export usage artifacts

- **GIVEN** workflow 已存在于 session state
- **WHEN** 用户执行 `ocr usage export --workflow <id>`
- **THEN** 系统 SHALL 在 session root 写入 `usage.md`
- **AND** 系统 SHALL 在 session root 写入 `usage.json`
