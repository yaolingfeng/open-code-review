import { execFileSync } from "node:child_process";
import { detectLanguage } from "../language.js";
import { GraphStore } from "../storage/db.js";
import type {
  GraphChangedRange,
  GraphChangedSymbolPrecision,
  GraphChangedSymbolReason,
  GraphContextWarning,
  GraphNode,
} from "../types.js";
import { toPosixPath } from "../utils.js";

type ChangedRangeResult = {
  ranges: GraphChangedRange[];
  warnings: GraphContextWarning[];
};

type ChangedSymbolAnalysis = {
  changedRanges: GraphChangedRange[];
  changedNodes: GraphNode[];
  changedSymbolPrecision: GraphChangedSymbolPrecision;
  changedSymbolReason?: GraphChangedSymbolReason;
  warnings: GraphContextWarning[];
};

export function analyzeChangedSymbols(
  store: GraphStore,
  repoRoot: string,
  options: { base?: string; changedFiles: string[] },
): ChangedSymbolAnalysis {
  const supportedChangedFiles = options.changedFiles
    .map(toPosixPath)
    .filter((file) => detectLanguage(file) !== null);
  const rangeResult = getChangedRanges(repoRoot, {
    base: options.base,
    changedFiles: options.changedFiles,
  });
  const warnings = [...rangeResult.warnings];

  if (supportedChangedFiles.length === 0) {
    return {
      changedRanges: rangeResult.ranges,
      changedNodes: [],
      changedSymbolPrecision: "none",
      changedSymbolReason: "unsupported_only",
      warnings,
    };
  }

  if (rangeResult.ranges.length === 0) {
    return {
      changedRanges: [],
      changedNodes: nodesByChangedFiles(store, options.changedFiles),
      changedSymbolPrecision: "file",
      changedSymbolReason: "range_unavailable",
      warnings: appendWarning(warnings, {
        code: "git_diff_ranges_unavailable",
        severity: "warning",
        scope: "changed_symbols",
        message: "Changed line ranges unavailable; graph context fell back to file-level changed nodes.",
      }),
    };
  }

  const changedNodes = nodesByChangedRanges(store, rangeResult.ranges, options.changedFiles);
  if (changedNodes.length === 0) {
    const fallbackNodes = nodesByChangedFiles(store, options.changedFiles);
    const precision = fallbackNodes.length > 0 ? "file" : "none";
    return {
      changedRanges: rangeResult.ranges,
      changedNodes: fallbackNodes,
      changedSymbolPrecision: precision,
      changedSymbolReason: precision === "file" ? "range_no_symbol_overlap" : undefined,
      warnings: appendWarning(warnings, {
        code: "changed_ranges_no_symbol_overlap",
        severity: "warning",
        scope: "changed_symbols",
        message: "Changed line ranges did not overlap graph symbols; graph context fell back to file-level changed nodes.",
      }),
    };
  }

  return {
    changedRanges: rangeResult.ranges,
    changedNodes,
    changedSymbolPrecision: "symbol",
    changedSymbolReason: "exact_overlap",
    warnings,
  };
}

export function getChangedRanges(
  repoRoot: string,
  options: { base?: string; changedFiles?: string[] } = {},
): ChangedRangeResult {
  const base = options.base ?? "HEAD~1";
  if (base.startsWith("-")) {
    return {
      ranges: [],
      warnings: [
        {
          code: "git_diff_base_invalid",
          severity: "warning",
          scope: "changed_symbols",
          message: `Invalid git base ref for changed range detection: ${base}`,
        },
      ],
    };
  }

  const changedFiles = (options.changedFiles ?? []).map(toPosixPath);
  try {
    const diff = execFileSync("git", ["diff", "--unified=0", base, "--", ...changedFiles], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return {
      ranges: parseUnifiedDiffRanges(diff, changedFiles),
      warnings: [],
    };
  } catch {
    return {
      ranges: [],
      warnings: [
        {
          code: "git_diff_ranges_unavailable",
          severity: "warning",
          scope: "changed_symbols",
          message: "Unable to read git diff ranges for changed symbol mapping.",
        },
      ],
    };
  }
}

export function parseUnifiedDiffRanges(diff: string, changedFiles: string[] = []): GraphChangedRange[] {
  const allowed = new Set(changedFiles.map(toPosixPath));
  const ranges: GraphChangedRange[] = [];
  let currentFile: string | null = null;

  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch?.[1]) {
      currentFile = toPosixPath(fileMatch[1]);
      if (allowed.size > 0 && !allowed.has(currentFile)) currentFile = null;
      continue;
    }
    if (line === "+++ /dev/null") {
      currentFile = null;
      continue;
    }

    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch || !currentFile) continue;
    const lineStart = Number.parseInt(hunkMatch[1] ?? "0", 10);
    const count = Number.parseInt(hunkMatch[2] ?? "1", 10);
    const lineEnd = count === 0 ? lineStart : lineStart + count - 1;
    ranges.push({ filePath: currentFile, lineStart, lineEnd });
  }

  return mergeRanges(ranges);
}

function appendWarning(
  warnings: GraphContextWarning[],
  warning: GraphContextWarning,
): GraphContextWarning[] {
  if (warnings.some((existing) => existing.code === warning.code && existing.message === warning.message)) {
    return warnings;
  }
  return [...warnings, warning];
}

function nodesByChangedRanges(
  store: GraphStore,
  ranges: GraphChangedRange[],
  changedFiles: string[],
): GraphNode[] {
  const byFile = new Map<string, GraphChangedRange[]>();
  for (const range of ranges) {
    const bucket = byFile.get(range.filePath) ?? [];
    bucket.push(range);
    byFile.set(range.filePath, bucket);
  }

  const selected: GraphNode[] = [];
  for (const file of changedFiles.map(toPosixPath).filter((path) => detectLanguage(path) !== null)) {
    const fileRanges = byFile.get(file);
    if (!fileRanges || fileRanges.length === 0) continue;
    const nodes = store.nodesByFile(file);
    const symbols = nodes
      .filter((node) => node.kind !== "File")
      .filter((node) => fileRanges.some((range) => overlaps(node, range)));
    if (symbols.length > 0) {
      selected.push(...symbols);
      continue;
    }

    const fileNode = nodes.find((node) => node.kind === "File");
    if (fileNode) selected.push(fileNode);
  }
  return uniqueNodes(selected);
}

function nodesByChangedFiles(store: GraphStore, changedFiles: string[]): GraphNode[] {
  return uniqueNodes(
    changedFiles
      .map(toPosixPath)
      .filter((file) => detectLanguage(file) !== null)
      .flatMap((file) => store.nodesByFile(file)),
  );
}

function overlaps(node: GraphNode, range: GraphChangedRange): boolean {
  return node.filePath === range.filePath && node.lineStart <= range.lineEnd && node.lineEnd >= range.lineStart;
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  const result: GraphNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.qualifiedName)) continue;
    seen.add(node.qualifiedName);
    result.push(node);
  }
  return result;
}

function mergeRanges(ranges: GraphChangedRange[]): GraphChangedRange[] {
  const sorted = [...ranges].sort((a, b) =>
    a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd,
  );
  const merged: GraphChangedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.filePath === range.filePath && range.lineStart <= previous.lineEnd + 1) {
      previous.lineEnd = Math.max(previous.lineEnd, range.lineEnd);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}
