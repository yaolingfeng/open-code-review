import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChangedSymbols } from "../analysis/changes.js";
import { detectLanguage } from "../language.js";
import { getChangedFiles, updateGraph } from "../indexer/indexer.js";
import { GraphStore } from "../storage/db.js";
import {
  GRAPH_PARSER_VERSION,
  type GenerateGraphContextOptions,
  type GraphContext,
  type GraphContextWarning,
  type GraphNode,
  type GraphPriority,
  type GraphTestGap,
} from "../types.js";
import { graphDbPath } from "../utils.js";
import { getImpactRadiusForNodes, toExplorationStatus } from "../query/query.js";

export async function generateGraphContext(options: GenerateGraphContextOptions): Promise<GraphContext> {
  const dbPath = graphDbPath(options.repoRoot, options.ocrDir);
  const changedFiles = options.changedFiles ?? getChangedFiles(options.repoRoot, { base: options.base });
  const unsupportedChangedFiles = changedFiles.filter((file) => detectLanguage(file) === null);
  const warnings: string[] = [];
  const structuredWarnings: GraphContextWarning[] = [];

  if (!existsSync(dbPath)) {
    const message = "Graph database missing. Run `ocr graph build --full` to enable graph context.";
    warnings.push(message);
    structuredWarnings.push({
      code: "graph_db_missing",
      severity: "warning",
      scope: "graph_status",
      message,
    });
    const context = emptyContext(options.workflow, "missing", changedFiles, unsupportedChangedFiles, warnings, structuredWarnings);
    maybeWriteArtifacts(context, options.sessionDir, options.writeArtifacts);
    return context;
  }

  const updateResult = options.update
    ? await updateGraph({
      repoRoot: options.repoRoot,
      ocrDir: options.ocrDir,
      base: options.base,
      changedFiles,
      postprocess: options.postprocess ?? "minimal",
    })
    : null;
  if (updateResult) {
    warnings.push(...updateResult.warnings);
    structuredWarnings.push(...warningsForMessages(updateResult.warnings, "graph_update"));
  }
  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    const status = updateResult ?? store.status();
    warnings.push(...status.warnings);
    structuredWarnings.push(...warningsForMessages(status.warnings, "graph_status"));
    if (!options.update) {
      warnings.push("Graph context is read-only; run `ocr graph update` or `ocr graph build --full` to refresh stale graph data.");
    }
    const changedSymbolAnalysis = analyzeChangedSymbols(store, options.repoRoot, {
      base: options.base,
      changedFiles,
    });
    structuredWarnings.push(...changedSymbolAnalysis.warnings);
    warnings.push(...changedSymbolAnalysis.warnings.map((warning) => warning.message));
    const changedNodes = changedSymbolAnalysis.changedNodes;
    const affectedFlows = store.flowsForNodes([
      ...changedNodes.map((node) => node.qualifiedName),
    ]);
    const graphStatus = toExplorationStatus(status.status);
    warnings.push(...graphStatus.warnings);
    structuredWarnings.push(...warningsForMessages(graphStatus.warnings, "graph_status"));
    structuredWarnings.push(...stalenessWarnings(store, options.update ?? false));
    const updateWarnings = updateResult?.warnings ?? [];
    const impact = getImpactRadiusForNodes(
      store,
      changedNodes,
      options.maxDepth ?? 2,
      options.maxNodes ?? 500,
      graphStatus.status,
      [...updateWarnings, ...graphStatus.warnings],
    );
    const impactedNodes = impact.nodes ?? [];
    const impactedFiles = impact.files ?? [];
    const testGaps = findTestGaps(
      store,
      changedNodes,
      changedFiles,
      affectedFlows,
      changedSymbolAnalysis.changedSymbolPrecision,
    );
    const reviewPriorities = prioritize(impactedNodes, testGaps, affectedFlows);
    const allAffectedFlows = store.flowsForNodes([
      ...changedNodes.map((node) => node.qualifiedName),
      ...impactedNodes.map((node) => node.qualifiedName),
    ]);
    const riskScore = scoreRisk(
      impactedNodes.length,
      impactedFiles.length,
      testGaps,
      unsupportedChangedFiles.length,
      allAffectedFlows.length,
    );
    const impactWarnings = [...impact.warnings];
    structuredWarnings.push(...warningsForMessages(impactWarnings, "graph_status"));
    const context: GraphContext = {
      version: 1,
      workflow: options.workflow,
      status: status.status === "building" ? "degraded" : status.status,
      graphUpdateStatus:
        status.status === "stale"
          ? "stale"
          : !updateResult || changedFiles.length === 0 || updateResult.filesIndexed === 0
            ? "noop"
            : "updated",
      changedFiles,
      changedRanges: changedSymbolAnalysis.changedRanges,
      unsupportedChangedFiles,
      changedSymbolPrecision: changedSymbolAnalysis.changedSymbolPrecision,
      changedSymbolReason: changedSymbolAnalysis.changedSymbolReason,
      changedNodes,
      impactedNodes,
      impactedFiles,
      affectedFlows: allAffectedFlows,
      testGaps,
      riskScore,
      riskLevel: riskLevel(riskScore),
      reviewPriorities,
      suggestedQuestions: suggestedQuestions(reviewPriorities, unsupportedChangedFiles),
      warnings: [...new Set([...warnings, ...impactWarnings])],
      structuredWarnings: dedupeWarnings(structuredWarnings),
    };
    maybeWriteArtifacts(context, options.sessionDir, options.writeArtifacts);
    return context;
  } finally {
    store.close();
  }
}

function stalenessWarnings(store: GraphStore, updated: boolean): GraphContextWarning[] {
  if (updated) return [];
  const warnings: GraphContextWarning[] = [];
  const parserVersion = store.getMetadata("parser_version");
  if (parserVersion && parserVersion !== GRAPH_PARSER_VERSION) {
    warnings.push({
      code: "graph_parser_stale",
      severity: "warning",
      scope: "graph_status",
      message: "Graph parser version changed; run `ocr graph build --full` before relying on detailed traversal.",
    });
  }
  return warnings;
}

export function renderGraphContextMarkdown(context: GraphContext): string {
  const lines: string[] = [
    "# Graph Context",
    "",
    `Workflow: ${context.workflow}`,
    `Status: ${context.status}`,
    `Graph update: ${context.graphUpdateStatus ?? "noop"}`,
    `Changed symbol precision: ${context.changedSymbolPrecision}${context.changedSymbolReason ? ` (${context.changedSymbolReason})` : ""}`,
    `Risk: ${context.riskLevel} (${context.riskScore.toFixed(2)})`,
    "",
    "## Changed Files",
    "",
    ...listOrEmpty(context.changedFiles),
    "",
    "## Changed Ranges",
    "",
    ...listOrEmpty(context.changedRanges.map((range) => `${range.filePath}:${range.lineStart}-${range.lineEnd}`)),
    "",
    "## Changed Symbols",
    "",
    ...listOrEmpty(context.changedNodes.map((node) => `${node.qualifiedName} (${node.kind}, ${node.filePath}:${node.lineStart})`)),
    "",
    "## Unsupported Changed Files",
    "",
    ...listOrEmpty(context.unsupportedChangedFiles),
    "",
    "## Impacted Files",
    "",
    ...listOrEmpty(context.impactedFiles),
    "",
    "## Affected Flows",
    "",
    ...listOrEmpty(context.affectedFlows.map((flow) => `${flow.name} - ${flow.files.length} file(s), criticality ${flow.criticality.toFixed(2)}`)),
    "",
    "## Review Priorities",
    "",
    ...listOrEmpty(context.reviewPriorities.map((priority) => `${priority.qualifiedName} - ${priority.reason}`)),
    "",
    "## Test Gaps",
    "",
    ...listOrEmpty(context.testGaps.map((gap) => `${gap.qualifiedName} (${gap.filePath}:${gap.lineStart}) - ${gap.kind} [${gap.severity}] - ${gap.reason}`)),
    "",
    "## Suggested Questions",
    "",
    ...listOrEmpty(context.suggestedQuestions),
    "",
    "## Warnings",
    "",
    ...listOrEmpty(context.structuredWarnings.map((warning) => `[${warning.code}] ${warning.message}`)),
  ];
  return `${lines.join("\n")}\n`;
}

function emptyContext(
  workflow: GraphContext["workflow"],
  status: GraphContext["status"],
  changedFiles: string[],
  unsupportedChangedFiles: string[],
  warnings: string[],
  structuredWarnings: GraphContextWarning[],
): GraphContext {
  return {
    version: 1,
    workflow,
    status,
    graphUpdateStatus: status === "stale" ? "stale" : "noop",
    changedFiles,
    changedRanges: [],
    unsupportedChangedFiles,
    changedSymbolPrecision: "none",
    changedNodes: [],
    impactedNodes: [],
    impactedFiles: [],
    affectedFlows: [],
    testGaps: [],
    riskScore: 0,
    riskLevel: "unknown",
    reviewPriorities: [],
    suggestedQuestions: [],
    warnings,
    structuredWarnings,
  };
}

function findTestGaps(
  store: GraphStore,
  changedNodes: GraphNode[],
  changedFiles: string[],
  affectedFlows: GraphContext["affectedFlows"],
  changedSymbolPrecision: GraphContext["changedSymbolPrecision"],
): GraphTestGap[] {
  const gaps: GraphTestGap[] = [];
  const seen = new Set<string>();
  const flowEntrySet = new Set(affectedFlows.map((flow) => flow.entryQualified));

  for (const node of changedNodes) {
    if (node.kind !== "Function" || node.isTest) continue;
    if (store.edgesByTarget(node.qualifiedName, "TESTED_BY").length === 0) {
      pushGap(gaps, seen, {
        qualifiedName: node.qualifiedName,
        filePath: node.filePath,
        lineStart: node.lineStart,
        kind: "no_test_edge_for_changed_function",
        severity: "high",
        reason: "Changed function has no TESTED_BY edge in graph.",
      });
    }
    if (flowEntrySet.has(node.qualifiedName) && store.edgesByTarget(node.qualifiedName, "TESTED_BY").length === 0) {
      pushGap(gaps, seen, {
        qualifiedName: node.qualifiedName,
        filePath: node.filePath,
        lineStart: node.lineStart,
        kind: "changed_flow_entry_without_test",
        severity: "high",
        reason: "Changed flow entry has no TESTED_BY edge in graph.",
      });
    }
  }

  if (changedSymbolPrecision === "file") {
    for (const filePath of changedFiles.filter((file) => detectLanguage(file) !== null)) {
      const nodes = store.nodesByFile(filePath);
      const productionSymbols = nodes.filter((node) => node.kind !== "File" && !node.isTest);
      if (productionSymbols.length === 0) continue;
      const hasGraphLinkedTestSignal = productionSymbols.some(
        (node) => store.edgesByTarget(node.qualifiedName, "TESTED_BY").length > 0,
      );
      if (hasGraphLinkedTestSignal) continue;
      const anchor = productionSymbols[0] ?? nodes.find((node) => node.kind === "File");
      if (!anchor) continue;
      pushGap(gaps, seen, {
        qualifiedName: anchor.qualifiedName,
        filePath: anchor.filePath,
        lineStart: anchor.lineStart,
        kind: "changed_testless_file",
        severity: "low",
        reason: "File-level fallback found production symbols but no graph-linked test signal for the changed file.",
      });
    }
  }

  return gaps;
}

function prioritize(
  impactedNodes: GraphNode[],
  testGaps: GraphTestGap[],
  affectedFlows: GraphContext["affectedFlows"],
): GraphPriority[] {
  const gapSet = new Set(testGaps.map((gap) => gap.qualifiedName));
  const flowEntrySet = new Set(affectedFlows.map((flow) => flow.entryQualified));
  return impactedNodes
    .filter((node) => node.kind !== "File")
    .slice(0, 20)
    .map((node) => {
      const hasGap = gapSet.has(node.qualifiedName);
      const isFlowEntry = flowEntrySet.has(node.qualifiedName);
      return {
        qualifiedName: node.qualifiedName,
        filePath: node.filePath,
        reason: hasGap
          ? isFlowEntry
            ? "Changed flow entry has a test gap."
            : "Changed symbol has a test gap."
          : isFlowEntry
            ? "Symbol is a flow entry in the graph impact radius."
            : "Symbol is in the graph impact radius.",
        score: hasGap ? (isFlowEntry ? 0.98 : 0.9) : isFlowEntry ? 0.7 : 0.5,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function scoreRisk(
  impactedNodeCount: number,
  impactedFileCount: number,
  testGaps: GraphTestGap[],
  unsupportedCount: number,
  affectedFlowCount: number,
): number {
  const highSeverityGapCount = testGaps.filter((gap) => gap.severity === "high").length;
  const lowSeverityGapCount = testGaps.filter((gap) => gap.severity === "low").length;
  return Math.min(
    1,
    impactedNodeCount / 80 +
      impactedFileCount / 40 +
      highSeverityGapCount / 8 +
      lowSeverityGapCount / 20 +
      unsupportedCount / 10 +
      affectedFlowCount / 20,
  );
}

function riskLevel(score: number): GraphContext["riskLevel"] {
  if (score === 0) return "unknown";
  if (score >= 0.65) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

function suggestedQuestions(priorities: GraphPriority[], unsupportedChangedFiles: string[]): string[] {
  const questions: string[] = [];
  if (priorities.length > 0) {
    questions.push("Do the high-priority impacted symbols have enough direct review and test coverage?");
  }
  if (priorities.some((priority) => priority.reason.includes("test gap"))) {
    questions.push("Are the changed entry points and impacted symbols covered by graph-linked tests?");
  }
  if (unsupportedChangedFiles.length > 0) {
    questions.push("Do unsupported changed files require manual dependency tracing outside graph coverage?");
  }
  return questions;
}

function pushGap(gaps: GraphTestGap[], seen: Set<string>, gap: GraphTestGap): void {
  const key = `${gap.kind}:${gap.qualifiedName}:${gap.filePath}:${gap.lineStart}`;
  if (seen.has(key)) return;
  seen.add(key);
  gaps.push(gap);
}

function warningsForMessages(
  messages: string[],
  scope: GraphContextWarning["scope"],
): GraphContextWarning[] {
  return messages.map((message) => ({
    code: message.includes("parser version changed") ? "graph_parser_stale" : "graph_update_failed",
    severity: "warning",
    scope,
    message,
  }));
}

function dedupeWarnings(warnings: GraphContextWarning[]): GraphContextWarning[] {
  const seen = new Set<string>();
  const deduped: GraphContextWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.scope}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
}

function maybeWriteArtifacts(context: GraphContext, sessionDir: string | undefined, writeArtifacts = true): void {
  if (!writeArtifacts || !sessionDir) return;
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "graph-context.json"), `${JSON.stringify(context, null, 2)}\n`);
  writeFileSync(join(sessionDir, "graph-context.md"), renderGraphContextMarkdown(context));
}

function listOrEmpty(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- None"];
}
