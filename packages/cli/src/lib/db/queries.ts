/**
 * Typed query functions for sessions and orchestration events.
 */

import type { Database } from "sql.js";
import type {
  EventRow,
  InsertEventParams,
  InsertSessionParams,
  SessionRow,
  UpdateSessionParams,
  WorkflowType,
} from "./types.js";
import { resultToRows, resultToRow } from "./result-mapper.js";

// ── Sessions ──

export function insertSession(db: Database, params: InsertSessionParams): void {
  const {
    id,
    branch,
    workflow_type,
    current_phase = "context",
    phase_number = 1,
    current_round = 1,
    current_map_run = 1,
    session_dir,
  } = params;

  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, branch, workflow_type, current_phase, phase_number, current_round, current_map_run, session_dir],
  );
}

export function updateSession(
  db: Database,
  id: string,
  params: UpdateSessionParams,
): void {
  const setClauses: string[] = [];
  const values: (string | number)[] = [];

  if (params.status !== undefined) {
    setClauses.push("status = ?");
    values.push(params.status);
  }
  if (params.current_phase !== undefined) {
    setClauses.push("current_phase = ?");
    values.push(params.current_phase);
  }
  if (params.phase_number !== undefined) {
    setClauses.push("phase_number = ?");
    values.push(params.phase_number);
  }
  if (params.current_round !== undefined) {
    setClauses.push("current_round = ?");
    values.push(params.current_round);
  }
  if (params.current_map_run !== undefined) {
    setClauses.push("current_map_run = ?");
    values.push(params.current_map_run);
  }

  if (setClauses.length === 0) {
    return;
  }

  // Always update updated_at when there's something to update
  setClauses.push("updated_at = datetime('now')");

  values.push(id);
  db.run(
    `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

export function getSession(db: Database, id: string): SessionRow | undefined {
  return resultToRow<SessionRow>(
    db.exec("SELECT * FROM sessions WHERE id = ?", [id]),
  );
}

export function getLatestActiveSession(db: Database): SessionRow | undefined {
  return resultToRow<SessionRow>(
    db.exec(
      "SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1",
    ),
  );
}

export function getAllSessions(db: Database): SessionRow[] {
  return resultToRows<SessionRow>(
    db.exec("SELECT * FROM sessions ORDER BY started_at DESC"),
  );
}

/**
 * Reset all derived state for a workflow id while preserving the session row.
 *
 * `--fresh` review/map runs intentionally reuse the deterministic session id
 * (`YYYY-MM-DD-branch`). Without this reset, old rounds, findings, command
 * executions, and orchestration events can bleed into the new run and make the
 * dashboard appear stuck on stale phases.
 */
export function resetSessionForFreshStart(
  db: Database,
  id: string,
  params: {
    branch: string;
    workflow_type: WorkflowType;
    session_dir: string;
    preserve_command_uid?: string;
  },
): void {
  const preserveUid = params.preserve_command_uid ?? null;

  // Break self-references first so command rows for the workflow can be removed
  // regardless of parent/child insertion order.
  if (preserveUid) {
    db.run(
      `UPDATE command_executions
         SET parent_id = NULL
       WHERE (workflow_id = ?
          OR parent_id IN (SELECT id FROM command_executions WHERE workflow_id = ?))
         AND COALESCE(uid, '') <> ?`,
      [id, id, preserveUid],
    );
  } else {
    db.run(
      `UPDATE command_executions
         SET parent_id = NULL
       WHERE workflow_id = ?
          OR parent_id IN (SELECT id FROM command_executions WHERE workflow_id = ?)`,
      [id, id],
    );
  }

  if (preserveUid) {
    db.run(
      "DELETE FROM command_executions WHERE workflow_id = ? AND COALESCE(uid, '') <> ?",
      [id, preserveUid],
    );
  } else {
    db.run("DELETE FROM command_executions WHERE workflow_id = ?", [id]);
  }
  db.run("DELETE FROM agent_token_usage WHERE workflow_id = ?", [id]);
  db.run("DELETE FROM orchestration_events WHERE session_id = ?", [id]);
  db.run("DELETE FROM markdown_artifacts WHERE session_id = ?", [id]);
  db.run("DELETE FROM chat_conversations WHERE session_id = ?", [id]);
  db.run(
    `DELETE FROM user_notes
      WHERE target_type = 'finding'
        AND target_id IN (
          SELECT CAST(f.id AS TEXT)
            FROM review_findings f
            JOIN reviewer_outputs o ON o.id = f.reviewer_output_id
            JOIN review_rounds r ON r.id = o.round_id
           WHERE r.session_id = ?
        )`,
    [id],
  );
  db.run(
    `DELETE FROM user_notes
      WHERE target_type = 'round'
        AND target_id IN (
          SELECT CAST(id AS TEXT) FROM review_rounds WHERE session_id = ?
        )`,
    [id],
  );
  db.run(
    `DELETE FROM user_notes
      WHERE target_type = 'file'
        AND target_id IN (
          SELECT CAST(f.id AS TEXT)
            FROM map_files f
            JOIN map_sections s ON s.id = f.section_id
            JOIN map_runs r ON r.id = s.map_run_id
           WHERE r.session_id = ?
        )`,
    [id],
  );
  db.run(
    `DELETE FROM user_notes
      WHERE target_type = 'section'
        AND target_id IN (
          SELECT CAST(s.id AS TEXT)
            FROM map_sections s
            JOIN map_runs r ON r.id = s.map_run_id
           WHERE r.session_id = ?
        )`,
    [id],
  );
  db.run(
    `DELETE FROM user_notes
      WHERE target_type = 'run'
        AND target_id IN (
          SELECT CAST(id AS TEXT) FROM map_runs WHERE session_id = ?
        )`,
    [id],
  );
  db.run("DELETE FROM review_rounds WHERE session_id = ?", [id]);
  db.run("DELETE FROM map_runs WHERE session_id = ?", [id]);
  db.run("DELETE FROM user_notes WHERE target_type = 'session' AND target_id = ?", [id]);

  db.run(
    `UPDATE sessions
        SET branch = ?,
            workflow_type = ?,
            status = 'active',
            current_phase = 'context',
            phase_number = 1,
            current_round = 1,
            current_map_run = 1,
            session_dir = ?,
            started_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
    [params.branch, params.workflow_type, params.session_dir, id],
  );

  if (preserveUid) {
    db.run(
      `UPDATE command_executions
          SET workflow_id = ?,
              last_heartbeat_at = datetime('now')
        WHERE uid = ?`,
      [id, preserveUid],
    );
  }
}

// ── Events ──

export function insertEvent(db: Database, params: InsertEventParams): void {
  const {
    session_id,
    event_type,
    phase,
    phase_number,
    round,
    metadata,
  } = params;

  db.run(
    `INSERT INTO orchestration_events (session_id, event_type, phase, phase_number, round, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      session_id,
      event_type,
      phase ?? null,
      phase_number ?? null,
      round ?? null,
      metadata ?? null,
    ],
  );
}

export function getEventsForSession(
  db: Database,
  sessionId: string,
): EventRow[] {
  return resultToRows<EventRow>(
    db.exec(
      "SELECT * FROM orchestration_events WHERE session_id = ? ORDER BY id ASC",
      [sessionId],
    ),
  );
}

export function getLatestEventId(db: Database): number {
  const result = db.exec(
    "SELECT MAX(id) FROM orchestration_events",
  );
  if (result.length === 0 || result[0]?.values.length === 0) {
    return 0;
  }
  const val = result[0]?.values[0]?.[0];
  return typeof val === "number" ? val : 0;
}
