import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateGraphReviewAnalysis } from "../analysis/review-analysis.js";
import { buildNextToolSuggestions } from "../suggestions.js";
import type {
  GenerateGraphReviewContextOptions,
  GraphNode,
  GraphReviewContext,
  GraphReviewContextOmittedFile,
  GraphReviewContextSnippet,
  GraphReviewContextSnippetKind,
} from "../types.js";

type SnippetCandidate = {
  node: GraphNode;
  kind: GraphReviewContextSnippetKind;
  reason: string;
};

export async function generateGraphReviewContext(
  options: GenerateGraphReviewContextOptions,
): Promise<GraphReviewContext> {
  const maxFiles = options.maxFiles ?? 6;
  const maxSnippets = options.maxSnippets ?? 12;
  const maxLinesPerSnippet = options.maxLinesPerSnippet ?? 40;
  const maxChars = options.maxChars ?? 16_000;
  const maxSuggestions = options.maxSuggestions ?? 4;
  const analysis = await generateGraphReviewAnalysis({
    ...options,
    maxFiles: Math.max(maxFiles, options.maxFiles ?? maxFiles),
    maxNodes: options.maxNodes ?? 80,
    maxHints: Math.min(options.maxHints ?? 4, 4),
    maxModules: 0,
    writeArtifacts: false,
  });

  const omittedFiles: GraphReviewContextOmittedFile[] = analysis.drilldown.unsupportedChangedFiles.map((filePath) => ({
    filePath,
    reason: "File type is not supported by the graph parser; review it manually from source.",
  }));

  if (analysis.status === "missing") {
    return {
      version: 1,
      workflow: options.workflow,
      status: analysis.status,
      summary: "Graph review context unavailable because the graph database is missing.",
      snippets: [],
      omittedFiles,
      warnings: analysis.warnings,
      nextToolSuggestions: buildNextToolSuggestions({
        status: analysis.status,
        workflow: options.workflow,
        changedFiles: options.changedFiles,
        maxSuggestions,
      }),
      budget: {
        maxFiles,
        maxSnippets,
        maxLinesPerSnippet,
        maxChars,
        truncated: false,
      },
      generatedAt: analysis.generatedAt,
      sourceScope: analysis.sourceScope,
    };
  }

  const candidates = buildSnippetCandidates(analysis.changedSymbols, analysis.drilldown.impactedNodes);
  const snippets = materializeSnippets(options.repoRoot, candidates, {
    maxFiles,
    maxSnippets,
    maxLinesPerSnippet,
    maxChars,
    omittedFiles,
  });
  const truncated = snippets.truncated || analysis.truncated;
  const warnings = [...new Set([
    ...analysis.warnings,
    ...snippets.warnings,
    ...(truncated ? ["Graph review context truncated by snippet budget."] : []),
  ])];

  return {
    version: 1,
    workflow: options.workflow,
    status: analysis.status,
    summary: `Graph review context: ${snippets.items.length} snippet(s), ${omittedFiles.length} omitted file(s).`,
    snippets: snippets.items,
    omittedFiles,
    warnings,
    nextToolSuggestions: buildNextToolSuggestions({
      status: analysis.status,
      workflow: options.workflow,
      changedFiles: options.changedFiles,
      priorities: analysis.priorities,
      nodes: analysis.changedSymbols,
      files: snippets.items.map((snippet) => snippet.filePath),
      maxSuggestions,
    }),
    budget: {
      maxFiles,
      maxSnippets,
      maxLinesPerSnippet,
      maxChars,
      truncated,
    },
    generatedAt: analysis.generatedAt,
    sourceScope: analysis.sourceScope,
  };
}

function buildSnippetCandidates(
  changedSymbols: GraphNode[],
  impactedNodes: GraphNode[],
): SnippetCandidate[] {
  const candidates: SnippetCandidate[] = [];
  const changedSet = new Set(changedSymbols.map((node) => node.qualifiedName));
  for (const node of changedSymbols.filter((node) => node.kind !== "File")) {
    candidates.push({
      node,
      kind: "changed_symbol",
      reason: "Changed symbol selected for direct source verification.",
    });
  }
  for (const node of impactedNodes.filter((node) => node.kind !== "File" && !changedSet.has(node.qualifiedName))) {
    candidates.push({
      node,
      kind: "impacted_symbol",
      reason: "Top impacted symbol selected from graph impact radius.",
    });
  }
  return candidates;
}

function materializeSnippets(
  repoRoot: string,
  candidates: SnippetCandidate[],
  budget: {
    maxFiles: number;
    maxSnippets: number;
    maxLinesPerSnippet: number;
    maxChars: number;
    omittedFiles: GraphReviewContextOmittedFile[];
  },
): { items: GraphReviewContextSnippet[]; warnings: string[]; truncated: boolean } {
  const warnings: string[] = [];
  const rawSnippets: GraphReviewContextSnippet[] = [];
  const seenFiles = new Set<string>();
  let totalChars = 0;
  let truncated = false;

  for (const candidate of candidates) {
    if (rawSnippets.length >= budget.maxSnippets) {
      truncated = true;
      break;
    }
    if (!seenFiles.has(candidate.node.filePath) && seenFiles.size >= budget.maxFiles) {
      truncated = true;
      pushOmitted(budget.omittedFiles, candidate.node.filePath, "Skipped because review-context maxFiles budget was reached.");
      continue;
    }
    const sourcePath = join(repoRoot, candidate.node.filePath);
    if (!existsSync(sourcePath)) {
      pushOmitted(budget.omittedFiles, candidate.node.filePath, "Source file does not exist on disk.");
      continue;
    }
    const source = safeRead(sourcePath);
    if (source === null) {
      pushOmitted(budget.omittedFiles, candidate.node.filePath, "Source file could not be read.");
      continue;
    }
    const snippet = snippetFromSource(source, candidate, budget.maxLinesPerSnippet);
    if (totalChars + snippet.text.length > budget.maxChars) {
      truncated = true;
      warnings.push(`Skipped ${candidate.node.qualifiedName} because review-context maxChars budget was reached.`);
      continue;
    }
    seenFiles.add(candidate.node.filePath);
    totalChars += snippet.text.length;
    rawSnippets.push(snippet);
  }

  return {
    items: mergeAdjacentSnippets(rawSnippets).slice(0, budget.maxSnippets),
    warnings,
    truncated,
  };
}

function snippetFromSource(
  source: string,
  candidate: SnippetCandidate,
  maxLinesPerSnippet: number,
): GraphReviewContextSnippet {
  const lines = source.split(/\r?\n/);
  const rawStart = Math.max(1, candidate.node.lineStart);
  const rawEnd = Math.max(rawStart, candidate.node.lineEnd);
  const maxEnd = Math.min(lines.length, rawStart + maxLinesPerSnippet - 1);
  const lineEnd = Math.min(rawEnd, maxEnd);
  const text = lines.slice(rawStart - 1, lineEnd).join("\n");
  return {
    filePath: candidate.node.filePath,
    lineStart: rawStart,
    lineEnd,
    qualifiedNames: [candidate.node.qualifiedName],
    kind: candidate.kind,
    reason: candidate.reason,
    text,
    truncated: rawEnd > lineEnd,
  };
}

function mergeAdjacentSnippets(snippets: GraphReviewContextSnippet[]): GraphReviewContextSnippet[] {
  const sorted = [...snippets].sort((a, b) =>
    a.filePath.localeCompare(b.filePath) ||
    a.lineStart - b.lineStart ||
    a.lineEnd - b.lineEnd,
  );
  const merged: GraphReviewContextSnippet[] = [];
  for (const snippet of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.filePath === snippet.filePath &&
      last.kind === snippet.kind &&
      snippet.lineStart <= last.lineEnd + 1
    ) {
      last.lineEnd = Math.max(last.lineEnd, snippet.lineEnd);
      last.qualifiedNames = [...new Set([...last.qualifiedNames, ...snippet.qualifiedNames])];
      last.reason = [...new Set([last.reason, snippet.reason])].join(" ");
      last.text = [last.text, snippet.text].filter(Boolean).join("\n");
      last.truncated = last.truncated || snippet.truncated;
      continue;
    }
    merged.push({ ...snippet, qualifiedNames: [...snippet.qualifiedNames] });
  }
  return merged;
}

function pushOmitted(omittedFiles: GraphReviewContextOmittedFile[], filePath: string, reason: string): void {
  if (omittedFiles.some((entry) => entry.filePath === filePath && entry.reason === reason)) return;
  omittedFiles.push({ filePath, reason });
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
