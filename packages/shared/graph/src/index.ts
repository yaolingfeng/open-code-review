import { existsSync } from "node:fs";
import { analyzeChangedSymbols, getChangedRanges, parseUnifiedDiffRanges } from "./analysis/changes.js";
import { GraphStore } from "./storage/db.js";
import { buildGraph, updateGraph } from "./indexer/indexer.js";
import { getImpactRadius, queryGraph, searchGraph } from "./query/query.js";
import { generateGraphContext, renderGraphContextMarkdown } from "./context/context.js";
import { generateGraphReviewAnalysis } from "./analysis/review-analysis.js";
import type { GraphOptions, GraphStatus } from "./types.js";
import { graphDbPath } from "./utils.js";

export async function getGraphStatus(options: GraphOptions): Promise<GraphStatus> {
  const dbPath = graphDbPath(options.repoRoot, options.ocrDir);
  if (!existsSync(dbPath)) {
    return {
      status: "missing",
      dbPath,
      indexedFileCount: 0,
      unsupportedFileCount: 0,
      erroredFileCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      languages: [],
      warnings: ["Graph database missing. Run `ocr graph build --full`."],
    };
  }
  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    return store.status();
  } finally {
    store.close();
  }
}

export {
  analyzeChangedSymbols,
  buildGraph,
  generateGraphContext,
  generateGraphReviewAnalysis,
  getChangedRanges,
  getImpactRadius,
  parseUnifiedDiffRanges,
  queryGraph,
  renderGraphContextMarkdown,
  searchGraph,
  updateGraph,
};
export {
  graphChangedSymbolPrecisionValues,
  graphExplorationStatusValues,
  graphReviewAnalysisHintKindValues,
  graphReviewAnalysisHintSeverityValues,
  graphTestGapKindValues,
  graphTestGapSeverityValues,
  graphWorkflowValues,
  isGraphChangedSymbolPrecision,
  isGraphExplorationStatus,
  isGraphModuleSummary,
  isGraphReviewAnalysis,
  isGraphReviewAnalysisDrilldown,
  isGraphReviewAnalysisHint,
  isGraphReviewAnalysisHintKind,
  isGraphReviewAnalysisHintSeverity,
  isGraphTestGapKind,
  isGraphTestGapSeverity,
  isGraphWorkflow,
} from "./types.js";
export type * from "./types.js";
