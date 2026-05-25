import type {
  GraphExplorationStatus,
  GraphNextToolSuggestion,
  GraphNode,
  GraphPriority,
  GraphQueryPattern,
  GraphSearchResultItem,
  GraphWorkflow,
} from "./types.js";

type SuggestionInput = {
  status: GraphExplorationStatus;
  workflow?: GraphWorkflow;
  changedFiles?: string[];
  priorities?: GraphPriority[];
  nodes?: GraphNode[];
  files?: string[];
  searchResults?: GraphSearchResultItem[];
  query?: string;
  pattern?: GraphQueryPattern;
  target?: string;
  maxSuggestions?: number;
};

const DEFAULT_EVIDENCE = "Use graph output only as investigation context; confirm findings with source, diff, tests, or runtime evidence.";

export function buildNextToolSuggestions(input: SuggestionInput): GraphNextToolSuggestion[] {
  const maxSuggestions = input.maxSuggestions ?? 4;
  const suggestions: GraphNextToolSuggestion[] = [];

  if (input.status === "missing") {
    suggestions.push({
      command: "ocr graph build --full",
      reason: "The graph database is missing, so graph-guided navigation cannot answer dependency or test questions yet.",
      expectedValue: "Create the graph database before comparing graph-guided review against a baseline.",
      evidenceRequirement: DEFAULT_EVIDENCE,
      priority: "high",
    });
    return dedupeSuggestions(suggestions).slice(0, maxSuggestions);
  }

  if (input.status === "stale" || input.status === "degraded") {
    suggestions.push({
      command: "ocr graph update --working-tree",
      reason: `Graph status is ${input.status}; refresh before relying on detailed traversal.`,
      expectedValue: "Reduce stale or partial graph signals before deeper review investigation.",
      evidenceRequirement: DEFAULT_EVIDENCE,
      priority: "high",
    });
  }

  const topPriority = input.priorities?.[0];
  if (topPriority) {
    const changedFiles = input.changedFiles?.length ? input.changedFiles : [topPriority.filePath];
    suggestions.push({
      command: `ocr graph review-context --workflow ${input.workflow ?? "review"} --files ${changedFiles.map(quoteShellArg).join(",")} --max-snippets 8 --max-lines-per-snippet 40`,
      reason: "Fetch bounded source snippets for the highest-priority graph targets before reading whole files.",
      expectedValue: "Give reviewers enough source context to verify the next hypothesis without a broad file scan.",
      evidenceRequirement: DEFAULT_EVIDENCE,
      priority: "high",
    });
    suggestions.push(patternSuggestion("tests_for", topPriority.qualifiedName, "high", "Check graph-linked tests for the highest-priority changed or impacted symbol."));
    suggestions.push(patternSuggestion("callers_of", topPriority.qualifiedName, "medium", "Bound the upstream call sites before broad source reads."));
    suggestions.push(patternSuggestion("callees_of", topPriority.qualifiedName, "medium", "Inspect the immediate downstream dependencies most likely to be affected."));
  }

  const firstNode = input.nodes?.find((node) => node.kind !== "File");
  if (!topPriority && firstNode) {
    suggestions.push(patternSuggestion("tests_for", firstNode.qualifiedName, "medium", "Check whether this graph result has linked tests before reading unrelated files."));
    suggestions.push(patternSuggestion("callers_of", firstNode.qualifiedName, "medium", "Use graph callers to narrow the next investigation step."));
  }

  const changedFiles = input.changedFiles ?? [];
  if (changedFiles.length > 0) {
    suggestions.push({
      command: `ocr graph impact --files ${changedFiles.map(quoteShellArg).join(",")} --depth 2`,
      reason: "Compute a bounded impact radius for the changed files before doing broad search.",
      expectedValue: "Prioritize files and symbols that are actually graph-connected to the change.",
      evidenceRequirement: DEFAULT_EVIDENCE,
      priority: topPriority ? "low" : "medium",
    });
  }

  const firstFile = input.files?.[0] ?? input.searchResults?.[0]?.filePath;
  if (firstFile) {
    suggestions.push({
      command: `ocr graph query file_summary --target ${quoteShellArg(firstFile)} --limit 40`,
      reason: "Summarize the graph entities in the most relevant file before opening the whole file.",
      expectedValue: "Identify the specific functions, types, or tests worth source-verifying.",
      evidenceRequirement: DEFAULT_EVIDENCE,
      priority: "low",
    });
  }

  if (input.query && input.searchResults && input.searchResults.length > 0) {
    const target = input.searchResults[0]?.qualifiedName;
    if (target) {
      suggestions.push(patternSuggestion("tests_for", target, "medium", `Follow up the top search hit for "${input.query}" with linked test coverage.`));
    }
  }

  return dedupeSuggestions(suggestions).slice(0, maxSuggestions);
}

function patternSuggestion(
  pattern: GraphQueryPattern,
  target: string,
  priority: GraphNextToolSuggestion["priority"],
  reason: string,
): GraphNextToolSuggestion {
  return {
    command: `ocr graph query ${pattern} --target ${quoteShellArg(target)} --limit 40`,
    reason,
    expectedValue: "Answer a bounded dependency or coverage question before reading broader source context.",
    evidenceRequirement: DEFAULT_EVIDENCE,
    priority,
  };
}

function dedupeSuggestions(suggestions: GraphNextToolSuggestion[]): GraphNextToolSuggestion[] {
  const seen = new Set<string>();
  const priorityOrder = { high: 0, medium: 1, low: 2 } satisfies Record<GraphNextToolSuggestion["priority"], number>;
  return suggestions
    .filter((suggestion) => {
      const key = suggestion.command;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.command.localeCompare(b.command));
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@#=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
