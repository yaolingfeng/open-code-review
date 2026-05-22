import type { SessionStatus, WorkflowType, FindingTriage, FindingSeverity, ChatTargetType, RoundTriage, PostReviewStep } from '../../shared/types'

export type { SessionStatus, WorkflowType, FindingTriage, FindingSeverity, ChatTargetType, RoundTriage, PostReviewStep }

export type SessionSummary = {
  id: string
  branch: string
  session_dir: string
  status: SessionStatus
  workflow_type: WorkflowType
  current_phase: string
  phase_number: number
  current_round: number
  current_map_run: number
  started_at: string
  updated_at: string
  // Dashboard-derived per-workflow progress (not in CLI schema)
  has_review: boolean
  has_map: boolean
  review_phase_number: number
  review_phase: string
  map_phase_number: number
  map_phase: string
  latest_verdict: string | null
  latest_blocker_count: number
  latest_round_status: string | null
}

export type OrchestrationEvent = {
  id: number
  session_id: string
  event_type: string
  phase: string | null
  phase_number: number | null
  round: number | null
  metadata: string | null
  created_at: string
}

export type DashboardStats = {
  totalSessions: number
  activeSessions: number
  completedReviews: number
  completedMaps: number
  filesTracked: number
  unresolvedBlockers: number
}

export type ReviewRound = {
  id: number
  session_id: string
  round_number: number
  verdict: string | null
  blocker_count: number
  suggestion_count: number
  should_fix_count: number
  final_md_path: string | null
  parsed_at: string | null
  reviewer_outputs: ReviewerOutput[]
  progress?: RoundProgress | null
}

export type ReviewerOutput = {
  id: number
  round_id: number
  reviewer_type: string
  instance_number: number
  file_path: string
  finding_count: number
  parsed_at: string | null
}

export type Finding = {
  id: number
  reviewer_output_id: number
  title: string
  severity: FindingSeverity
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  is_blocker: number
  parsed_at: string | null
  progress?: FindingProgress | null
}

export type FindingProgress = {
  id: number
  finding_id: number
  status: FindingTriage
  updated_at: string
}

export type RoundProgress = {
  id: number
  round_id: number
  status: RoundTriage
  updated_at: string
}

// ── Agent sessions (per-instance lifecycle journal) ──

export type AgentSessionStatus =
  | 'spawning'
  | 'running'
  | 'done'
  | 'crashed'
  | 'cancelled'
  | 'orphaned'

export type AgentSessionRow = {
  id: string
  workflow_id: string
  vendor: string
  vendor_session_id: string | null
  persona: string | null
  instance_index: number | null
  name: string | null
  resolved_model: string | null
  phase: string | null
  status: AgentSessionStatus
  pid: number | null
  started_at: string
  last_heartbeat_at: string
  ended_at: string | null
  exit_code: number | null
  notes: string | null
}

export type AgentSessionsResponse = {
  workflow_id: string
  agent_sessions: AgentSessionRow[]
}

export type TokenUsageRow = {
  id: number
  workflow_id: string
  agent_session_id: string | null
  command_execution_id: number | null
  vendor: string
  vendor_session_id: string | null
  model: string | null
  phase: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  cost_usd: number | null
  source: 'manual' | 'vendor_event' | 'estimated'
  raw_usage_json: string | null
  recorded_at: string
}

export type TokenUsageSummary = {
  workflow_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  cost_usd: number | null
  row_count: number
  by_agent: Array<{
    agent_session_id: string | null
    name: string | null
    persona: string | null
    model: string | null
    total_tokens: number
    cost_usd: number | null
  }>
}

export type TokenUsageResponse = {
  summary: TokenUsageSummary
  rows: TokenUsageRow[]
}

// ── Terminal handoff payload (Spec 5) ──

// Mirror of server-side ResumeOutcome. Keep in sync with
// `packages/dashboard/src/server/services/capture/session-capture-service.ts`.
//
// Discriminated union: `kind: 'resumable'` carries a copyable vendor
// command pair; `kind: 'unresumable'` carries a typed reason + structured
// diagnostics. The panel switches on `kind` and never fabricates a
// command for the unresumable path.
//
// Single-source for the union: re-exported from the server-side
// `unresumable-microcopy.ts` (which derives the type from the
// `ALL_UNRESUMABLE_REASONS` const-assertion). Type-only imports get
// erased by the bundler, so this never pulls server runtime into the
// client bundle. Round-3 SF3: closes the previous client/server
// drift risk by eliminating the hand-maintained mirror.
export type { UnresumableReason } from '../../server/services/capture/unresumable-microcopy'
import type { UnresumableReason } from '../../server/services/capture/unresumable-microcopy'

export type CaptureDiagnostics = {
  vendor: string | null
  vendorBinaryAvailable: boolean
  invocationsForWorkflow: number
  sessionIdEventsObserved: number
  remediation: string
  microcopy: {
    headline: string
    cause: string
    remediation: string
  }
}

export type ResumeOutcome =
  | {
      kind: 'resumable'
      vendor: string
      vendorSessionId: string
      hostBinaryAvailable: boolean
      vendorCommand: string
    }
  | {
      kind: 'unresumable'
      reason: UnresumableReason
      diagnostics: CaptureDiagnostics
    }

export type HandoffPayload = {
  workflow_id: string
  /** Project root the resume command should `cd` into. Hoisted from
   *  ResumeOutcome arms (round-3 Suggestion 4). */
  projectDir: string
  outcome: ResumeOutcome
}

// ── Team composition ──

export type ReviewerInstance = {
  persona: string
  instance_index: number
  name: string
  model: string | null
}

export type TeamResolvedResponse = {
  team: ReviewerInstance[]
}

// ── Model discovery ──

export type ModelDescriptor = {
  id: string
  displayName?: string
  provider?: string
  tags?: string[]
}

export type ModelListResponse = {
  vendor: 'claude' | 'opencode' | null
  source: 'native' | 'bundled' | null
  models: ModelDescriptor[]
}

export type ReviewerOutputDetail = ReviewerOutput & {
  findings: Finding[]
}

export type Artifact = {
  id: number
  session_id: string
  artifact_type: string
  round_number: number | null
  file_path: string
  content: string
  parsed_at: string
}

export type GraphStatus = {
  status: 'ready' | 'missing' | 'stale' | 'degraded' | 'building' | 'error'
  dbPath: string
  indexedFileCount: number
  unsupportedFileCount: number
  nodeCount: number
  edgeCount: number
  languages: string[]
  lastIndexedAt?: string
  warnings: string[]
}

export type GraphSearchMatchType = 'name' | 'qualified_name' | 'file_path' | 'kind' | 'signature'

export type GraphSearchResultItem = {
  entityType: 'node' | 'file'
  qualifiedName: string
  filePath: string
  name: string
  kind: string
  language: string
  matchTypes: GraphSearchMatchType[]
  score?: number
}

export type GraphSearchResult = {
  status: 'ready' | 'missing' | 'stale' | 'degraded' | 'error'
  query: string
  summary: string
  limit: number
  results: GraphSearchResultItem[]
  warnings: string[]
  truncated: boolean
}

export type GraphPriority = {
  qualifiedName: string
  filePath: string
  reason: string
  score: number
}

export type GraphReviewAnalysisHint = {
  kind: 'review_order' | 'boundary_crossing' | 'coupling_hotspot' | 'weakly_connected_change' | 'test_gap'
  severity: 'info' | 'warning' | 'high'
  message: string
  filePaths?: string[]
  qualifiedNames?: string[]
}

export type GraphModuleSummary = {
  name: string
  changedFiles: string[]
  impactedFiles: string[]
  changedSymbolCount: number
  impactedSymbolCount: number
  crossModuleEdgeCount: number
  bridgeFiles: string[]
  bridgeQualifiedNames: string[]
  summary: string
}

export type GraphNode = {
  id: number
  kind: 'File' | 'Class' | 'Function' | 'Type' | 'Test'
  name: string
  qualifiedName: string
  filePath: string
  lineStart: number
  lineEnd: number
  language: string
  parentName?: string | null
  isTest?: boolean
  metadata?: Record<string, unknown>
}

export type GraphFlow = {
  name: string
  entryQualified: string
  files: string[]
  criticality: number
}

export type GraphTestGap = {
  qualifiedName: string
  filePath: string
  lineStart: number
  kind: 'no_test_edge_for_changed_function' | 'changed_flow_entry_without_test' | 'changed_testless_file'
  severity: 'high' | 'medium' | 'low'
  reason: string
}

export type GraphReviewAnalysis = {
  status: 'ready' | 'missing' | 'stale' | 'degraded' | 'error'
  summary: string
  changedSymbols: GraphNode[]
  priorities: GraphPriority[]
  hints: GraphReviewAnalysisHint[]
  modules: GraphModuleSummary[]
  drilldown: {
    impactedFiles: string[]
    impactedNodes: GraphNode[]
    flows: GraphFlow[]
    testGaps: GraphTestGap[]
    unsupportedChangedFiles: string[]
  }
  warnings: string[]
  truncated: boolean
  generatedAt: string
  sourceScope: {
    workflow: 'review' | 'map'
    changedFileCount: number
    changedSymbolPrecision: 'symbol' | 'file' | 'none'
  }
  performance?: {
    phases: Array<{
      phase: string
      elapsedMs: number
      nodeCount?: number
      edgeCount?: number
      downgradedReason?: string
    }>
    totalElapsedMs: number
    nodeCount: number
    edgeCount: number
    truncationReason?: string
    downgradedReason?: string
  }
}

export type MapRun = {
  id: number
  session_id: string
  run_number: number
  map_md_path: string | null
  parsed_at: string | null
  sections: MapSectionSummary[]
}

export type MapSectionSummary = {
  id: number
  map_run_id: number
  section_number: number
  title: string
  description: string | null
  file_count: number
  reviewed_count: number
}

export type MapSectionDetail = MapSectionSummary & {
  files: MapFile[]
}

export type MapFile = {
  id: number
  section_id: number
  file_path: string
  role: string | null
  lines_added: number
  lines_deleted: number
  display_order: number
  is_reviewed: boolean
  reviewed_at: string | null
}

export type SectionDependency = {
  fromSectionId: number | null
  fromSection: number
  fromTitle: string
  toSectionId: number | null
  toSection: number
  toTitle: string
  relationship: string
}

export type ChatConversation = {
  id: string
  session_id: string
  target_type: ChatTargetType
  target_id: number
  status: 'active' | 'expired'
  created_at: string
  last_active_at: string
}

export type ChatMessage = {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export type ChatToolStatus = {
  tool: string
  detail: string
  timestamp: number
}

// ── Live event stream (Phase 1 → 3) ──
//
// Mirrors the StreamEvent shape command-runner persists to JSONL and emits
// on the `command:event` socket channel. The server is authoritative; this
// type is a hand-mirror because the server lives in an unbundled package
// and the client can't directly import its types. Keep it in sync with
// `packages/dashboard/src/server/services/ai-cli/types.ts`.

export type NormalizedStreamEvent =
  | { type: 'message'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call'; toolId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_input_delta'; toolId: string; deltaJson: string }
  | { type: 'tool_result'; toolId: string; output: string; isError: boolean }
  | { type: 'error'; source: 'agent' | 'process'; message: string; detail?: string }
  | { type: 'session_id'; id: string }
  | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      reasoningTokens?: number
      totalTokens?: number
      costUsd?: number
      raw?: Record<string, unknown>
    }

export type StreamEvent = NormalizedStreamEvent & {
  executionId: number
  agentId: string
  parentAgentId?: string
  timestamp: string
  seq: number
}

export type CommandEventsResponse = {
  execution_id: number
  events: StreamEvent[]
}

export type PostCheckResult = {
  authenticated: boolean
  prNumber: number | null
  prUrl: string | null
  branch: string | null
  error?: string
}
