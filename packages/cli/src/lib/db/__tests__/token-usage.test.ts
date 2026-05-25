import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import {
  closeAllDatabases,
  compareWorkflowUsage,
  benchmarkWorkflowUsage,
  insertAgentSession,
  insertSession,
  openDatabase,
  recordTokenUsage,
  runMigrations,
  summarizeTokenUsageForWorkflow,
} from "../index.js";

let tmpDir: string;
let db: Database;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ocr-token-usage-test-"));
  db = await openDatabase(join(tmpDir, "test.db"));
  runMigrations(db);
  insertSession(db, {
    id: "review-1",
    branch: "feat/tokens",
    workflow_type: "review",
    session_dir: join(tmpDir, "sessions", "review-1"),
  });
});

describe("usage comparison", () => {
  it("compares token usage and exploration telemetry between workflows", () => {
    insertSession(db, {
      id: "review-2",
      branch: "feat/graph",
      workflow_type: "review",
      session_dir: join(tmpDir, "sessions", "review-2"),
    });
    recordTokenUsage(db, {
      workflow_id: "review-1",
      vendor: "claude",
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost_usd: 0.015,
    });
    recordTokenUsage(db, {
      workflow_id: "review-2",
      vendor: "claude",
      input_tokens: 70,
      output_tokens: 30,
      total_tokens: 100,
      cost_usd: 0.01,
    });
    db.run(
      `INSERT INTO command_executions (id, uid, command, args, workflow_id)
       VALUES (1, 'base-run', 'review', '[]', 'review-1'),
              (2, 'candidate-run', 'review', '[]', 'review-2')`,
    );
    mkdirSync(join(tmpDir, ".ocr", "data", "events"), { recursive: true });
    writeFileSync(join(tmpDir, ".ocr", "data", "events", "1.jsonl"), [
      JSON.stringify({ type: "tool_call", name: "Read", input: { file_path: "src/a.ts" } }),
      JSON.stringify({ type: "tool_call", name: "Grep", input: { pattern: "auth" } }),
      JSON.stringify({ type: "tool_call", name: "Bash", input: { command: "rg auth" } }),
    ].join("\n"));
    writeFileSync(join(tmpDir, ".ocr", "data", "events", "2.jsonl"), [
      JSON.stringify({ type: "tool_call", name: "Bash", input: { command: "ocr graph minimal-context --workflow review --files src/a.ts --json" } }),
      JSON.stringify({ type: "tool_call", name: "Bash", input: { command: "ocr graph query tests_for --target src/a.ts#run" } }),
    ].join("\n"));

    const comparison = compareWorkflowUsage(db, join(tmpDir, ".ocr"), "review-1", "review-2");

    expect(comparison.delta.total_tokens.absolute).toBe(-50);
    expect(comparison.delta.input_tokens.absolute).toBe(-30);
    expect(comparison.delta.readCalls.absolute).toBe(-1);
    expect(comparison.delta.grepCalls.absolute).toBe(-1);
    expect(comparison.delta.graphCalls.absolute).toBe(2);
    expect(comparison.verdict.tokenEfficiencyImproved).toBe(true);
    expect(comparison.verdict.explorationImproved).toBe(true);
    expect(comparison.caveats).toEqual([]);
  });

  it("reports caveats for total-only usage and missing event journals", () => {
    insertSession(db, {
      id: "review-2",
      branch: "feat/graph",
      workflow_type: "review",
      session_dir: join(tmpDir, "sessions", "review-2"),
    });
    recordTokenUsage(db, {
      workflow_id: "review-1",
      vendor: "claude",
      total_tokens: 150,
    });
    recordTokenUsage(db, {
      workflow_id: "review-2",
      vendor: "claude",
      total_tokens: 120,
    });
    db.run(
      `INSERT INTO command_executions (id, uid, command, args, workflow_id)
       VALUES (3, 'base-run', 'review', '[]', 'review-1')`,
    );

    const comparison = compareWorkflowUsage(db, join(tmpDir, ".ocr"), "review-1", "review-2");

    expect(comparison.verdict.tokenEfficiencyImproved).toBeNull();
    expect(comparison.verdict.explorationImproved).toBeNull();
    expect(comparison.caveats.some((caveat) => caveat.includes("total-only usage rows"))).toBe(true);
    expect(comparison.caveats.some((caveat) => caveat.includes("event journal"))).toBe(true);
  });
});

describe("usage benchmark", () => {
  function insertReviewSession(id: string) {
    insertSession(db, {
      id,
      branch: "feat/graph-benchmark",
      workflow_type: "review",
      session_dir: join(tmpDir, "sessions", id),
    });
  }

  function recordRun({
    baseline,
    candidate,
    baselineTokens,
    candidateTokens,
    baselineBroadCalls,
    candidateBroadCalls,
    candidateGraphCalls,
    executionId,
  }: {
    baseline: string;
    candidate: string;
    baselineTokens: number;
    candidateTokens: number;
    baselineBroadCalls: number;
    candidateBroadCalls: number;
    candidateGraphCalls: number;
    executionId: number;
  }) {
    insertReviewSession(baseline);
    insertReviewSession(candidate);
    recordTokenUsage(db, {
      workflow_id: baseline,
      vendor: "claude",
      input_tokens: baselineTokens - 50,
      output_tokens: 50,
      total_tokens: baselineTokens,
      cost_usd: baselineTokens / 100000,
    });
    recordTokenUsage(db, {
      workflow_id: candidate,
      vendor: "claude",
      input_tokens: candidateTokens - 40,
      output_tokens: 40,
      total_tokens: candidateTokens,
      cost_usd: candidateTokens / 100000,
    });
    db.run(
      `INSERT INTO command_executions (id, uid, command, args, workflow_id)
       VALUES (?, ?, 'review', '[]', ?),
              (?, ?, 'review', '[]', ?)`,
      [
        executionId,
        `${baseline}-run`,
        baseline,
        executionId + 1,
        `${candidate}-run`,
        candidate,
      ],
    );
    mkdirSync(join(tmpDir, ".ocr", "data", "events"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".ocr", "data", "events", `${executionId}.jsonl`),
      Array.from({ length: baselineBroadCalls }, (_, index) => (
        JSON.stringify({ type: "tool_call", name: index % 2 === 0 ? "Read" : "Grep", input: { file_path: `src/${index}.ts` } })
      )).join("\n"),
    );
    writeFileSync(
      join(tmpDir, ".ocr", "data", "events", `${executionId + 1}.jsonl`),
      [
        ...Array.from({ length: candidateBroadCalls }, (_, index) => (
          JSON.stringify({ type: "tool_call", name: "Read", input: { file_path: `src/${index}.ts` } })
        )),
        ...Array.from({ length: candidateGraphCalls }, (_, index) => (
          JSON.stringify({ type: "tool_call", name: "Bash", input: { command: `ocr graph query callers --target src/${index}.ts#run` } })
        )),
      ].join("\n"),
    );
  }

  it("passes when median token and blind-search reductions meet thresholds and quality gate passes", () => {
    recordRun({
      baseline: "base-a",
      candidate: "graph-a",
      baselineTokens: 1000,
      candidateTokens: 850,
      baselineBroadCalls: 10,
      candidateBroadCalls: 6,
      candidateGraphCalls: 3,
      executionId: 10,
    });
    recordRun({
      baseline: "base-b",
      candidate: "graph-b",
      baselineTokens: 1100,
      candidateTokens: 900,
      baselineBroadCalls: 9,
      candidateBroadCalls: 5,
      candidateGraphCalls: 4,
      executionId: 20,
    });
    recordRun({
      baseline: "base-c",
      candidate: "graph-c",
      baselineTokens: 900,
      candidateTokens: 760,
      baselineBroadCalls: 8,
      candidateBroadCalls: 4,
      candidateGraphCalls: 2,
      executionId: 30,
    });

    const benchmark = benchmarkWorkflowUsage(db, join(tmpDir, ".ocr"), [
      { baseline: "base-a", candidate: "graph-a" },
      { baseline: "base-b", candidate: "graph-b" },
      { baseline: "base-c", candidate: "graph-c" },
    ], { qualityPass: true });

    expect(benchmark.verdict.status).toBe("passed");
    expect(benchmark.medians.totalTokenDeltaPct).toBeLessThanOrEqual(-0.1);
    expect(benchmark.medians.broadCallDeltaPct).toBeLessThanOrEqual(-0.2);
    expect(benchmark.verdict.caveats).toEqual([]);
  });

  it("stays inconclusive for graph-missing sessions with telemetry caveats", () => {
    insertReviewSession("base-missing");
    insertReviewSession("graph-missing");
    recordTokenUsage(db, {
      workflow_id: "base-missing",
      vendor: "claude",
      total_tokens: 1000,
    });
    recordTokenUsage(db, {
      workflow_id: "graph-missing",
      vendor: "claude",
      total_tokens: 850,
    });
    db.run(
      `INSERT INTO command_executions (id, uid, command, args, workflow_id)
       VALUES (100, 'base-missing-run', 'review', '[]', 'base-missing')`,
    );

    const benchmark = benchmarkWorkflowUsage(db, join(tmpDir, ".ocr"), [
      { baseline: "base-missing", candidate: "graph-missing" },
    ], { qualityPass: true });

    expect(benchmark.verdict.status).toBe("inconclusive");
    expect(benchmark.verdict.caveats.some((caveat) => caveat.includes("total-only usage rows"))).toBe(true);
    expect(benchmark.verdict.caveats.some((caveat) => caveat.includes("event journal"))).toBe(true);
  });

  it("does not pass without a manual quality gate even when telemetry improves", () => {
    recordRun({
      baseline: "base-quality",
      candidate: "graph-quality",
      baselineTokens: 1000,
      candidateTokens: 800,
      baselineBroadCalls: 10,
      candidateBroadCalls: 5,
      candidateGraphCalls: 2,
      executionId: 200,
    });
    recordRun({
      baseline: "base-quality-2",
      candidate: "graph-quality-2",
      baselineTokens: 1000,
      candidateTokens: 790,
      baselineBroadCalls: 10,
      candidateBroadCalls: 4,
      candidateGraphCalls: 2,
      executionId: 210,
    });
    recordRun({
      baseline: "base-quality-3",
      candidate: "graph-quality-3",
      baselineTokens: 1000,
      candidateTokens: 780,
      baselineBroadCalls: 10,
      candidateBroadCalls: 4,
      candidateGraphCalls: 2,
      executionId: 220,
    });

    const benchmark = benchmarkWorkflowUsage(db, join(tmpDir, ".ocr"), [
      { baseline: "base-quality", candidate: "graph-quality" },
      { baseline: "base-quality-2", candidate: "graph-quality-2" },
      { baseline: "base-quality-3", candidate: "graph-quality-3" },
    ]);

    expect(benchmark.verdict.status).toBe("inconclusive");
    expect(benchmark.verdict.caveats).toContain("质量门禁未标记为通过；token 降低不能单独视为成功。");
  });
});

afterEach(() => {
  closeAllDatabases();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("token usage ledger", () => {
  it("records usage against an agent session and summarizes by workflow", () => {
    insertAgentSession(db, {
      id: "agent-1",
      workflow_id: "review-1",
      vendor: "claude",
      persona: "principal",
      instance_index: 1,
      name: "principal-1",
      resolved_model: "claude-sonnet",
    });

    const row = recordTokenUsage(db, {
      agent_session_id: "agent-1",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      total_tokens: 160,
      cost_usd: 0.0123,
      source: "vendor_event",
      raw_usage_json: '{"ok":true}',
    });

    expect(row.workflow_id).toBe("review-1");
    expect(row.vendor).toBe("claude");
    expect(row.model).toBe("claude-sonnet");
    expect(row.total_tokens).toBe(160);

    const summary = summarizeTokenUsageForWorkflow(db, "review-1");
    expect(summary.row_count).toBe(1);
    expect(summary.total_tokens).toBe(160);
    expect(summary.cost_usd).toBe(0.0123);
    expect(summary.by_agent[0]).toMatchObject({
      agent_session_id: "agent-1",
      name: "principal-1",
      total_tokens: 160,
    });
  });

  it("supports workflow-level usage rows when no agent session is available", () => {
    const row = recordTokenUsage(db, {
      workflow_id: "review-1",
      vendor: "opencode",
      input_tokens: 10,
      output_tokens: 20,
    });

    expect(row.agent_session_id).toBeNull();
    expect(row.total_tokens).toBe(30);
  });
});
