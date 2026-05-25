import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "sql.js";
import { resultToRows } from "./result-mapper.js";
import { listTokenUsageForWorkflow, summarizeTokenUsageForWorkflow } from "./token-usage.js";
import type { TokenUsageRow, TokenUsageSummary } from "./types.js";

export type UsageMetricDelta = {
  baseline: number | null;
  candidate: number | null;
  absolute: number | null;
  percent: number | null;
};

export type UsageExplorationTelemetry = {
  executionCount: number;
  eventCount: number;
  missingEventJournals: number;
  readCalls: number;
  grepCalls: number;
  bashCalls: number;
  graphCalls: number;
};

export type UsageComparisonSide = {
  workflow_id: string;
  summary: TokenUsageSummary;
  row_count: number;
  telemetry: UsageExplorationTelemetry;
  caveats: string[];
};

export type UsageComparison = {
  baseline: UsageComparisonSide;
  candidate: UsageComparisonSide;
  delta: {
    total_tokens: UsageMetricDelta;
    input_tokens: UsageMetricDelta;
    output_tokens: UsageMetricDelta;
    cache_read_tokens: UsageMetricDelta;
    cache_write_tokens: UsageMetricDelta;
    reasoning_tokens: UsageMetricDelta;
    cost_usd: UsageMetricDelta;
    row_count: UsageMetricDelta;
    readCalls: UsageMetricDelta;
    grepCalls: UsageMetricDelta;
    bashCalls: UsageMetricDelta;
    graphCalls: UsageMetricDelta;
  };
  verdict: {
    tokenEfficiencyImproved: boolean | null;
    explorationImproved: boolean | null;
    summary: string;
  };
  caveats: string[];
};

type CommandExecutionRow = {
  id: number;
  uid: string | null;
  workflow_id: string | null;
};

const ZERO_TELEMETRY: UsageExplorationTelemetry = {
  executionCount: 0,
  eventCount: 0,
  missingEventJournals: 0,
  readCalls: 0,
  grepCalls: 0,
  bashCalls: 0,
  graphCalls: 0,
};

export function compareWorkflowUsage(
  db: Database,
  ocrDir: string,
  baselineWorkflowId: string,
  candidateWorkflowId: string,
): UsageComparison {
  const baseline = usageComparisonSide(db, ocrDir, baselineWorkflowId);
  const candidate = usageComparisonSide(db, ocrDir, candidateWorkflowId);
  const caveats = [...baseline.caveats, ...candidate.caveats];
  const delta = {
    total_tokens: metricDelta(baseline.summary.total_tokens, candidate.summary.total_tokens),
    input_tokens: metricDelta(baseline.summary.input_tokens, candidate.summary.input_tokens),
    output_tokens: metricDelta(baseline.summary.output_tokens, candidate.summary.output_tokens),
    cache_read_tokens: metricDelta(baseline.summary.cache_read_tokens, candidate.summary.cache_read_tokens),
    cache_write_tokens: metricDelta(baseline.summary.cache_write_tokens, candidate.summary.cache_write_tokens),
    reasoning_tokens: metricDelta(baseline.summary.reasoning_tokens, candidate.summary.reasoning_tokens),
    cost_usd: metricDelta(baseline.summary.cost_usd, candidate.summary.cost_usd),
    row_count: metricDelta(baseline.row_count, candidate.row_count),
    readCalls: metricDelta(baseline.telemetry.readCalls, candidate.telemetry.readCalls),
    grepCalls: metricDelta(baseline.telemetry.grepCalls, candidate.telemetry.grepCalls),
    bashCalls: metricDelta(baseline.telemetry.bashCalls, candidate.telemetry.bashCalls),
    graphCalls: metricDelta(baseline.telemetry.graphCalls, candidate.telemetry.graphCalls),
  };
  const tokenEfficiencyImproved = caveats.some((caveat) => caveat.includes("usage rows"))
    || caveats.some((caveat) => caveat.includes("total-only"))
    ? null
    : delta.total_tokens.absolute !== null && delta.total_tokens.absolute < 0;
  const broadBaseline = broadExplorationCalls(baseline.telemetry);
  const broadCandidate = broadExplorationCalls(candidate.telemetry);
  const explorationImproved = caveats.some((caveat) => caveat.includes("event journal"))
    ? null
    : broadCandidate < broadBaseline && candidate.telemetry.graphCalls >= baseline.telemetry.graphCalls;

  return {
    baseline,
    candidate,
    delta,
    verdict: {
      tokenEfficiencyImproved,
      explorationImproved,
      summary: verdictSummary(tokenEfficiencyImproved, explorationImproved),
    },
    caveats,
  };
}

function broadExplorationCalls(telemetry: UsageExplorationTelemetry): number {
  return Math.max(0, telemetry.readCalls + telemetry.grepCalls + telemetry.bashCalls - telemetry.graphCalls);
}

function usageComparisonSide(db: Database, ocrDir: string, workflowId: string): UsageComparisonSide {
  const summary = summarizeTokenUsageForWorkflow(db, workflowId);
  const rows = listTokenUsageForWorkflow(db, workflowId);
  const telemetry = collectExplorationTelemetry(db, ocrDir, workflowId);
  const caveats = sideCaveats(workflowId, rows, summary, telemetry);
  return {
    workflow_id: workflowId,
    summary,
    row_count: rows.length,
    telemetry,
    caveats,
  };
}

function collectExplorationTelemetry(db: Database, ocrDir: string, workflowId: string): UsageExplorationTelemetry {
  const executions = commandExecutionsForWorkflow(db, workflowId);
  const telemetry = { ...ZERO_TELEMETRY, executionCount: executions.length };
  for (const execution of executions) {
    const path = join(ocrDir, "data", "events", `${execution.id}.jsonl`);
    if (!existsSync(path)) {
      telemetry.missingEventJournals += 1;
      continue;
    }
    const raw = safeRead(path);
    if (raw === null) {
      telemetry.missingEventJournals += 1;
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const event = safeParseJson(line);
      if (!event) continue;
      telemetry.eventCount += 1;
      accumulateToolTelemetry(telemetry, event);
    }
  }
  return telemetry;
}

function commandExecutionsForWorkflow(db: Database, workflowId: string): CommandExecutionRow[] {
  return resultToRows<CommandExecutionRow>(
    db.exec(
      `SELECT id, uid, workflow_id
       FROM command_executions
       WHERE workflow_id = ?
          OR parent_id IN (SELECT id FROM command_executions WHERE workflow_id = ?)
       ORDER BY started_at ASC, id ASC`,
      [workflowId, workflowId],
    ),
  );
}

function accumulateToolTelemetry(telemetry: UsageExplorationTelemetry, event: Record<string, unknown>): void {
  const type = String(event["type"] ?? "");
  if (type !== "tool_call" && type !== "tool_result" && type !== "tool_input_delta") return;
  const toolName = String(event["name"] ?? event["toolName"] ?? event["tool_name"] ?? "");
  const text = eventText(event);
  if (toolName === "Read") telemetry.readCalls += 1;
  if (toolName === "Grep") telemetry.grepCalls += 1;
  if (toolName === "Bash") telemetry.bashCalls += 1;
  if (text.includes("ocr graph ")) telemetry.graphCalls += 1;
}

function eventText(event: Record<string, unknown>): string {
  const values: string[] = [];
  for (const key of ["input", "args", "arguments", "text", "content"]) {
    const value = event[key];
    if (typeof value === "string") values.push(value);
    else if (value && typeof value === "object") values.push(JSON.stringify(value));
  }
  return values.join("\n");
}

function sideCaveats(
  workflowId: string,
  rows: TokenUsageRow[],
  summary: TokenUsageSummary,
  telemetry: UsageExplorationTelemetry,
): string[] {
  const caveats: string[] = [];
  if (rows.length === 0) {
    caveats.push(`${workflowId}: missing usage rows; token comparison is inconclusive.`);
  }
  if (rows.length > 0 && summary.total_tokens > 0 && summary.input_tokens === 0 && summary.output_tokens === 0) {
    caveats.push(`${workflowId}: total-only usage rows; input/output token details are incomplete.`);
  }
  if (summary.cost_usd === null) {
    caveats.push(`${workflowId}: provider cost was not recorded.`);
  }
  if (telemetry.executionCount === 0) {
    caveats.push(`${workflowId}: no command executions found for exploration telemetry.`);
  } else if (telemetry.missingEventJournals > 0) {
    caveats.push(`${workflowId}: ${telemetry.missingEventJournals} event journal(s) missing; exploration telemetry is partial.`);
  }
  return caveats;
}

function metricDelta(baseline: number | null, candidate: number | null): UsageMetricDelta {
  if (baseline === null || candidate === null) {
    return { baseline, candidate, absolute: null, percent: null };
  }
  const absolute = candidate - baseline;
  return {
    baseline,
    candidate,
    absolute,
    percent: baseline === 0 ? null : absolute / baseline,
  };
}

function verdictSummary(tokenEfficiencyImproved: boolean | null, explorationImproved: boolean | null): string {
  if (tokenEfficiencyImproved === null || explorationImproved === null) {
    return "Comparison has caveats; do not claim token or exploration improvement without reviewing missing details.";
  }
  if (tokenEfficiencyImproved && explorationImproved) {
    return "Candidate used fewer tokens and fewer broad exploration calls while increasing or preserving graph-guided calls.";
  }
  if (tokenEfficiencyImproved) {
    return "Candidate used fewer tokens, but exploration telemetry does not prove reduced blind searching.";
  }
  return "Candidate does not show a clear token-efficiency improvement.";
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function safeParseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
