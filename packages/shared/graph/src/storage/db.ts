import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import {
  GRAPH_PARSER_VERSION,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphEdgeInput,
  type GraphExplorationStatus,
  type GraphFileRecord,
  type GraphFlow,
  type GraphModuleBridgeSummary,
  type GraphNode,
  type GraphNodeInput,
  type GraphSearchIndexRow,
  type GraphSearchMatchType,
  type GraphSearchResult,
  type GraphSearchResultItem,
  type GraphStatus,
  type SupportedLanguage,
} from "../types.js";
import { graphDbPath, normalizeSignatureTokens, parseJsonObject, stableJson, tokenizeForSearch } from "../utils.js";

const require = createRequire(import.meta.url);
const BetterSqlite3Database = require("better-sqlite3") as typeof BetterSqlite3;

type Database = BetterSqlite3.Database;
type BindValue = string | number | null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS graph_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  parser_version TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  language TEXT NOT NULL,
  parent_name TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source_qualified TEXT NOT NULL,
  target_qualified TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 1.0,
  confidence_tier TEXT NOT NULL DEFAULT 'EXTRACTED',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(kind, source_qualified, target_qualified, file_path, line)
);

CREATE TABLE IF NOT EXISTS graph_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  entry_qualified TEXT NOT NULL,
  criticality REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS graph_flow_nodes (
  flow_id INTEGER NOT NULL,
  node_qualified TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  PRIMARY KEY(flow_id, node_qualified, step_index)
);

CREATE TABLE IF NOT EXISTS graph_search_index (
  entity_type TEXT NOT NULL,
  qualified_name TEXT NOT NULL PRIMARY KEY,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT NOT NULL,
  signature_tokens TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind ON graph_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_language ON graph_nodes(language);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_qualified);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_qualified);
CREATE INDEX IF NOT EXISTS idx_graph_edges_kind ON graph_edges(kind);
CREATE INDEX IF NOT EXISTS idx_graph_edges_file ON graph_edges(file_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_kind_line ON graph_edges(source_qualified, kind, line);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_kind_line ON graph_edges(target_qualified, kind, line);
CREATE INDEX IF NOT EXISTS idx_graph_edges_file_kind ON graph_edges(file_path, kind);
CREATE INDEX IF NOT EXISTS idx_graph_flow_nodes_node ON graph_flow_nodes(node_qualified);
CREATE INDEX IF NOT EXISTS idx_graph_search_file ON graph_search_index(file_path);
`;

type Row = Record<string, string | number | null>;

async function openDatabase(dbPath: string): Promise<Database> {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new BetterSqlite3Database(dbPath, { timeout: 5000 });

  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

function run(db: Database, sql: string, params: BindValue[] = []): void {
  db.prepare(sql).run(...params);
}

function saveDatabase(db: Database): void {
  db.pragma("wal_checkpoint(PASSIVE)");
}

function rows(db: Database, sql: string, params: BindValue[] = []): Row[] {
  return db.prepare<BindValue[], Row>(sql).all(...params);
}

function scalar(db: Database, sql: string, params: BindValue[] = []): string | number | null {
  const row = db.prepare<BindValue[], Row>(sql).raw().get(...params);
  return (row?.[0] as string | number | null | undefined) ?? null;
}

function supportsFts5(db: Database): boolean {
  try {
    db.prepare("SELECT rowid FROM graph_search_fts WHERE graph_search_fts MATCH ? LIMIT 1").all("__ocr_no_match__");
    return true;
  } catch {
    return false;
  }
}

export class GraphStore {
  private constructor(
    private readonly db: Database,
    readonly dbPath: string,
  ) {}

  static async open(repoRoot: string, ocrDir?: string): Promise<GraphStore> {
    const dbPath = graphDbPath(repoRoot, ocrDir);
    const db = await openDatabase(dbPath);
    db.exec(SCHEMA_SQL);
    ensureFtsSchema(db);
    const existing = scalar(db, "SELECT value FROM graph_metadata WHERE key = 'schema_version'");
    if (existing === null) {
      run(db, "INSERT INTO graph_metadata (key, value) VALUES ('schema_version', ?)", [
        String(GRAPH_SCHEMA_VERSION),
      ]);
    } else if (String(existing) !== String(GRAPH_SCHEMA_VERSION)) {
      run(db, "UPDATE graph_metadata SET value = ? WHERE key = 'schema_version'", [String(GRAPH_SCHEMA_VERSION)]);
    }
    return new GraphStore(db, dbPath);
  }

  save(): void {
    saveDatabase(this.db);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  transaction<T>(operation: () => T): T {
    if (this.db.inTransaction) return operation();
    return this.db.transaction(operation)();
  }

  clear(): void {
    run(this.db, "DELETE FROM graph_flow_nodes");
    run(this.db, "DELETE FROM graph_flows");
    run(this.db, "DELETE FROM graph_edges");
    run(this.db, "DELETE FROM graph_nodes");
    run(this.db, "DELETE FROM graph_files");
    run(this.db, "DELETE FROM graph_search_index");
    this.setMetadata("parser_version", GRAPH_PARSER_VERSION);
    this.setMetadata("last_full_build_at", new Date().toISOString());
  }

  setMetadata(key: string, value: string): void {
    run(
      this.db,
      "INSERT INTO graph_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  getMetadata(key: string): string | null {
    const value = scalar(this.db, "SELECT value FROM graph_metadata WHERE key = ?", [key]);
    return typeof value === "string" ? value : null;
  }

  removeFile(path: string): void {
    run(this.db, "DELETE FROM graph_edges WHERE file_path = ?", [path]);
    run(this.db, "DELETE FROM graph_nodes WHERE file_path = ?", [path]);
    run(this.db, "DELETE FROM graph_files WHERE path = ?", [path]);
    run(this.db, "DELETE FROM graph_search_index WHERE file_path = ?", [path]);
  }

  upsertFile(record: Omit<GraphFileRecord, "id">): void {
    run(
      this.db,
      `INSERT INTO graph_files (path, language, hash, size, mtime_ms, parser_version, indexed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         language = excluded.language,
         hash = excluded.hash,
         size = excluded.size,
         mtime_ms = excluded.mtime_ms,
         parser_version = excluded.parser_version,
         indexed_at = excluded.indexed_at,
         status = excluded.status`,
      [
        record.path,
        record.language,
        record.hash,
        record.size,
        record.mtimeMs,
        record.parserVersion,
        record.indexedAt,
        record.status,
      ],
    );
  }

  getFile(path: string): GraphFileRecord | null {
    const row = rows(this.db, "SELECT * FROM graph_files WHERE path = ?", [path])[0];
    return row ? fileFromRow(row) : null;
  }

  upsertNode(node: GraphNodeInput): void {
    run(
      this.db,
      `INSERT INTO graph_nodes
       (kind, name, qualified_name, file_path, line_start, line_end, language, parent_name, is_test, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(qualified_name) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         file_path = excluded.file_path,
         line_start = excluded.line_start,
         line_end = excluded.line_end,
         language = excluded.language,
         parent_name = excluded.parent_name,
         is_test = excluded.is_test,
         metadata_json = excluded.metadata_json`,
      [
        node.kind,
        node.name,
        node.qualifiedName,
        node.filePath,
        node.lineStart,
        node.lineEnd,
        node.language,
        node.parentName ?? null,
        node.isTest ? 1 : 0,
        stableJson(node.metadata),
      ],
    );
  }

  upsertEdge(edge: GraphEdgeInput): void {
    run(
      this.db,
      `INSERT INTO graph_edges
       (kind, source_qualified, target_qualified, file_path, line, confidence, confidence_tier, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, source_qualified, target_qualified, file_path, line) DO UPDATE SET
         confidence = excluded.confidence,
         confidence_tier = excluded.confidence_tier,
         metadata_json = excluded.metadata_json`,
      [
        edge.kind,
        edge.sourceQualified,
        edge.targetQualified,
        edge.filePath,
        edge.line ?? 0,
        edge.confidence ?? 1,
        edge.confidenceTier ?? "EXTRACTED",
        stableJson(edge.metadata),
      ],
    );
  }

  rebuildSearchIndex(): void {
    run(this.db, "DELETE FROM graph_search_index");
    this.rebuildSearchIndexForFiles(this.indexedFilePaths());
  }

  rebuildSearchIndexForFiles(filePaths: string[]): void {
    const uniqueFiles = [...new Set(filePaths)].filter(Boolean);
    if (uniqueFiles.length === 0) {
      this.rebuildFtsIndex();
      return;
    }

    const fileRows = rows(
      this.db,
      `SELECT path, language FROM graph_files
       WHERE status = 'indexed' AND path IN (${uniqueFiles.map(() => "?").join(", ")})
       ORDER BY path ASC`,
      uniqueFiles,
    );
    for (const row of fileRows) {
      const filePath = String(row["path"] ?? "");
      const language = String(row["language"] ?? "");
      const searchRow: GraphSearchIndexRow = {
        entityType: "file",
        qualifiedName: filePath,
        filePath,
        name: filePath.split("/").at(-1) ?? filePath,
        kind: "File",
        language,
        signatureTokens: "",
        searchText: buildSearchText({
          name: filePath.split("/").at(-1) ?? filePath,
          qualifiedName: filePath,
          filePath,
          kind: "File",
          signatureTokens: "",
        }),
      };
      this.upsertSearchIndexRow(searchRow);
    }

    const nodeRows = rows(
      this.db,
      `SELECT * FROM graph_nodes
       WHERE file_path IN (${uniqueFiles.map(() => "?").join(", ")})
       ORDER BY file_path ASC, line_start ASC`,
      uniqueFiles,
    );
    for (const row of nodeRows) {
      const node = nodeFromRow(row);
      const signatureTokens = extractNodeSignatureTokens(node);
      const searchRow: GraphSearchIndexRow = {
        entityType: node.kind === "File" ? "file" : "node",
        qualifiedName: node.qualifiedName,
        filePath: node.filePath,
        name: node.name,
        kind: node.kind,
        language: node.language,
        signatureTokens,
        searchText: buildSearchText({
          name: node.name,
          qualifiedName: node.qualifiedName,
          filePath: node.filePath,
          kind: node.kind,
          signatureTokens,
        }),
      };
      this.upsertSearchIndexRow(searchRow);
    }

    this.rebuildFtsIndex();
  }

  search(query: string, limit: number, status: GraphExplorationStatus, warnings: string[]): GraphSearchResult {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        status,
        query,
        summary: "Graph search query is empty.",
        limit,
        results: [],
        warnings,
        truncated: false,
      };
    }

    if (supportsFts5(this.db)) {
      try {
        return this.searchFts(normalizedQuery, limit, status, warnings);
      } catch {
        // FTS5 can exist but fail if the virtual table is stale or a packaged
        // SQLite build differs at runtime. Keep fallback bounded and explicit.
      }
    }

    const fallbackWarnings = [
      ...warnings,
      "Graph FTS5 search unavailable or returned no matches; using bounded JavaScript search fallback.",
    ];
    const queryTokens = tokenizeForSearch(normalizedQuery);
    const prefilter = queryTokens.length > 0 ? `%${queryTokens[0]}%` : `%${normalizedQuery.toLowerCase()}%`;
    const allRows = rows(
      this.db,
      `SELECT * FROM graph_search_index
       WHERE lower(search_text) LIKE ?
       ORDER BY file_path ASC, qualified_name ASC
       LIMIT 5000`,
      [prefilter],
    );
    const matches = allRows
      .map((row) => toSearchResultItem(row, this.findNode(String(row["qualified_name"] ?? "")), queryTokens, normalizedQuery))
      .filter((item): item is GraphSearchResultItem & { internalScore: number } => item !== null)
      .sort((a, b) => b.internalScore - a.internalScore || a.filePath.localeCompare(b.filePath) || a.qualifiedName.localeCompare(b.qualifiedName));

    const truncated = matches.length > limit;
    const results = matches.slice(0, limit).map(({ internalScore: _internalScore, ...item }) => item);
    return {
      status,
      query,
      summary: results.length > 0
        ? `Found ${matches.length} graph search result(s) for '${query}'.`
        : `No graph search results for '${query}'.`,
      limit,
      results,
      warnings: fallbackWarnings,
      truncated,
    };
  }

  edgesForFrontier(qualifiedNames: string[], traversalKinds: string[]): GraphEdge[] {
    const uniqueNames = [...new Set(qualifiedNames)].filter(Boolean);
    const uniqueKinds = [...new Set(traversalKinds)].filter(Boolean);
    if (uniqueNames.length === 0 || uniqueKinds.length === 0) return [];
    const namePlaceholders = uniqueNames.map(() => "?").join(", ");
    const kindPlaceholders = uniqueKinds.map(() => "?").join(", ");
    return rows(
      this.db,
      `SELECT * FROM graph_edges
       WHERE kind IN (${kindPlaceholders})
         AND (source_qualified IN (${namePlaceholders}) OR target_qualified IN (${namePlaceholders}))
       ORDER BY file_path ASC, line ASC`,
      [...uniqueKinds, ...uniqueNames, ...uniqueNames],
    ).map(edgeFromRow);
  }

  findNodes(targets: string[]): Map<string, GraphNode> {
    const uniqueTargets = [...new Set(targets)].filter(Boolean);
    const found = new Map<string, GraphNode>();
    if (uniqueTargets.length === 0) return found;
    for (const chunk of chunks(uniqueTargets, 500)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const nodeRows = rows(
        this.db,
        `SELECT * FROM graph_nodes
         WHERE qualified_name IN (${placeholders})
            OR file_path IN (${placeholders})
            OR name IN (${placeholders})`,
        [...chunk, ...chunk, ...chunk],
      ).map(nodeFromRow);
      for (const node of nodeRows) {
        found.set(node.qualifiedName, node);
        found.set(node.filePath, node);
        if (!found.has(node.name)) found.set(node.name, node);
      }
    }
    return found;
  }

  nodesByFile(filePath: string): GraphNode[] {
    return rows(this.db, "SELECT * FROM graph_nodes WHERE file_path = ? ORDER BY line_start ASC", [
      filePath,
    ]).map(nodeFromRow);
  }

  allNodes(): GraphNode[] {
    return rows(this.db, "SELECT * FROM graph_nodes ORDER BY file_path ASC, line_start ASC").map(nodeFromRow);
  }

  indexedFilePaths(): string[] {
    return rows(this.db, "SELECT path FROM graph_files WHERE status = 'indexed' ORDER BY path ASC")
      .map((row) => row["path"])
      .filter((value): value is string => typeof value === "string");
  }

  findNode(target: string): GraphNode | null {
    const direct = rows(this.db, "SELECT * FROM graph_nodes WHERE qualified_name = ? LIMIT 1", [target])[0];
    if (direct) return nodeFromRow(direct);
    const byFile = rows(this.db, "SELECT * FROM graph_nodes WHERE file_path = ? AND kind = 'File' LIMIT 1", [
      target,
    ])[0];
    if (byFile) return nodeFromRow(byFile);
    const byName = rows(this.db, "SELECT * FROM graph_nodes WHERE name = ? ORDER BY kind ASC LIMIT 1", [target])[0];
    return byName ? nodeFromRow(byName) : null;
  }

  edgesBySource(sourceQualified: string, kind?: string): GraphEdge[] {
    const sql = kind
      ? "SELECT * FROM graph_edges WHERE source_qualified = ? AND kind = ? ORDER BY line ASC"
      : "SELECT * FROM graph_edges WHERE source_qualified = ? ORDER BY line ASC";
    return rows(this.db, sql, kind ? [sourceQualified, kind] : [sourceQualified]).map(edgeFromRow);
  }

  edgesByTarget(targetQualified: string, kind?: string): GraphEdge[] {
    const sql = kind
      ? "SELECT * FROM graph_edges WHERE target_qualified = ? AND kind = ? ORDER BY line ASC"
      : "SELECT * FROM graph_edges WHERE target_qualified = ? ORDER BY line ASC";
    return rows(this.db, sql, kind ? [targetQualified, kind] : [targetQualified]).map(edgeFromRow);
  }

  edgesByFile(filePath: string): GraphEdge[] {
    return rows(this.db, "SELECT * FROM graph_edges WHERE file_path = ? ORDER BY line ASC", [filePath]).map(edgeFromRow);
  }

  allEdges(): GraphEdge[] {
    return rows(this.db, "SELECT * FROM graph_edges ORDER BY file_path ASC, line ASC").map(edgeFromRow);
  }

  edgeCount(): number {
    return Number(scalar(this.db, "SELECT COUNT(*) FROM graph_edges") ?? 0);
  }

  moduleBridgeSummaries(modules: string[], limitPerModule = 5): GraphModuleBridgeSummary[] {
    const uniqueModules = [...new Set(modules)].filter(Boolean);
    if (uniqueModules.length === 0) return [];
    const candidateRows = rows(
      this.db,
      `SELECT e.file_path, e.source_qualified, e.target_qualified
       FROM graph_edges e
       WHERE ${uniqueModules.map(() => "(e.file_path = ? OR e.file_path LIKE ?)").join(" OR ")}
       ORDER BY e.file_path ASC, e.source_qualified ASC`,
      uniqueModules.flatMap((sourceModule) => [sourceModule, `${sourceModule}/%`]),
    ) as Array<{ file_path?: unknown; source_qualified?: unknown; target_qualified?: unknown }>;
    const targetLookup = this.findNodes(
      candidateRows
        .map((row) => row.target_qualified)
        .filter((target): target is string => typeof target === "string"),
    );
    const summaries = new Map<string, {
      crossModuleEdgeCount: number;
      bridgeFiles: Set<string>;
      bridgeQualifiedNames: Set<string>;
    }>();

    for (const row of candidateRows) {
      const filePath = typeof row.file_path === "string" ? row.file_path : "";
      const sourceQualified = typeof row.source_qualified === "string" ? row.source_qualified : "";
      const targetQualified = typeof row.target_qualified === "string" ? row.target_qualified : "";
      if (!filePath || !sourceQualified || !targetQualified) continue;
      const sourceModule = uniqueModules.find((module) => filePath === module || filePath.startsWith(`${module}/`));
      if (!sourceModule) continue;
      const targetFile = targetLookup.get(targetQualified)?.filePath ?? filePath;
      if (targetFile === sourceModule || targetFile.startsWith(`${sourceModule}/`)) continue;
      const summary = summaries.get(sourceModule) ?? {
        crossModuleEdgeCount: 0,
        bridgeFiles: new Set<string>(),
        bridgeQualifiedNames: new Set<string>(),
      };
      summary.crossModuleEdgeCount++;
      if (summary.bridgeFiles.size < limitPerModule) summary.bridgeFiles.add(filePath);
      if (summary.bridgeQualifiedNames.size < limitPerModule) summary.bridgeQualifiedNames.add(sourceQualified);
      summaries.set(sourceModule, summary);
    }

    return uniqueModules.map((sourceModule) => {
      const summary = summaries.get(sourceModule);
      return {
        sourceModule,
        crossModuleEdgeCount: summary?.crossModuleEdgeCount ?? 0,
        bridgeFiles: [...(summary?.bridgeFiles ?? [])],
        bridgeQualifiedNames: [...(summary?.bridgeQualifiedNames ?? [])],
      };
    }).filter((summary) => summary.crossModuleEdgeCount > 0);
  }

  replaceFlows(flows: (GraphFlow & { nodeQualifiedNames: string[] })[]): void {
    run(this.db, "DELETE FROM graph_flow_nodes");
    run(this.db, "DELETE FROM graph_flows");
    this.insertFlows(flows);
  }

  replaceFlowsForFiles(filePaths: string[], flows: (GraphFlow & { nodeQualifiedNames: string[] })[]): void {
    const fileSet = new Set(filePaths.filter(Boolean));
    const entryQualifiedNames = new Set(flows.map((flow) => flow.entryQualified).filter(Boolean));
    if (fileSet.size === 0 && entryQualifiedNames.size === 0) return;

    const existingIds = rows(this.db, "SELECT id, entry_qualified, metadata_json FROM graph_flows")
      .filter((row) => {
        const entryQualified = String(row["entry_qualified"] ?? "");
        if (entryQualifiedNames.has(entryQualified)) return true;
        const metadata = parseJsonObject(String(row["metadata_json"] ?? "{}"));
        const files = Array.isArray(metadata["files"]) ? metadata["files"] : [];
        return files.some((file) => typeof file === "string" && fileSet.has(file));
      })
      .map((row) => Number(row["id"]))
      .filter((id) => Number.isFinite(id));
    if (existingIds.length > 0) {
      const idPlaceholders = existingIds.map(() => "?").join(", ");
      run(this.db, `DELETE FROM graph_flow_nodes WHERE flow_id IN (${idPlaceholders})`, existingIds);
      run(this.db, `DELETE FROM graph_flows WHERE id IN (${idPlaceholders})`, existingIds);
    }
    this.insertFlows(flows);
  }

  flowCount(): number {
    return Number(scalar(this.db, "SELECT COUNT(*) FROM graph_flows") ?? 0);
  }

  private insertFlows(flows: (GraphFlow & { nodeQualifiedNames: string[] })[]): void {
    for (const flow of flows) {
      run(
        this.db,
        `INSERT INTO graph_flows (name, entry_qualified, criticality, metadata_json)
         VALUES (?, ?, ?, ?)`,
        [
          flow.name,
          flow.entryQualified,
          flow.criticality,
          stableJson({ files: flow.files }),
        ],
      );
      const flowId = Number(scalar(this.db, "SELECT last_insert_rowid()") ?? 0);
      flow.nodeQualifiedNames.forEach((qualifiedName, index) => {
        run(
          this.db,
          `INSERT INTO graph_flow_nodes (flow_id, node_qualified, step_index)
           VALUES (?, ?, ?)`,
          [flowId, qualifiedName, index],
        );
      });
    }
  }

  flowsForNodes(qualifiedNames: string[]): GraphFlow[] {
    const uniqueNames = [...new Set(qualifiedNames)].filter(Boolean);
    if (uniqueNames.length === 0) return [];
    const placeholders = uniqueNames.map(() => "?").join(", ");
    return rows(
      this.db,
      `SELECT DISTINCT f.*
       FROM graph_flows f
       JOIN graph_flow_nodes fn ON fn.flow_id = f.id
       WHERE fn.node_qualified IN (${placeholders})
       ORDER BY f.criticality DESC, f.name ASC`,
      uniqueNames,
    ).map((row) => flowFromRow(this.db, row));
  }

  status(): GraphStatus {
    const nodeCount = Number(scalar(this.db, "SELECT COUNT(*) FROM graph_nodes") ?? 0);
    const edgeCount = Number(scalar(this.db, "SELECT COUNT(*) FROM graph_edges") ?? 0);
    const indexedFileCount = Number(
      scalar(this.db, "SELECT COUNT(*) FROM graph_files WHERE status = 'indexed'") ?? 0,
    );
    const unsupportedFileCount = Number(
      scalar(this.db, "SELECT COUNT(*) FROM graph_files WHERE status = 'unsupported'") ?? 0,
    );
    const erroredFileCount = Number(
      scalar(this.db, "SELECT COUNT(*) FROM graph_files WHERE status = 'error'") ?? 0,
    );
    const lastIndexedAt = scalar(this.db, "SELECT MAX(indexed_at) FROM graph_files");
    const languageRows = rows(
      this.db,
      "SELECT DISTINCT language FROM graph_files WHERE status = 'indexed' ORDER BY language ASC",
    );
    const storedParserVersion = this.getMetadata("parser_version");
    const warnings: string[] = [];
    let status: GraphStatus["status"] = "ready";
    if (storedParserVersion && storedParserVersion !== GRAPH_PARSER_VERSION) {
      status = "stale";
      warnings.push("Graph parser version changed; run `ocr graph build --full`.");
    } else if (erroredFileCount > 0) {
      status = "degraded";
      warnings.push("Graph contains files that failed to index; some graph results may be incomplete.");
    }
    return {
      status,
      dbPath: this.dbPath,
      indexedFileCount,
      unsupportedFileCount,
      erroredFileCount,
      nodeCount,
      edgeCount,
      languages: languageRows
        .map((row) => row["language"])
        .filter((value): value is SupportedLanguage => typeof value === "string") as SupportedLanguage[],
      lastIndexedAt: typeof lastIndexedAt === "string" ? lastIndexedAt : undefined,
      warnings,
    };
  }

  private upsertSearchIndexRow(row: GraphSearchIndexRow): void {
    run(
      this.db,
      `INSERT INTO graph_search_index
       (entity_type, qualified_name, file_path, name, kind, language, signature_tokens, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(qualified_name) DO UPDATE SET
         entity_type = excluded.entity_type,
         file_path = excluded.file_path,
         name = excluded.name,
         kind = excluded.kind,
         language = excluded.language,
         signature_tokens = excluded.signature_tokens,
         search_text = excluded.search_text`,
      [
        row.entityType,
        row.qualifiedName,
        row.filePath,
        row.name,
        row.kind,
        row.language,
        row.signatureTokens,
        row.searchText,
      ],
    );
  }

  private rebuildFtsIndex(): void {
    if (!supportsFts5(this.db)) return;
    run(this.db, "INSERT INTO graph_search_fts(graph_search_fts) VALUES('rebuild')");
  }

  private searchFts(query: string, limit: number, status: GraphExplorationStatus, warnings: string[]): GraphSearchResult {
    const ftsQuery = tokenizeForSearch(query).map((token) => `"${token.replaceAll('"', '""')}"`).join(" ");
    if (!ftsQuery) {
      return {
        status,
        query,
        summary: "Graph search query is empty.",
        limit,
        results: [],
        warnings,
        truncated: false,
      };
    }
    const resultRows = rows(
      this.db,
      `SELECT s.*, bm25(graph_search_fts) AS score
       FROM graph_search_fts
       JOIN graph_search_index s ON s.rowid = graph_search_fts.rowid
       WHERE graph_search_fts MATCH ?
       ORDER BY score ASC
       LIMIT ?`,
      [ftsQuery, limit + 1],
    );
    const truncated = resultRows.length > limit;
    const results = resultRows
      .slice(0, limit)
      .map((row) => toSearchResultItem(row, this.findNode(String(row["qualified_name"] ?? "")), tokenizeForSearch(query), query))
      .filter((item): item is GraphSearchResultItem & { internalScore: number } => item !== null)
      .map(({ internalScore: _internalScore, ...item }) => item);
    return {
      status,
      query,
      summary: results.length > 0
        ? `Found ${truncated ? `${limit}+` : String(results.length)} graph search result(s) for '${query}'.`
        : `No graph search results for '${query}'.`,
      limit,
      results,
      warnings,
      truncated,
    };
  }
}

function ensureFtsSchema(db: Database): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS graph_search_fts USING fts5(
        qualified_name,
        file_path,
        name,
        kind,
        signature_tokens,
        search_text,
        content='graph_search_index',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);
  } catch {
    // FTS5 is optional in some SQLite builds; search falls back to bounded JS scoring.
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function buildSearchText(parts: {
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: string;
  signatureTokens: string;
}): string {
  return [parts.name, parts.qualifiedName, parts.filePath, parts.kind, parts.signatureTokens]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function extractNodeSignatureTokens(node: GraphNode): string {
  const metadata = node.metadata ?? {};
  const signatureValues = [metadata["signature"], metadata["signatureText"], metadata["signature_text"]]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return normalizeSignatureTokens(signatureValues.join(" "));
}

function toSearchResultItem(
  row: Row,
  node: GraphNode | null,
  queryTokens: string[],
  queryText: string,
): (GraphSearchResultItem & { internalScore: number }) | null {
  const entityType = String(row["entity_type"] ?? "node") as GraphSearchResultItem["entityType"];
  const qualifiedName = String(row["qualified_name"] ?? "");
  const filePath = String(row["file_path"] ?? "");
  const name = String(row["name"] ?? "");
  const kind = String(row["kind"] ?? "");
  const language = String(row["language"] ?? "");
  const signatureTokens = String(row["signature_tokens"] ?? "");
  const searchText = String(row["search_text"] ?? "");

  const matchTypes: GraphSearchMatchType[] = [];
  const loweredQuery = queryText.toLowerCase();
  const loweredName = name.toLowerCase();
  const loweredQualifiedName = qualifiedName.toLowerCase();
  const loweredFilePath = filePath.toLowerCase();
  const loweredKind = kind.toLowerCase();
  const loweredSignature = signatureTokens.toLowerCase();

  if (loweredName.includes(loweredQuery)) matchTypes.push("name");
  if (loweredQualifiedName.includes(loweredQuery)) matchTypes.push("qualified_name");
  if (loweredFilePath.includes(loweredQuery)) matchTypes.push("file_path");
  if (loweredKind.includes(loweredQuery)) matchTypes.push("kind");
  if (loweredSignature && loweredSignature.includes(loweredQuery)) matchTypes.push("signature");

  const tokenMatches = queryTokens.every((token) => searchText.includes(token));
  if (!tokenMatches && matchTypes.length === 0) return null;
  if (tokenMatches && matchTypes.length === 0) {
    if (queryTokens.some((token) => loweredName.includes(token))) matchTypes.push("name");
    if (queryTokens.some((token) => loweredQualifiedName.includes(token))) matchTypes.push("qualified_name");
    if (queryTokens.some((token) => loweredFilePath.includes(token))) matchTypes.push("file_path");
    if (queryTokens.some((token) => loweredKind.includes(token))) matchTypes.push("kind");
    if (queryTokens.some((token) => loweredSignature.includes(token))) matchTypes.push("signature");
  }

  if (matchTypes.length === 0) return null;

  const uniqueMatchTypes = [...new Set(matchTypes)];
  const score = scoreSearchMatch(uniqueMatchTypes, queryTokens, { name: loweredName, qualifiedName: loweredQualifiedName, filePath: loweredFilePath, kind: loweredKind, signature: loweredSignature });

  return {
    entityType,
    qualifiedName,
    filePath,
    name,
    kind,
    language,
    matchTypes: uniqueMatchTypes,
    score,
    node: node ?? undefined,
    internalScore: score,
  };
}

function scoreSearchMatch(
  matchTypes: GraphSearchMatchType[],
  queryTokens: string[],
  fields: { name: string; qualifiedName: string; filePath: string; kind: string; signature: string },
): number {
  let score = 0;
  for (const type of matchTypes) {
    switch (type) {
      case "name":
        score += 5;
        break;
      case "qualified_name":
        score += 4;
        break;
      case "file_path":
        score += 3;
        break;
      case "kind":
        score += 1;
        break;
      case "signature":
        score += 2;
        break;
    }
  }
  for (const token of queryTokens) {
    if (fields.name === token) score += 4;
    else if (fields.name.includes(token)) score += 2;
    if (fields.qualifiedName.includes(token)) score += 1;
    if (fields.signature.includes(token)) score += 0.5;
  }
  return score;
}

function fileFromRow(row: Row): GraphFileRecord {
  return {
    id: Number(row["id"] ?? 0),
    path: String(row["path"] ?? ""),
    language: String(row["language"] ?? "unsupported") as GraphFileRecord["language"],
    hash: String(row["hash"] ?? ""),
    size: Number(row["size"] ?? 0),
    mtimeMs: Number(row["mtime_ms"] ?? 0),
    parserVersion: String(row["parser_version"] ?? ""),
    indexedAt: String(row["indexed_at"] ?? ""),
    status: String(row["status"] ?? "indexed") as GraphFileRecord["status"],
  };
}

function nodeFromRow(row: Row): GraphNode {
  return {
    id: Number(row["id"] ?? 0),
    kind: String(row["kind"] ?? "File") as GraphNode["kind"],
    name: String(row["name"] ?? ""),
    qualifiedName: String(row["qualified_name"] ?? ""),
    filePath: String(row["file_path"] ?? ""),
    lineStart: Number(row["line_start"] ?? 1),
    lineEnd: Number(row["line_end"] ?? 1),
    language: String(row["language"] ?? "javascript") as SupportedLanguage,
    parentName: typeof row["parent_name"] === "string" ? row["parent_name"] : null,
    isTest: Number(row["is_test"] ?? 0) === 1,
    metadata: parseJsonObject(typeof row["metadata_json"] === "string" ? row["metadata_json"] : "{}"),
  };
}

function edgeFromRow(row: Row): GraphEdge {
  return {
    id: Number(row["id"] ?? 0),
    kind: String(row["kind"] ?? "CALLS") as GraphEdge["kind"],
    sourceQualified: String(row["source_qualified"] ?? ""),
    targetQualified: String(row["target_qualified"] ?? ""),
    filePath: String(row["file_path"] ?? ""),
    line: Number(row["line"] ?? 0),
    confidence: Number(row["confidence"] ?? 1),
    confidenceTier: String(row["confidence_tier"] ?? "EXTRACTED") as GraphEdge["confidenceTier"],
    metadata: parseJsonObject(typeof row["metadata_json"] === "string" ? row["metadata_json"] : "{}"),
  };
}

function flowFromRow(db: Database, row: Row): GraphFlow {
  const flowId = Number(row["id"] ?? 0);
  const files = rows(
    db,
    `SELECT DISTINCT n.file_path
     FROM graph_flow_nodes fn
     JOIN graph_nodes n ON n.qualified_name = fn.node_qualified
     WHERE fn.flow_id = ?
     ORDER BY n.file_path ASC`,
    [flowId],
  )
    .map((fileRow) => fileRow["file_path"])
    .filter((value): value is string => typeof value === "string");

  const metadata = parseJsonObject(typeof row["metadata_json"] === "string" ? row["metadata_json"] : "{}");
  const metadataFiles = Array.isArray(metadata["files"])
    ? metadata["files"].filter((value): value is string => typeof value === "string")
    : [];

  return {
    name: String(row["name"] ?? ""),
    entryQualified: String(row["entry_qualified"] ?? ""),
    files: files.length > 0 ? files : metadataFiles,
    criticality: Number(row["criticality"] ?? 0),
  };
}
