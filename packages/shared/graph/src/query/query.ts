import { existsSync } from "node:fs";
import { GraphStore } from "../storage/db.js";
import { buildNextToolSuggestions } from "../suggestions.js";
import type {
  GraphEdge,
  GraphExplorationStatus,
  GraphNode,
  GraphOptions,
  GraphQuery,
  GraphQueryPattern,
  GraphQueryResult,
  GraphSearchOptions,
  GraphSearchResult,
  GraphStatusValue,
} from "../types.js";
import { graphDbPath } from "../utils.js";

export async function queryGraph(options: GraphOptions & { query: GraphQuery }): Promise<GraphQueryResult> {
  if (!existsSync(graphDbPath(options.repoRoot, options.ocrDir))) {
    return {
      status: "missing",
      summary: "Graph database does not exist. Run `ocr graph build --full` first.",
      warnings: ["Graph database missing."],
      truncated: false,
      nextToolSuggestions: buildNextToolSuggestions({ status: "missing" }),
    };
  }
  if (options.query.kind === "impact") {
    return getImpactRadius({
      ...options,
      changedFiles: options.query.changedFiles,
      maxDepth: options.query.maxDepth,
      maxNodes: options.query.maxNodes,
    });
  }
  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    const graphStatus = toExplorationStatus(store.status().status);
    return patternQuery(store, options.query.pattern, options.query.target, options.query.limit ?? 100, graphStatus.status, graphStatus.warnings);
  } finally {
    store.close();
  }
}

export async function searchGraph(options: GraphSearchOptions): Promise<GraphSearchResult> {
  if (!existsSync(graphDbPath(options.repoRoot, options.ocrDir))) {
    return {
      status: "missing",
      query: options.query,
      summary: "Graph database does not exist. Run `ocr graph build --full` first.",
      limit: options.limit ?? 20,
      results: [],
      warnings: ["Graph database missing."],
      truncated: false,
      nextToolSuggestions: buildNextToolSuggestions({ status: "missing", query: options.query }),
    };
  }
  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    const graphStatus = toExplorationStatus(store.status().status);
    const result = store.search(options.query, options.limit ?? 20, graphStatus.status, graphStatus.warnings);
    return {
      ...result,
      nextToolSuggestions: buildNextToolSuggestions({
        status: result.status,
        query: result.query,
        searchResults: result.results,
      }),
    };
  } finally {
    store.close();
  }
}

export async function getImpactRadius(
  options: GraphOptions & { changedFiles: string[]; maxDepth?: number; maxNodes?: number },
): Promise<GraphQueryResult> {
  if (!existsSync(graphDbPath(options.repoRoot, options.ocrDir))) {
    return {
      status: "missing",
      summary: "Graph database does not exist. Run `ocr graph build --full` first.",
      warnings: ["Graph database missing."],
      truncated: false,
      nextToolSuggestions: buildNextToolSuggestions({ status: "missing", changedFiles: options.changedFiles }),
    };
  }
  const store = await GraphStore.open(options.repoRoot, options.ocrDir);
  try {
    const graphStatus = toExplorationStatus(store.status().status);
    const maxDepth = options.maxDepth ?? 2;
    const maxNodes = options.maxNodes ?? 500;
    const changedNodes = options.changedFiles.flatMap((file) => store.nodesByFile(file));
    return getImpactRadiusForNodes(store, changedNodes, maxDepth, maxNodes, graphStatus.status, graphStatus.warnings);
  } finally {
    store.close();
  }
}

export function getImpactRadiusForNodes(
  store: GraphStore,
  changedNodes: GraphNode[],
  maxDepth = 2,
  maxNodes = 500,
  status: GraphExplorationStatus = "ready",
  warnings: string[] = [],
): GraphQueryResult {
  if (changedNodes.length === 0) {
    return {
      status,
      summary: "No graph nodes matched the changed files.",
      nodes: [],
      edges: [],
      files: [],
      warnings,
      truncated: false,
      nextToolSuggestions: buildNextToolSuggestions({ status }),
    };
  }

  const seen = new Set<string>();
  let frontier = changedNodes;
  const impacted: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let truncated = false;
  const traversalKinds = ["CALLS", "IMPORTS_FROM", "DEPENDS_ON", "REFERENCES", "TESTED_BY"];

  for (let depth = 0; frontier.length > 0; depth++) {
    const currentLevel: GraphNode[] = [];
    for (const node of frontier) {
      if (seen.has(node.qualifiedName)) continue;
      seen.add(node.qualifiedName);
      impacted.push(node);
      currentLevel.push(node);
      if (impacted.length >= maxNodes) {
        truncated = true;
        break;
      }
    }
    if (truncated || depth >= maxDepth || currentLevel.length === 0) break;

    const edgeBatch = store.edgesForFrontier(currentLevel.map((node) => node.qualifiedName), traversalKinds);
    edges.push(...edgeBatch);
    const nextQualifiedNames = edgeBatch.flatMap((edge) => [edge.sourceQualified, edge.targetQualified]);
    const nodeMap = store.findNodes(nextQualifiedNames);
    const nextFrontier: GraphNode[] = [];
    for (const edge of edgeBatch) {
      const candidates = [edge.sourceQualified, edge.targetQualified];
      for (const qualified of candidates) {
        const next = nodeMap.get(qualified);
        if (next && !seen.has(next.qualifiedName)) nextFrontier.push(next);
      }
    }
    frontier = nextFrontier;
  }

  const files = [...new Set(impacted.map((node) => node.filePath))].sort();
  return {
    status,
    summary: `Impact radius: ${changedNodes.length} changed node(s), ${impacted.length} impacted node(s), ${files.length} file(s).`,
    nodes: impacted,
    edges,
    files,
    warnings,
    truncated,
    nextToolSuggestions: buildNextToolSuggestions({ status, nodes: impacted, files }),
  };
}

function patternQuery(
  store: GraphStore,
  pattern: GraphQueryPattern,
  target: string,
  limit: number,
  status: GraphExplorationStatus,
  warnings: string[],
): GraphQueryResult {
  const node = store.findNode(target);
  const qualified = node?.qualifiedName ?? target;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  switch (pattern) {
    case "callers_of":
      edges = store.edgesByTarget(qualified, "CALLS");
      nodes = edges.map((edge) => store.findNode(edge.sourceQualified)).filter(isNode);
      break;
    case "callees_of":
      edges = store.edgesBySource(qualified, "CALLS");
      nodes = edges.map((edge) => store.findNode(edge.targetQualified)).filter(isNode);
      break;
    case "imports_of":
      edges = store.edgesBySource(qualified, "IMPORTS_FROM");
      if (edges.length === 0) edges = store.edgesBySource(target, "IMPORTS_FROM");
      break;
    case "importers_of":
      edges = store.edgesByTarget(target, "IMPORTS_FROM");
      nodes = edges.map((edge) => store.findNode(edge.sourceQualified)).filter(isNode);
      break;
    case "tests_for":
      edges = store.edgesByTarget(qualified, "TESTED_BY");
      nodes = edges.map((edge) => store.findNode(edge.sourceQualified)).filter(isNode);
      break;
    case "children_of":
      edges = store.edgesBySource(qualified, "CONTAINS");
      nodes = edges.map((edge) => store.findNode(edge.targetQualified)).filter(isNode);
      break;
    case "file_summary":
      nodes = store.nodesByFile(target);
      edges = store.edgesByFile(target);
      break;
  }

  const limitedNodes = nodes.slice(0, limit);
  const limitedEdges = edges.slice(0, limit);
  return {
    status,
    summary: `Found ${nodes.length || edges.length} result(s) for ${pattern}('${target}').`,
    nodes: limitedNodes.length > 0 ? limitedNodes : undefined,
    edges: limitedEdges.length > 0 ? limitedEdges : undefined,
    warnings,
    truncated: nodes.length > limit || edges.length > limit,
    nextToolSuggestions: buildNextToolSuggestions({
      status,
      pattern,
      target,
      nodes: limitedNodes,
      files: [...new Set(limitedNodes.map((node) => node.filePath))].sort(),
    }),
  };
}

export function toExplorationStatus(status: GraphStatusValue): { status: GraphExplorationStatus; warnings: string[] } {
  if (status === "building") {
    return {
      status: "degraded",
      warnings: ["Graph build is in progress; some graph results may be incomplete."],
    };
  }
  return { status, warnings: [] };
}

function isNode(value: GraphNode | null): value is GraphNode {
  return value !== null;
}
