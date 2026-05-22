import type { Database } from "sql.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resultToRow, resultToRows } from "./result-mapper.js";
import type {
  InsertTokenUsageParams,
  TokenUsageRow,
  TokenUsageSummary,
} from "./types.js";

type AgentUsageContext = {
  id: number;
  uid: string | null;
  workflow_id: string | null;
  vendor: string | null;
  vendor_session_id: string | null;
  resolved_model: string | null;
  persona: string | null;
  name: string | null;
};

function nonNegative(value: number | undefined, label: string): number {
  const normalized = value ?? 0;
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return Math.trunc(normalized);
}

function optionalNonNegative(value: number | null | undefined, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function inferTotal(params: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total?: number;
}): number {
  if (params.total !== undefined) {
    return nonNegative(params.total, "total_tokens");
  }
  return params.input + params.output + params.cacheRead + params.cacheWrite + params.reasoning;
}

function getAgentUsageContext(
  db: Database,
  agentSessionId: string | null | undefined,
): AgentUsageContext | undefined {
  if (!agentSessionId) return undefined;
  return resultToRow<AgentUsageContext>(
    db.exec(
      `SELECT id, uid, workflow_id, vendor, vendor_session_id, resolved_model, persona, name
       FROM command_executions
       WHERE uid = ?`,
      [agentSessionId],
    ),
  );
}

export function recordTokenUsage(
  db: Database,
  params: InsertTokenUsageParams,
): TokenUsageRow {
  const agent = getAgentUsageContext(db, params.agent_session_id);
  if (params.agent_session_id && !agent) {
    throw new Error(`Agent session not found: ${params.agent_session_id}`);
  }

  const workflowId = params.workflow_id ?? agent?.workflow_id;
  if (!workflowId) {
    throw new Error("workflow_id is required when agent_session_id is not linked to a workflow");
  }

  const vendor = params.vendor ?? agent?.vendor;
  if (!vendor) {
    throw new Error("vendor is required when agent_session_id is not linked to a vendor");
  }

  const input = nonNegative(params.input_tokens, "input_tokens");
  const output = nonNegative(params.output_tokens, "output_tokens");
  const cacheRead = nonNegative(params.cache_read_tokens, "cache_read_tokens");
  const cacheWrite = nonNegative(params.cache_write_tokens, "cache_write_tokens");
  const reasoning = nonNegative(params.reasoning_tokens, "reasoning_tokens");
  const total = inferTotal({
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: params.total_tokens,
  });

  const source = params.source ?? "manual";
  const raw = params.raw_usage_json ?? null;
  if (raw !== null) {
    JSON.parse(raw);
  }

  db.run(
    `INSERT INTO agent_token_usage
       (workflow_id, agent_session_id, command_execution_id, vendor, vendor_session_id,
        model, phase, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        reasoning_tokens, total_tokens, cost_usd, source, raw_usage_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowId,
      params.agent_session_id ?? agent?.uid ?? null,
      agent?.id ?? null,
      vendor,
      params.vendor_session_id ?? agent?.vendor_session_id ?? null,
      params.model ?? agent?.resolved_model ?? null,
      params.phase ?? null,
      input,
      output,
      cacheRead,
      cacheWrite,
      reasoning,
      total,
      optionalNonNegative(params.cost_usd, "cost_usd"),
      source,
      raw,
    ],
  );

  const row = resultToRow<TokenUsageRow>(
    db.exec("SELECT * FROM agent_token_usage WHERE id = last_insert_rowid()"),
  );
  if (!row) {
    throw new Error("Failed to read recorded token usage row");
  }
  return row;
}

export function listTokenUsageForWorkflow(
  db: Database,
  workflowId: string,
): TokenUsageRow[] {
  return resultToRows<TokenUsageRow>(
    db.exec(
      `SELECT * FROM agent_token_usage
       WHERE workflow_id = ?
       ORDER BY recorded_at ASC, id ASC`,
      [workflowId],
    ),
  );
}

export function summarizeTokenUsageForWorkflow(
  db: Database,
  workflowId: string,
): TokenUsageSummary {
  const rows = listTokenUsageForWorkflow(db, workflowId);
  const costValues = rows
    .map((row) => row.cost_usd)
    .filter((value): value is number => typeof value === "number");

  const byAgentRows = resultToRows<{
    agent_session_id: string | null;
    name: string | null;
    persona: string | null;
    model: string | null;
    total_tokens: number;
    cost_usd: number | null;
  }>(
    db.exec(
      `SELECT
         u.agent_session_id,
         c.name,
         c.persona,
         COALESCE(u.model, c.resolved_model) AS model,
         SUM(u.total_tokens) AS total_tokens,
         CASE WHEN COUNT(u.cost_usd) = 0 THEN NULL ELSE SUM(u.cost_usd) END AS cost_usd
       FROM agent_token_usage u
       LEFT JOIN command_executions c ON c.uid = u.agent_session_id
       WHERE u.workflow_id = ?
       GROUP BY u.agent_session_id, c.name, c.persona, COALESCE(u.model, c.resolved_model)
       ORDER BY total_tokens DESC`,
      [workflowId],
    ),
  );

  return {
    workflow_id: workflowId,
    input_tokens: rows.reduce((sum, row) => sum + row.input_tokens, 0),
    output_tokens: rows.reduce((sum, row) => sum + row.output_tokens, 0),
    cache_read_tokens: rows.reduce((sum, row) => sum + row.cache_read_tokens, 0),
    cache_write_tokens: rows.reduce((sum, row) => sum + row.cache_write_tokens, 0),
    reasoning_tokens: rows.reduce((sum, row) => sum + row.reasoning_tokens, 0),
    total_tokens: rows.reduce((sum, row) => sum + row.total_tokens, 0),
    cost_usd: costValues.length === 0
      ? null
      : costValues.reduce((sum, value) => sum + value, 0),
    row_count: rows.length,
    by_agent: byAgentRows,
  };
}

export function renderTokenUsageMarkdown(summary: TokenUsageSummary): string {
  const lines = [
    "# Token Usage",
    "",
    `Workflow: ${summary.workflow_id}`,
    `Rows: ${summary.row_count}`,
    `Total tokens: ${summary.total_tokens}`,
    `Input tokens: ${summary.input_tokens}`,
    `Output tokens: ${summary.output_tokens}`,
    `Cache read tokens: ${summary.cache_read_tokens}`,
    `Cache write tokens: ${summary.cache_write_tokens}`,
    `Reasoning tokens: ${summary.reasoning_tokens}`,
    `Cost: ${summary.cost_usd === null ? "not recorded" : `$${summary.cost_usd.toFixed(6)}`}`,
    "",
    "## By Agent",
    "",
  ];

  if (summary.by_agent.length === 0) {
    lines.push("- None");
  } else {
    for (const agent of summary.by_agent) {
      const label = agent.name ?? agent.agent_session_id ?? "(workflow)";
      const model = agent.model ?? "(default)";
      const cost = agent.cost_usd === null ? "" : `, $${agent.cost_usd.toFixed(6)}`;
      lines.push(`- ${label} (${model}) - ${agent.total_tokens} tokens${cost}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function exportTokenUsageArtifacts(
  db: Database,
  workflowId: string,
  sessionDir: string,
): { usageJsonPath: string; usageMdPath: string } {
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  const summary = summarizeTokenUsageForWorkflow(db, workflowId);
  const rows = listTokenUsageForWorkflow(db, workflowId);
  const usageJsonPath = join(sessionDir, "usage.json");
  const usageMdPath = join(sessionDir, "usage.md");

  writeFileSync(usageJsonPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  writeFileSync(usageMdPath, renderTokenUsageMarkdown(summary));

  return { usageJsonPath, usageMdPath };
}
