import type { GraphEdge, GraphFlow, GraphNode } from "../types.js";
import { GraphStore } from "../storage/db.js";

type StoredFlow = GraphFlow & {
  nodeQualifiedNames: string[];
};

type NodeLookup = {
  byQualified: Map<string, GraphNode>;
  byName: Map<string, GraphNode>;
  byFile: Map<string, GraphNode>;
};

const FLOW_EDGE_KINDS = new Set(["CALLS", "DEPENDS_ON", "IMPORTS_FROM", "REFERENCES"]);
const MAX_FLOW_DEPTH = 5;
const MAX_FLOW_NODES = 40;
const ENTRY_FILE_PATTERN = /(?:^|\/)(api|apis|route|routes|router|routers|controller|controllers|handler|handlers|cmd|commands|job|jobs|worker|workers|resolver|resolvers|pages\/api)(?:\/|$)/i;
const ENTRY_NAME_PATTERN = /(?:handler|route|router|controller|resolver|execute|run|main|job|worker|command|action)$/i;

export function rebuildFlows(store: GraphStore): void {
  const nodes = store.allNodes();
  const nodeLookup = buildNodeLookup(nodes);
  const edgesBySource = groupEdges(store.allEdges().filter((edge) => FLOW_EDGE_KINDS.has(edge.kind)));
  const flows = buildFlowsForEntries(nodes.filter(isFlowEntry), nodeLookup, edgesBySource).slice(0, 200);

  store.replaceFlows(flows);
}

export function rebuildFlowsForFiles(store: GraphStore, changedFiles: string[]): number {
  const changedFileSet = new Set(changedFiles);
  if (changedFileSet.size === 0) return 0;
  const nodes = store.allNodes();
  const nodeLookup = buildNodeLookup(nodes);
  const flowEdges = store.allEdges().filter((edge) => FLOW_EDGE_KINDS.has(edge.kind));
  const edgesBySource = groupEdges(flowEdges);
  const touchedQualified = new Set(
    nodes
      .filter((node) => changedFileSet.has(node.filePath))
      .map((node) => node.qualifiedName),
  );
  const entries = nodes.filter((node) =>
    isFlowEntry(node) &&
    (changedFileSet.has(node.filePath) ||
      flowEdges.some((edge) =>
        edge.sourceQualified === node.qualifiedName &&
        (changedFileSet.has(edge.filePath) || touchedQualified.has(edge.targetQualified)),
      )),
  );
  const flows = buildFlowsForEntries(entries, nodeLookup, edgesBySource);
  store.replaceFlowsForFiles(changedFiles, flows);
  return flows.length;
}

function buildFlow(
  entry: GraphNode,
  nodeLookup: NodeLookup,
  edgesBySource: Map<string, GraphEdge[]>,
): StoredFlow | null {
  const visited = new Set<string>();
  const ordered: GraphNode[] = [];
  const queue: { node: GraphNode; depth: number }[] = [{ node: entry, depth: 0 }];

  while (queue.length > 0 && ordered.length < MAX_FLOW_NODES) {
    const current = queue.shift();
    if (!current || visited.has(current.node.qualifiedName)) continue;
    visited.add(current.node.qualifiedName);
    ordered.push(current.node);
    if (current.depth >= MAX_FLOW_DEPTH) continue;

    for (const edge of edgesBySource.get(current.node.qualifiedName) ?? []) {
      const next = resolveEdgeTarget(edge, nodeLookup);
      if (next && !visited.has(next.qualifiedName)) {
        queue.push({ node: next, depth: current.depth + 1 });
      }
    }
  }

  const files = [...new Set(ordered.map((node) => node.filePath))].sort();
  if (ordered.length < 2 && !isHighSignalEntry(entry)) return null;

  return {
    name: flowName(entry),
    entryQualified: entry.qualifiedName,
    files,
    criticality: scoreFlow(entry, ordered, files),
    nodeQualifiedNames: ordered.map((node) => node.qualifiedName),
  };
}

function buildFlowsForEntries(
  entries: GraphNode[],
  nodeLookup: NodeLookup,
  edgesBySource: Map<string, GraphEdge[]>,
): StoredFlow[] {
  return entries
    .map((entry) => buildFlow(entry, nodeLookup, edgesBySource))
    .filter((flow): flow is StoredFlow => flow !== null)
    .sort((a, b) => b.criticality - a.criticality || a.name.localeCompare(b.name));
}

function groupEdges(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const grouped = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const bucket = grouped.get(edge.sourceQualified) ?? [];
    bucket.push(edge);
    grouped.set(edge.sourceQualified, bucket);
  }
  return grouped;
}

function buildNodeLookup(nodes: GraphNode[]): NodeLookup {
  const byQualified = new Map<string, GraphNode>();
  const byName = new Map<string, GraphNode>();
  const byFile = new Map<string, GraphNode>();
  for (const node of nodes) {
    byQualified.set(node.qualifiedName, node);
    if (!byName.has(node.name)) byName.set(node.name, node);
    if (!byFile.has(node.filePath)) byFile.set(node.filePath, node);
  }
  return { byQualified, byName, byFile };
}

function resolveEdgeTarget(edge: GraphEdge, nodeLookup: NodeLookup): GraphNode | null {
  return nodeLookup.byQualified.get(edge.targetQualified) ??
    nodeLookup.byName.get(edge.targetQualified) ??
    nodeLookup.byFile.get(edge.targetQualified) ??
    null;
}

function isFlowEntry(node: GraphNode): boolean {
  if (node.kind !== "Function" && node.kind !== "File") return false;
  if (node.isTest) return false;
  return isHighSignalEntry(node);
}

function isHighSignalEntry(node: GraphNode): boolean {
  if (ENTRY_FILE_PATTERN.test(node.filePath)) return true;
  if (ENTRY_NAME_PATTERN.test(node.name)) return true;
  if (node.name === "main" || node.name === "Main") return true;
  return false;
}

function scoreFlow(entry: GraphNode, nodes: GraphNode[], files: string[]): number {
  let score = 0.2;
  if (ENTRY_FILE_PATTERN.test(entry.filePath)) score += 0.35;
  if (ENTRY_NAME_PATTERN.test(entry.name) || entry.name === "main" || entry.name === "Main") score += 0.2;
  score += Math.min(files.length / 10, 0.25);
  score += Math.min(nodes.length / 50, 0.2);
  return Math.min(1, Number(score.toFixed(3)));
}

function flowName(entry: GraphNode): string {
  return `${entry.name} (${entry.filePath})`;
}
