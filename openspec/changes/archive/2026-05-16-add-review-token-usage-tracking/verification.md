title: "[验证] LLM Token 用量记录"
status: proposed
description: "记录 add-review-token-usage-tracking 的本地验证结果、真实 vendor 输出验证和当前阻塞。"
specs:
  - sqlite-state
  - session-management
  - cli
  - dashboard

# [验证] LLM Token 用量记录

## 已通过验证

### OpenSpec

```bash
pnpm exec openspec validate add-review-token-usage-tracking --strict
```

结果：通过。

### CLI / DB / Workflow 测试

```bash
pnpm exec nx build cli
pnpm exec vitest run --config packages/cli-e2e/vitest.config.ts packages/cli-e2e/src/workflow-usage.test.ts
pnpm exec vitest run packages/cli/src/lib/state/__tests__/state.test.ts packages/cli/src/lib/db/__tests__/token-usage.test.ts
```

结果：通过。

### 真实 Claude Code Usage 输出

命令：

```bash
tmp=$(mktemp -t ocr-claude-usage.XXXXXX.jsonl)
printf 'Reply with exactly: OK\n' \
  | claude --print --output-format stream-json --verbose --max-turns 1 --allowedTools Read \
  > "$tmp"

pnpm exec tsx -e "
import { readFileSync } from 'node:fs';
import { ClaudeCodeAdapter } from './packages/dashboard/src/server/services/ai-cli/claude-adapter.ts';
const parser = new ClaudeCodeAdapter().createParser();
const events = readFileSync(process.argv[1], 'utf8').trim().split(/\n/).flatMap((line)=>parser.parseLine(line));
const usage = events.filter((event)=>event.type === 'usage');
console.log(JSON.stringify({usageCount: usage.length, usage}, null, 2));
" "$tmp"
```

结果：通过。真实 Claude Code `result` 事件包含：

- `usage.input_tokens`
- `usage.output_tokens`
- `usage.cache_read_input_tokens`
- `usage.cache_creation_input_tokens`
- `total_cost_usd`
- `modelUsage`

当前 `ClaudeCodeAdapter` 成功解析出 1 条 normalized `usage` event。

## 外部环境记录

### 真实 OpenCode Usage 输出

命令：

```bash
opencode run 'Reply with exactly: OK' --format json --agent plan
```

结果：当前环境返回：

```text
Unauthorized: "Api key is invalid"
```

OpenCode 进程输出 error event，但没有真实 provider usage payload，因此不能用当前默认 SiliconFlow provider 完成真实 usage 字段验证。后续已通过真实 OpenCode CLI + 本地 OpenAI-compatible mock provider 完成 deterministic schema 验证。

### 真实 OpenCode Workflow Usage 输出（本地 OpenAI-compatible mock provider）

默认 SiliconFlow 凭据仍不可用；显式使用 OpenAI provider 时，当前环境返回过 `503 Service temporarily unavailable`。为避免外部 provider 可用性阻塞 adapter schema 验证，已使用真实 `opencode` 1.2.18 CLI 和本地 OpenAI-compatible `/v1/responses` mock provider 重跑 workflow。

验证命令使用 `pnpm exec tsx` 启动本地 mock provider，随后执行：

```bash
opencode run 'Reply with exactly: OK' \
  --format json \
  --agent plan \
  --model openai/gpt-4o-mini
```

结果：通过。真实 OpenCode stdout 输出 `step_finish` 事件，usage 位于：

- `part.tokens.input`
- `part.tokens.output`
- `part.tokens.total`
- `part.tokens.reasoning`
- `part.tokens.cache.read`
- `part.tokens.cache.write`
- `part.cost`

当前 `OpenCodeAdapter` 成功解析出 1 条 normalized `usage` event：

```json
{
  "type": "usage",
  "inputTokens": 11,
  "outputTokens": 2,
  "cacheReadTokens": 0,
  "cacheWriteTokens": 0,
  "reasoningTokens": 0,
  "totalTokens": 13,
  "costUsd": 0.00000285
}
```

补充测试：

```bash
pnpm exec vitest run --config packages/dashboard/vitest.config.ts \
  packages/dashboard/src/server/services/ai-cli/__tests__/opencode-adapter.test.ts \
  packages/dashboard/src/server/services/ai-cli/__tests__/claude-adapter.test.ts
```

结果：通过，43 个测试全部通过。
