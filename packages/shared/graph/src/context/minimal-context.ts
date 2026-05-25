import { generateGraphReviewAnalysis } from "../analysis/review-analysis.js";
import { buildNextToolSuggestions } from "../suggestions.js";
import type {
  GenerateGraphMinimalContextOptions,
  GraphMinimalContext,
  GraphReviewAnalysis,
} from "../types.js";

export async function generateGraphMinimalContext(
  options: GenerateGraphMinimalContextOptions,
): Promise<GraphMinimalContext> {
  const maxPriorities = options.maxPriorities ?? 5;
  const maxWarnings = options.maxWarnings ?? 5;
  const maxSuggestions = options.maxSuggestions ?? 4;
  const analysis = await generateGraphReviewAnalysis({
    ...options,
    maxFiles: Math.min(options.maxFiles ?? 12, 12),
    maxHints: Math.min(options.maxHints ?? 4, 4),
    maxModules: 0,
    writeArtifacts: false,
  });
  const risk = riskFromAnalysis(analysis);
  const topPriorities = analysis.priorities.slice(0, maxPriorities);
  const warnings = analysis.warnings.slice(0, maxWarnings);
  const nextToolSuggestions = buildNextToolSuggestions({
    status: analysis.status,
    workflow: options.workflow,
    changedFiles: options.changedFiles,
    priorities: topPriorities,
    nodes: analysis.changedSymbols,
    files: analysis.drilldown.impactedFiles,
    maxSuggestions,
  });
  const truncated =
    analysis.truncated ||
    analysis.priorities.length > topPriorities.length ||
    analysis.warnings.length > warnings.length ||
    nextToolSuggestions.length >= maxSuggestions;

  return {
    version: 1,
    workflow: options.workflow,
    status: analysis.status,
    summary: analysis.summary,
    risk,
    counts: {
      changedFiles: analysis.sourceScope.changedFileCount,
      changedSymbols: analysis.changedSymbols.length,
      impactedFiles: analysis.drilldown.impactedFiles.length,
      testGaps: analysis.drilldown.testGaps.length,
    },
    topPriorities,
    warnings,
    nextToolSuggestions,
    budget: {
      maxPriorities,
      maxWarnings,
      maxSuggestions,
      truncated,
    },
    generatedAt: analysis.generatedAt,
    sourceScope: analysis.sourceScope,
  };
}

function riskFromAnalysis(analysis: GraphReviewAnalysis): GraphMinimalContext["risk"] {
  if (analysis.status === "missing") {
    return { level: "unknown", score: 0 };
  }
  const highGapCount = analysis.drilldown.testGaps.filter((gap) => gap.severity === "high").length;
  const score = Math.min(
    1,
    analysis.drilldown.impactedFiles.length / 30 +
      analysis.changedSymbols.length / 40 +
      highGapCount / 5 +
      analysis.drilldown.unsupportedChangedFiles.length / 10,
  );
  return {
    level: score === 0 ? "unknown" : score >= 0.65 ? "high" : score >= 0.3 ? "medium" : "low",
    score,
  };
}
