import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { analyzeChangedSymbols } from "./changes.js";
import { detectLanguage } from "../language.js";
import { getChangedFiles } from "../indexer/indexer.js";
import { getImpactRadiusForNodes, toExplorationStatus } from "../query/query.js";
import { buildNextToolSuggestions } from "../suggestions.js";
import { GraphStore } from "../storage/db.js";
import type {
  GenerateGraphReviewAnalysisOptions,
  GraphContextWarning,
  GraphModuleSummary,
  GraphNode,
  GraphPriority,
  GraphReviewAnalysis,
  GraphReviewAnalysisHint,
  GraphReviewAnalysisHintKind,
  GraphTestGap,
} from "../types.js";
import { graphDbPath } from "../utils.js";

const MAX_MODULE_SUMMARY_EDGES = 50_000;

export async function generateGraphReviewAnalysis(
  options: GenerateGraphReviewAnalysisOptions,
): Promise<GraphReviewAnalysis> {
  const startedAt = Date.now();
  const phases: NonNullable<GraphReviewAnalysis["performance"]>["phases"] = [];
  const dbPath = graphDbPath(options.repoRoot, options.ocrDir);
  const warnings: string[] = [];
  const changedFiles = resolveChangedFiles(options, warnings);
  const unsupportedChangedFiles = changedFiles.filter((file) => detectLanguage(file) === null);

  if (!existsSync(dbPath)) {
    const message = "Graph database missing. Run `ocr graph build --full` to enable graph review analysis.";
    const analysis = emptyAnalysis({
      status: "missing",
      workflow: options.workflow,
      changedFiles,
      changedSymbolPrecision: "none",
      warnings: [message],
      unsupportedChangedFiles,
    });
    maybeWriteArtifacts(analysis, options.sessionDir, options.writeArtifacts);
    return analysis;
  }

  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    const markPhase = (phase: string, downgradedReason?: string): void => {
      phases.push({
        phase,
        elapsedMs: Date.now() - startedAt,
        nodeCount: store.status().nodeCount,
        edgeCount: store.edgeCount(),
        downgradedReason,
      });
    };
    const status = store.status();
    warnings.push(...status.warnings);
    const graphStatus = toExplorationStatus(status.status);
    warnings.push(...graphStatus.warnings);
    markPhase("status");

    const changedSymbolAnalysis = analyzeChangedSymbols(store, options.repoRoot, {
      base: options.base,
      changedFiles,
    });
    warnings.push(...changedSymbolAnalysis.warnings.map((warning) => warning.message));
    markPhase("changed_symbols");

    const changedNodes = changedSymbolAnalysis.changedNodes;
    const impact = getImpactRadiusForNodes(
      store,
      changedNodes,
      options.maxDepth ?? 2,
      options.maxNodes ?? 200,
      graphStatus.status,
      [...status.warnings, ...graphStatus.warnings],
    );
    const impactedNodes = impact.nodes ?? [];
    const impactedFiles = impact.files ?? [];
    markPhase("impact_radius");
    const affectedFlows = store.flowsForNodes([
      ...changedNodes.map((node) => node.qualifiedName),
      ...impactedNodes.map((node) => node.qualifiedName),
    ]);
    const testGaps = findTestGaps(
      store,
      changedNodes,
      changedFiles,
      affectedFlows,
      changedSymbolAnalysis.changedSymbolPrecision,
    );
    const priorities = prioritize(impactedNodes, testGaps, affectedFlows).slice(0, 20);
    let modules: GraphModuleSummary[] = [];
    let maxModules = options.maxModules ?? 0;
    let downgradedReason: string | undefined;
    const edgeCount = store.edgeCount();
    if (maxModules > 0 && edgeCount > MAX_MODULE_SUMMARY_EDGES) {
      downgradedReason = `Skipping module summaries for large graph (${edgeCount} edge(s)); rerun with a smaller graph scope or explicit offline build.`;
      warnings.push(downgradedReason);
      maxModules = 0;
    }
    if (maxModules > 0) {
      try {
        modules = summarizeModules(
          store,
          changedFiles,
          changedNodes,
          impactedNodes,
          maxModules,
        );
      } catch (error) {
        warnings.push(`Graph module summary unavailable: ${formatErrorMessage(error)}.`);
      }
    }
    markPhase("module_summaries", downgradedReason);
    const hints = buildHints(
      changedFiles,
      changedNodes,
      impactedNodes,
      priorities,
      testGaps,
      modules,
      options.maxHints ?? 8,
    );

    const maxFiles = options.maxFiles ?? 30;
    const drilldown: GraphReviewAnalysis["drilldown"] = {
      impactedFiles: impactedFiles.slice(0, maxFiles),
      impactedNodes: impactedNodes.slice(0, options.maxNodes ?? 200),
      flows: affectedFlows.slice(0, 10),
      testGaps: testGaps.slice(0, 20),
      unsupportedChangedFiles,
    };

    const truncated =
      impactedFiles.length > maxFiles ||
      impactedNodes.length > (options.maxNodes ?? 200) ||
      hints.length >= (options.maxHints ?? 8) && rawHintCount(changedFiles, modules, testGaps, priorities) > hints.length ||
      maxModules > 0 && modules.length >= maxModules && countPotentialModules(changedFiles, impactedFiles) > modules.length;
    const truncationReason = truncated
      ? "Graph review analysis exceeded one or more configured output limits."
      : undefined;

    const dedupedWarnings = [...new Set([...warnings, ...impact.warnings])];
    const analysis: GraphReviewAnalysis = {
      status: graphStatus.status,
      summary: buildSummary(changedFiles, changedNodes, impactedFiles, priorities, hints, modules, graphStatus.status),
      changedSymbols: changedNodes,
      priorities,
      hints,
      modules,
      drilldown,
      warnings: dedupedWarnings,
      truncated,
      generatedAt: new Date().toISOString(),
      sourceScope: {
        workflow: options.workflow,
        changedFileCount: changedFiles.length,
        changedSymbolPrecision: changedSymbolAnalysis.changedSymbolPrecision,
      },
      nextToolSuggestions: buildNextToolSuggestions({
        status: graphStatus.status,
        workflow: options.workflow,
        changedFiles,
        priorities,
        nodes: changedNodes,
        files: drilldown.impactedFiles,
      }),
      performance: {
        phases,
        totalElapsedMs: Date.now() - startedAt,
        nodeCount: status.nodeCount,
        edgeCount,
        truncationReason,
        downgradedReason,
      },
    };
    maybeWriteArtifacts(analysis, options.sessionDir, options.writeArtifacts);
    return analysis;
  } finally {
    store.close();
  }
}

function resolveChangedFiles(options: GenerateGraphReviewAnalysisOptions, warnings: string[]): string[] {
  if (options.changedFiles) {
    return options.changedFiles;
  }

  const sessionChangedFiles = loadSessionChangedFiles(options);
  if (sessionChangedFiles) {
    warnings.push(`Using session-scoped changed files from ${options.sessionDir}.`);
    return sessionChangedFiles;
  }

  return getChangedFiles(options.repoRoot, { base: options.base });
}

function loadSessionChangedFiles(options: GenerateGraphReviewAnalysisOptions): string[] | null {
  if (!options.sessionDir) {
    return null;
  }

  const candidatePaths = [
    join(options.sessionDir, 'graph-context.json'),
    join(options.sessionDir, 'graph-review-analysis.json'),
  ];

  for (const candidatePath of candidatePaths) {
    const changedFiles = readChangedFilesFromArtifact(candidatePath, options.repoRoot);
    if (changedFiles && changedFiles.length > 0) {
      return changedFiles;
    }
  }

  return null;
}

function readChangedFilesFromArtifact(filePath: string, repoRoot: string): string[] | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      changedFiles?: unknown
      drilldown?: { unsupportedChangedFiles?: unknown }
      sourceScope?: { changedFileCount?: unknown }
    };
    if (!Array.isArray(parsed.changedFiles)) {
      return null;
    }

    return normalizeChangedFiles(parsed.changedFiles, repoRoot);
  } catch {
    return null;
  }
}

function normalizeChangedFiles(changedFiles: unknown[], repoRoot: string): string[] {
  const normalized = changedFiles
    .filter((file): file is string => typeof file === 'string' && file.trim().length > 0)
    .map((file) => normalizeChangedFilePath(file, repoRoot));
  return [...new Set(normalized)];
}

function normalizeChangedFilePath(filePath: string, repoRoot: string): string {
  const normalizedPath = filePath.replaceAll('\\', '/');
  if (!isAbsolute(normalizedPath)) {
    return normalizedPath;
  }
  return relative(repoRoot, resolve(normalizedPath)).replaceAll('\\', '/');
}

function emptyAnalysis(input: {
  status: GraphReviewAnalysis["status"];
  workflow: GraphReviewAnalysis["sourceScope"]["workflow"];
  changedFiles: string[];
  changedSymbolPrecision: GraphReviewAnalysis["sourceScope"]["changedSymbolPrecision"];
  warnings: string[];
  unsupportedChangedFiles: string[];
}): GraphReviewAnalysis {
  return {
    status: input.status,
    summary: input.status === "missing"
      ? "Graph review analysis unavailable because the graph database is missing."
      : "No graph review analysis available.",
    changedSymbols: [],
    priorities: [],
    hints: [],
    modules: [],
    drilldown: {
      impactedFiles: [],
      impactedNodes: [],
      flows: [],
      testGaps: [],
      unsupportedChangedFiles: input.unsupportedChangedFiles,
    },
    warnings: input.warnings,
    truncated: false,
    generatedAt: new Date().toISOString(),
    sourceScope: {
      workflow: input.workflow,
      changedFileCount: input.changedFiles.length,
      changedSymbolPrecision: input.changedSymbolPrecision,
    },
    nextToolSuggestions: buildNextToolSuggestions({
      status: input.status,
      workflow: input.workflow,
      changedFiles: input.changedFiles,
    }),
  };
}

function buildSummary(
  changedFiles: string[],
  changedNodes: GraphNode[],
  impactedFiles: string[],
  priorities: GraphPriority[],
  hints: GraphReviewAnalysisHint[],
  modules: GraphModuleSummary[],
  status: GraphReviewAnalysis["status"],
): string {
  const topPriority = priorities[0]?.qualifiedName;
  const moduleLead = modules[0]?.name;
  const base = `Graph review analysis: ${changedFiles.length} changed file(s), ${changedNodes.length} changed symbol(s), ${impactedFiles.length} impacted file(s).`;
  const priority = topPriority ? ` Start review with ${topPriority}.` : "";
  const moduleSummary = moduleLead ? ` Most affected module: ${moduleLead}.` : "";
  const degraded = status === "degraded" ? " Graph coverage is degraded; treat hints as partial." : "";
  const stale = status === "stale" ? " Graph is stale; rebuild before relying on detailed traversal." : "";
  const hintSummary = hints.length > 0 ? ` ${hints.length} reviewer hint(s) available.` : "";
  return `${base}${priority}${moduleSummary}${hintSummary}${degraded}${stale}`;
}

function summarizeModules(
  store: GraphStore,
  changedFiles: string[],
  changedNodes: GraphNode[],
  impactedNodes: GraphNode[],
  maxModules: number,
): GraphModuleSummary[] {
  const impactedFiles = [...new Set(impactedNodes.map((node) => node.filePath))];
  const changedByModule = groupByModule(changedFiles);
  const impactedByModule = groupByModule(impactedFiles);
  const candidateModules = [...new Set([...changedByModule.keys(), ...impactedByModule.keys()])];
  const bridgeSummaries = new Map(
    store.moduleBridgeSummaries(candidateModules).map((summary) => [summary.sourceModule, summary]),
  );

  return candidateModules
    .map((name) => {
      const changedModuleFiles = changedByModule.get(name) ?? [];
      const impactedModuleFiles = impactedByModule.get(name) ?? [];
      const impactedNodeSet = impactedNodes.filter((node) => moduleName(node.filePath) === name);
      const changedNodeSet = changedNodes.filter((node) => moduleName(node.filePath) === name);
      const bridgeSummary = bridgeSummaries.get(name);
      const crossModuleEdgeCount = bridgeSummary?.crossModuleEdgeCount ?? 0;
      const bridgeFiles = bridgeSummary?.bridgeFiles ?? [];
      const bridgeQualifiedNames = bridgeSummary?.bridgeQualifiedNames ?? [];
      return {
        name,
        changedFiles: changedModuleFiles,
        impactedFiles: impactedModuleFiles,
        changedSymbolCount: changedNodeSet.length,
        impactedSymbolCount: impactedNodeSet.length,
        crossModuleEdgeCount,
        bridgeFiles,
        bridgeQualifiedNames,
        summary: [
          `${name} has ${changedModuleFiles.length} changed file(s),`,
          `${impactedModuleFiles.length} impacted file(s),`,
          `and ${crossModuleEdgeCount} cross-module edge(s).`,
        ].join(" "),
      } satisfies GraphModuleSummary;
    })
    .sort((a, b) =>
      b.changedFiles.length - a.changedFiles.length
      || b.impactedFiles.length - a.impactedFiles.length
      || a.name.localeCompare(b.name),
    )
    .slice(0, maxModules);
}

function buildHints(
  changedFiles: string[],
  changedNodes: GraphNode[],
  impactedNodes: GraphNode[],
  priorities: GraphPriority[],
  testGaps: GraphTestGap[],
  modules: GraphModuleSummary[],
  maxHints: number,
): GraphReviewAnalysisHint[] {
  const hints: GraphReviewAnalysisHint[] = [];
  const topPriority = priorities[0];
  if (topPriority) {
    hints.push({
      kind: "review_order",
      severity: "info",
      message: `Start review with ${topPriority.qualifiedName} because it has the highest graph priority score.`,
      filePaths: [topPriority.filePath],
      qualifiedNames: [topPriority.qualifiedName],
    });
  }

  const flowEntryPriorities = priorities.filter((priority) => priority.reason.includes("flow entry")).slice(0, 2);
  for (const priority of flowEntryPriorities) {
    hints.push({
      kind: "boundary_crossing",
      severity: "warning",
      message: `${priority.qualifiedName} is a flow entry inside the impact radius and may cross review boundaries.`,
      filePaths: [priority.filePath],
      qualifiedNames: [priority.qualifiedName],
    });
  }

  const hotspotModules = modules.filter((module) => module.crossModuleEdgeCount >= 2).slice(0, 2);
  for (const module of hotspotModules) {
    hints.push({
      kind: "coupling_hotspot",
      severity: "warning",
      message: `${module.name} shows ${module.crossModuleEdgeCount} cross-module edges and should be reviewed for coupling impact.`,
      filePaths: module.bridgeFiles,
      qualifiedNames: module.bridgeQualifiedNames,
    });
  }

  const weaklyConnected = changedFiles.filter((file) => !impactedNodes.some((node) => node.filePath === file));
  for (const file of weaklyConnected.slice(0, 2)) {
    hints.push({
      kind: "weakly_connected_change",
      severity: "info",
      message: `${file} does not expand into graph-linked impacted symbols and may need manual review context.`,
      filePaths: [file],
    });
  }

  for (const gap of testGaps.slice(0, 2)) {
    hints.push({
      kind: "test_gap",
      severity: gap.severity === "high" ? "high" : "warning",
      message: `${gap.qualifiedName} has a ${gap.kind} signal: ${gap.reason}`,
      filePaths: [gap.filePath],
      qualifiedNames: [gap.qualifiedName],
    });
  }

  return dedupeHints(hints).slice(0, maxHints);
}

function dedupeHints(hints: GraphReviewAnalysisHint[]): GraphReviewAnalysisHint[] {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.kind}:${hint.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rawHintCount(
  changedFiles: string[],
  modules: GraphModuleSummary[],
  testGaps: GraphTestGap[],
  priorities: GraphPriority[],
): number {
  return (priorities.length > 0 ? 1 : 0) + Math.min(2, priorities.filter((priority) => priority.reason.includes("flow entry")).length) + Math.min(2, modules.filter((module) => module.crossModuleEdgeCount >= 2).length) + Math.min(2, changedFiles.length) + Math.min(2, testGaps.length);
}

function countPotentialModules(changedFiles: string[], impactedFiles: string[]): number {
  return new Set([...changedFiles, ...impactedFiles].map(moduleName)).size;
}

function groupByModule(files: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    const key = moduleName(file);
    const bucket = grouped.get(key) ?? [];
    bucket.push(file);
    grouped.set(key, bucket);
  }
  return grouped;
}

function moduleName(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join("/") : parts[0] ?? ".";
}

function findTestGaps(
  store: GraphStore,
  changedNodes: GraphNode[],
  changedFiles: string[],
  affectedFlows: GraphReviewAnalysis["drilldown"]["flows"],
  changedSymbolPrecision: GraphReviewAnalysis["sourceScope"]["changedSymbolPrecision"],
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
  affectedFlows: GraphReviewAnalysis["drilldown"]["flows"],
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

function pushGap(gaps: GraphTestGap[], seen: Set<string>, gap: GraphTestGap): void {
  const key = `${gap.kind}:${gap.qualifiedName}:${gap.filePath}:${gap.lineStart}`;
  if (seen.has(key)) return;
  seen.add(key);
  gaps.push(gap);
}

function maybeWriteArtifacts(analysis: GraphReviewAnalysis, sessionDir: string | undefined, writeArtifacts = true): void {
  if (!writeArtifacts || !sessionDir) return;
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "graph-review-analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
