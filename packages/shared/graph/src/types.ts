export const GRAPH_SCHEMA_VERSION = 3;
export const GRAPH_PARSER_VERSION = "1";

const GRAPH_EXPLORATION_STATUS_VALUES = ["ready", "missing", "stale", "degraded", "error"] as const;
const GRAPH_WORKFLOW_VALUES = ["review", "map"] as const;
const GRAPH_CHANGED_SYMBOL_PRECISION_VALUES = ["symbol", "file", "none"] as const;
const GRAPH_REVIEW_ANALYSIS_HINT_KIND_VALUES = [
  "review_order",
  "boundary_crossing",
  "coupling_hotspot",
  "weakly_connected_change",
  "test_gap",
] as const;
const GRAPH_REVIEW_ANALYSIS_HINT_SEVERITY_VALUES = ["info", "warning", "high"] as const;
const GRAPH_TEST_GAP_KIND_VALUES = [
  "no_test_edge_for_changed_function",
  "changed_flow_entry_without_test",
  "changed_testless_file",
] as const;
const GRAPH_TEST_GAP_SEVERITY_VALUES = ["high", "medium", "low"] as const;

export type SupportedLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "go"
  | "java"
  | "vue"
  | "sql";

export type NodeKind = "File" | "Class" | "Function" | "Type" | "Test";

export type EdgeKind =
  | "CONTAINS"
  | "IMPORTS_FROM"
  | "CALLS"
  | "INHERITS"
  | "IMPLEMENTS"
  | "TESTED_BY"
  | "DEPENDS_ON"
  | "REFERENCES";

export type GraphExplorationStatus = "ready" | "missing" | "stale" | "degraded" | "error";

export const graphExplorationStatusValues = GRAPH_EXPLORATION_STATUS_VALUES;

export function isGraphExplorationStatus(value: unknown): value is GraphExplorationStatus {
  return typeof value === "string" && GRAPH_EXPLORATION_STATUS_VALUES.includes(value as GraphExplorationStatus);
}

export type GraphStatusValue = GraphExplorationStatus | "building";

export type GraphWorkflow = "review" | "map";

export const graphWorkflowValues = GRAPH_WORKFLOW_VALUES;

export function isGraphWorkflow(value: unknown): value is GraphWorkflow {
  return typeof value === "string" && GRAPH_WORKFLOW_VALUES.includes(value as GraphWorkflow);
}

export type GraphNodeInput = {
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: SupportedLanguage;
  parentName?: string | null;
  isTest?: boolean;
  metadata?: Record<string, unknown>;
};

export type GraphNode = GraphNodeInput & {
  id: number;
};

export type GraphEdgeInput = {
  kind: EdgeKind;
  sourceQualified: string;
  targetQualified: string;
  filePath: string;
  line?: number;
  confidence?: number;
  confidenceTier?: "EXTRACTED" | "HEURISTIC" | "RESOLVED";
  metadata?: Record<string, unknown>;
};

export type GraphEdge = Required<Pick<GraphEdgeInput, "line" | "confidence" | "confidenceTier">> &
  Omit<GraphEdgeInput, "line" | "confidence" | "confidenceTier"> & {
    id: number;
  };

export type GraphFileRecord = {
  id: number;
  path: string;
  language: SupportedLanguage | "unsupported";
  hash: string;
  size: number;
  mtimeMs: number;
  parserVersion: string;
  indexedAt: string;
  status: "indexed" | "unsupported" | "error";
};

export type ParsedFileGraph = {
  language: SupportedLanguage;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  warnings: string[];
};

export type GraphStatus = {
  status: GraphStatusValue;
  dbPath: string;
  indexedFileCount: number;
  unsupportedFileCount: number;
  erroredFileCount: number;
  nodeCount: number;
  edgeCount: number;
  languages: SupportedLanguage[];
  lastIndexedAt?: string;
  warnings: string[];
};

export type GraphBuildResult = GraphStatus & {
  filesScanned: number;
  filesIndexed: number;
  filesSkipped: number;
  filesUnsupported: number;
  filesErrored: number;
  filesRemoved: number;
  filesChanged: number;
  postprocess: GraphPostprocessLevel;
  postprocessRan: boolean;
  postprocessWarnings?: string[];
};

export type GraphPostprocessLevel = "none" | "minimal" | "full";

export type GraphQueryPattern =
  | "callers_of"
  | "callees_of"
  | "imports_of"
  | "importers_of"
  | "tests_for"
  | "children_of"
  | "file_summary";

export type GraphQuery =
  | {
      kind: "pattern";
      pattern: GraphQueryPattern;
      target: string;
      limit?: number;
    }
  | {
      kind: "impact";
      changedFiles: string[];
      maxDepth?: number;
      maxNodes?: number;
    };

export type GraphQueryResult = {
  status: GraphExplorationStatus;
  summary: string;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  files?: string[];
  warnings: string[];
  truncated: boolean;
};

export type GraphFlow = {
  name: string;
  entryQualified: string;
  files: string[];
  criticality: number;
};

export type GraphWarningSeverity = "info" | "warning" | "error";

export type GraphContextWarningCode =
  | "git_diff_ranges_unavailable"
  | "git_diff_base_invalid"
  | "changed_ranges_no_symbol_overlap"
  | "graph_db_missing"
  | "graph_parser_stale"
  | "graph_update_failed";

export type GraphContextWarning = {
  code: GraphContextWarningCode;
  severity: GraphWarningSeverity;
  scope: "changed_symbols" | "graph_update" | "graph_status" | "workflow";
  message: string;
};

export type GraphChangedSymbolPrecision = "symbol" | "file" | "none";

export const graphChangedSymbolPrecisionValues = GRAPH_CHANGED_SYMBOL_PRECISION_VALUES;

export function isGraphChangedSymbolPrecision(value: unknown): value is GraphChangedSymbolPrecision {
  return typeof value === "string" && GRAPH_CHANGED_SYMBOL_PRECISION_VALUES.includes(value as GraphChangedSymbolPrecision);
}

export type GraphChangedSymbolReason =
  | "exact_overlap"
  | "range_unavailable"
  | "range_no_symbol_overlap"
  | "unsupported_only";

export type GraphUpdateStatus = "updated" | "noop" | "stale" | "failed";

export type GraphTestGapKind =
  | "no_test_edge_for_changed_function"
  | "changed_flow_entry_without_test"
  | "changed_testless_file";

export const graphTestGapKindValues = GRAPH_TEST_GAP_KIND_VALUES;

export function isGraphTestGapKind(value: unknown): value is GraphTestGapKind {
  return typeof value === "string" && GRAPH_TEST_GAP_KIND_VALUES.includes(value as GraphTestGapKind);
}

export type GraphTestGapSeverity = "high" | "medium" | "low";

export const graphTestGapSeverityValues = GRAPH_TEST_GAP_SEVERITY_VALUES;

export function isGraphTestGapSeverity(value: unknown): value is GraphTestGapSeverity {
  return typeof value === "string" && GRAPH_TEST_GAP_SEVERITY_VALUES.includes(value as GraphTestGapSeverity);
}

export type GraphTestGap = {
  qualifiedName: string;
  filePath: string;
  lineStart: number;
  kind: GraphTestGapKind;
  severity: GraphTestGapSeverity;
  reason: string;
};

export type GraphPriority = {
  qualifiedName: string;
  filePath: string;
  reason: string;
  score: number;
};

export type GraphChangedRange = {
  filePath: string;
  lineStart: number;
  lineEnd: number;
};

export type GraphSearchEntityType = "node" | "file";

export type GraphSearchMatchType = "name" | "qualified_name" | "file_path" | "kind" | "signature";

export type GraphSearchIndexRow = {
  entityType: GraphSearchEntityType;
  qualifiedName: string;
  filePath: string;
  name: string;
  kind: string;
  language: string;
  signatureTokens: string;
  searchText: string;
};

export type GraphSearchResultItem = {
  entityType: GraphSearchEntityType;
  qualifiedName: string;
  filePath: string;
  name: string;
  kind: string;
  language: string;
  matchTypes: GraphSearchMatchType[];
  score?: number;
  node?: GraphNode;
};

export type GraphSearchResult = {
  status: GraphExplorationStatus;
  query: string;
  summary: string;
  limit: number;
  results: GraphSearchResultItem[];
  warnings: string[];
  truncated: boolean;
};

export type GraphSearchOptions = GraphOptions & {
  query: string;
  limit?: number;
};

export type GraphReviewAnalysisHintKind =
  | "review_order"
  | "boundary_crossing"
  | "coupling_hotspot"
  | "weakly_connected_change"
  | "test_gap";

export const graphReviewAnalysisHintKindValues = GRAPH_REVIEW_ANALYSIS_HINT_KIND_VALUES;

export function isGraphReviewAnalysisHintKind(value: unknown): value is GraphReviewAnalysisHintKind {
  return typeof value === "string" && GRAPH_REVIEW_ANALYSIS_HINT_KIND_VALUES.includes(value as GraphReviewAnalysisHintKind);
}

export type GraphReviewAnalysisHint = {
  kind: GraphReviewAnalysisHintKind;
  severity: "info" | "warning" | "high";
  message: string;
  filePaths?: string[];
  qualifiedNames?: string[];
};

export type GraphReviewAnalysisHintSeverity = GraphReviewAnalysisHint["severity"];

export const graphReviewAnalysisHintSeverityValues = GRAPH_REVIEW_ANALYSIS_HINT_SEVERITY_VALUES;

export function isGraphReviewAnalysisHintSeverity(value: unknown): value is GraphReviewAnalysisHintSeverity {
  return typeof value === "string" && GRAPH_REVIEW_ANALYSIS_HINT_SEVERITY_VALUES.includes(value as GraphReviewAnalysisHintSeverity);
}

export type GraphModuleSummary = {
  name: string;
  changedFiles: string[];
  impactedFiles: string[];
  changedSymbolCount: number;
  impactedSymbolCount: number;
  crossModuleEdgeCount: number;
  bridgeFiles: string[];
  bridgeQualifiedNames: string[];
  summary: string;
};

export type GraphModuleBridgeSummary = {
  sourceModule: string;
  crossModuleEdgeCount: number;
  bridgeFiles: string[];
  bridgeQualifiedNames: string[];
};

export type GraphReviewAnalysisDrilldown = {
  impactedFiles: string[];
  impactedNodes: GraphNode[];
  flows: GraphFlow[];
  testGaps: GraphTestGap[];
  unsupportedChangedFiles: string[];
};

export type GraphReviewAnalysis = {
  status: GraphExplorationStatus;
  summary: string;
  changedSymbols: GraphNode[];
  priorities: GraphPriority[];
  hints: GraphReviewAnalysisHint[];
  modules: GraphModuleSummary[];
  drilldown: GraphReviewAnalysisDrilldown;
  warnings: string[];
  truncated: boolean;
  generatedAt: string;
  sourceScope: {
    workflow: GraphWorkflow;
    changedFileCount: number;
    changedSymbolPrecision: GraphChangedSymbolPrecision;
  };
  performance?: {
    phases: Array<{
      phase: string;
      elapsedMs: number;
      nodeCount?: number;
      edgeCount?: number;
      downgradedReason?: string;
    }>;
    totalElapsedMs: number;
    nodeCount: number;
    edgeCount: number;
    truncationReason?: string;
    downgradedReason?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isGraphNode(value: unknown): value is GraphNode {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.id)
    && typeof value.kind === "string"
    && typeof value.name === "string"
    && typeof value.qualifiedName === "string"
    && typeof value.filePath === "string"
    && isFiniteNumber(value.lineStart)
    && isFiniteNumber(value.lineEnd)
    && typeof value.language === "string"
    && (value.parentName === undefined || value.parentName === null || typeof value.parentName === "string")
    && (value.isTest === undefined || typeof value.isTest === "boolean")
    && (value.metadata === undefined || isRecord(value.metadata))
  );
}

function isGraphFlow(value: unknown): value is GraphFlow {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string"
    && typeof value.entryQualified === "string"
    && isStringArray(value.files)
    && isFiniteNumber(value.criticality)
  );
}

function isGraphTestGap(value: unknown): value is GraphTestGap {
  if (!isRecord(value)) return false;
  return (
    typeof value.qualifiedName === "string"
    && typeof value.filePath === "string"
    && isFiniteNumber(value.lineStart)
    && isGraphTestGapKind(value.kind)
    && isGraphTestGapSeverity(value.severity)
    && typeof value.reason === "string"
  );
}

function isGraphPriority(value: unknown): value is GraphPriority {
  if (!isRecord(value)) return false;
  return (
    typeof value.qualifiedName === "string"
    && typeof value.filePath === "string"
    && typeof value.reason === "string"
    && isFiniteNumber(value.score)
  );
}

export function isGraphReviewAnalysisHint(value: unknown): value is GraphReviewAnalysisHint {
  if (!isRecord(value)) return false;
  return (
    isGraphReviewAnalysisHintKind(value.kind)
    && isGraphReviewAnalysisHintSeverity(value.severity)
    && typeof value.message === "string"
    && (value.filePaths === undefined || isStringArray(value.filePaths))
    && (value.qualifiedNames === undefined || isStringArray(value.qualifiedNames))
  );
}

export function isGraphModuleSummary(value: unknown): value is GraphModuleSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string"
    && isStringArray(value.changedFiles)
    && isStringArray(value.impactedFiles)
    && isFiniteNumber(value.changedSymbolCount)
    && isFiniteNumber(value.impactedSymbolCount)
    && isFiniteNumber(value.crossModuleEdgeCount)
    && isStringArray(value.bridgeFiles)
    && isStringArray(value.bridgeQualifiedNames)
    && typeof value.summary === "string"
  );
}

export function isGraphReviewAnalysisDrilldown(value: unknown): value is GraphReviewAnalysisDrilldown {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.impactedFiles)
    && Array.isArray(value.impactedNodes)
    && value.impactedNodes.every(isGraphNode)
    && Array.isArray(value.flows)
    && value.flows.every(isGraphFlow)
    && Array.isArray(value.testGaps)
    && value.testGaps.every(isGraphTestGap)
    && isStringArray(value.unsupportedChangedFiles)
  );
}

export function isGraphReviewAnalysis(value: unknown): value is GraphReviewAnalysis {
  if (!isRecord(value) || !isRecord(value.sourceScope)) return false;
  return (
    isGraphExplorationStatus(value.status)
    && typeof value.summary === "string"
    && Array.isArray(value.changedSymbols)
    && value.changedSymbols.every(isGraphNode)
    && Array.isArray(value.priorities)
    && value.priorities.every(isGraphPriority)
    && Array.isArray(value.hints)
    && value.hints.every(isGraphReviewAnalysisHint)
    && Array.isArray(value.modules)
    && value.modules.every(isGraphModuleSummary)
    && isGraphReviewAnalysisDrilldown(value.drilldown)
    && isStringArray(value.warnings)
    && typeof value.truncated === "boolean"
    && typeof value.generatedAt === "string"
    && isGraphWorkflow(value.sourceScope.workflow)
    && isFiniteNumber(value.sourceScope.changedFileCount)
    && isGraphChangedSymbolPrecision(value.sourceScope.changedSymbolPrecision)
    && (value.performance === undefined || isRecord(value.performance))
  );
}

export type GraphContext = {
  version: 1;
  workflow: GraphWorkflow;
  status: GraphStatusValue;
  graphUpdateStatus?: GraphUpdateStatus;
  changedFiles: string[];
  changedRanges: GraphChangedRange[];
  unsupportedChangedFiles: string[];
  changedSymbolPrecision: GraphChangedSymbolPrecision;
  changedSymbolReason?: GraphChangedSymbolReason;
  changedNodes: GraphNode[];
  impactedNodes: GraphNode[];
  impactedFiles: string[];
  affectedFlows: GraphFlow[];
  testGaps: GraphTestGap[];
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "unknown";
  reviewPriorities: GraphPriority[];
  suggestedQuestions: string[];
  warnings: string[];
  structuredWarnings: GraphContextWarning[];
};

export type GraphOptions = {
  repoRoot: string;
  ocrDir?: string;
};

export type GraphBuildProgress = {
  phase: "discovering" | "discovered" | "indexing" | "rebuilding_search" | "rebuilding_flows" | "saving" | "done";
  totalFiles?: number;
  processedFiles?: number;
  currentFile?: string;
  filesIndexed?: number;
  filesSkipped?: number;
  filesUnsupported?: number;
  filesErrored?: number;
  elapsedMs?: number;
  nodeCount?: number;
  edgeCount?: number;
  flowCount?: number;
  downgradedReason?: string;
};

export type BuildGraphOptions = GraphOptions & {
  mode?: "full";
  postprocess?: GraphPostprocessLevel;
  onProgress?: (progress: GraphBuildProgress) => void;
};

export type UpdateGraphOptions = GraphOptions & {
  base?: string;
  staged?: boolean;
  workingTree?: boolean;
  changedFiles?: string[];
  postprocess?: GraphPostprocessLevel;
};

export type GenerateGraphContextOptions = GraphOptions & {
  workflow: GraphWorkflow;
  sessionDir?: string;
  base?: string;
  changedFiles?: string[];
  maxDepth?: number;
  maxNodes?: number;
  writeArtifacts?: boolean;
  update?: boolean;
  postprocess?: GraphPostprocessLevel;
};

export type GenerateGraphReviewAnalysisOptions = GenerateGraphContextOptions & {
  maxFiles?: number;
  maxHints?: number;
  maxModules?: number;
};
