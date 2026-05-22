/**
 * Database module types for OCR SQLite storage.
 */

import type { SessionStatus, WorkflowType } from "../state/types.js";

// ── Session types ──

export type { WorkflowType, SessionStatus } from "../state/types.js";

export type SessionRow = {
  id: string;
  branch: string;
  status: SessionStatus;
  workflow_type: WorkflowType;
  current_phase: string;
  phase_number: number;
  current_round: number;
  current_map_run: number;
  started_at: string;
  updated_at: string;
  session_dir: string;
};

export type InsertSessionParams = {
  id: string;
  branch: string;
  workflow_type: WorkflowType;
  current_phase?: string;
  phase_number?: number;
  current_round?: number;
  current_map_run?: number;
  session_dir: string;
};

export type UpdateSessionParams = Partial<
  Pick<
    SessionRow,
    | "status"
    | "current_phase"
    | "phase_number"
    | "current_round"
    | "current_map_run"
    | "updated_at"
  >
>;

// ── Event types ──

export type EventRow = {
  id: number;
  session_id: string;
  event_type: string;
  phase: string | null;
  phase_number: number | null;
  round: number | null;
  metadata: string | null;
  created_at: string;
};

export type InsertEventParams = {
  session_id: string;
  event_type: string;
  phase?: string;
  phase_number?: number;
  round?: number;
  metadata?: string;
};

// ── Agent session types ──

import type { AgentSession, AgentVendor } from "../state/types.js";

export type {
  AgentSession,
  AgentSessionStatus,
  AgentVendor,
} from "../state/types.js";

/**
 * Row shape returned from `agent_sessions` selects.
 *
 * Mirrors the `AgentSession` type — kept as a separate alias so db-layer
 * consumers don't have to import from `state/types` directly.
 */
export type AgentSessionRow = AgentSession;

export type InsertAgentSessionParams = {
  id: string;
  workflow_id: string;
  vendor: AgentVendor;
  persona?: string | null;
  instance_index?: number | null;
  name?: string | null;
  resolved_model?: string | null;
  phase?: string | null;
  pid?: number | null;
  notes?: string | null;
};

export type UpdateAgentSessionParams = Partial<
  Pick<
    AgentSession,
    | "vendor_session_id"
    | "phase"
    | "status"
    | "pid"
    | "ended_at"
    | "exit_code"
    | "notes"
  >
>;

export type SweepResult = {
  orphanedIds: string[];
};

// ── Token usage types ──

export type TokenUsageSource = "manual" | "vendor_event" | "estimated";

export type TokenUsageRow = {
  id: number;
  workflow_id: string;
  agent_session_id: string | null;
  command_execution_id: number | null;
  vendor: string;
  vendor_session_id: string | null;
  model: string | null;
  phase: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  source: TokenUsageSource;
  raw_usage_json: string | null;
  recorded_at: string;
};

export type InsertTokenUsageParams = {
  workflow_id?: string | null;
  agent_session_id?: string | null;
  vendor?: string | null;
  vendor_session_id?: string | null;
  model?: string | null;
  phase?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  cost_usd?: number | null;
  source?: TokenUsageSource;
  raw_usage_json?: string | null;
};

export type TokenUsageSummary = {
  workflow_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  row_count: number;
  by_agent: Array<{
    agent_session_id: string | null;
    name: string | null;
    persona: string | null;
    model: string | null;
    total_tokens: number;
    cost_usd: number | null;
  }>;
};

// ── Migration types ──

export type Migration = {
  version: number;
  description: string;
  sql: string;
};

export type SchemaVersionRow = {
  version: number;
  applied_at: string;
  description: string;
};
