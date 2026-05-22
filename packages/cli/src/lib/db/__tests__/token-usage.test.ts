import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import {
  closeAllDatabases,
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
