import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectLanguage } from "../language.js";
import { parseSourceFile } from "../parsers/parser.js";
import { GraphStore } from "../storage/db.js";
import { rebuildFlows, rebuildFlowsForFiles } from "./flow-detector.js";
import { addNodeResolvedDependencyEdges } from "./node-resolver.js";
import {
  GRAPH_PARSER_VERSION,
  type BuildGraphOptions,
  type GraphBuildResult,
  type GraphBuildProgress,
  type GraphPostprocessLevel,
  type UpdateGraphOptions,
} from "../types.js";
import { ensureDir, fileHash, fileInfo, graphDbPath, relativePath, toPosixPath } from "../utils.js";

const IGNORE_PARTS = new Set([
  ".git",
  ".ocr",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  "coverage",
  "vendor",
]);

const IGNORED_FILE_PATTERNS = [
  /\.min\.[cm]?[jt]s$/i,
  /\.map$/i,
  /\.lock$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /\.(db|sqlite|db-wal|db-shm)$/i,
];
const MAX_INCREMENTAL_FLOW_REBUILD_EDGES = 50_000;

export async function buildGraph(options: BuildGraphOptions): Promise<GraphBuildResult> {
  const repoRoot = resolve(options.repoRoot);
  const postprocess = options.postprocess ?? "full";
  ensureDir(dirname(graphDbPath(repoRoot, options.ocrDir)));
  const store = await GraphStore.open(repoRoot, options.ocrDir);
  try {
    options.onProgress?.({ phase: "discovering" });
    const files = listProjectFiles(repoRoot);
    options.onProgress?.({ phase: "discovered", totalFiles: files.length, processedFiles: 0 });
    store.transaction(() => {
      store.clear();
    });
    const result = await indexFiles(store, repoRoot, files, true, postprocess, options.onProgress);
    const postprocessResult = runPostprocess(store, postprocess, {
      mode: "full",
      totalFiles: files.length,
      processedFiles: result.filesScanned,
      onProgress: options.onProgress,
    });
    store.transaction(() => {
      store.setMetadata("parser_version", GRAPH_PARSER_VERSION);
      store.setMetadata("last_full_build_at", new Date().toISOString());
    });
    options.onProgress?.({ phase: "saving", totalFiles: files.length, processedFiles: result.filesScanned });
    store.save();
    const status = store.status();
    options.onProgress?.({ phase: "done", totalFiles: files.length, processedFiles: result.filesScanned, ...result });
    return {
      ...status,
      ...result,
      filesChanged: result.filesIndexed + result.filesErrored + result.filesRemoved,
      postprocess,
      postprocessRan: postprocessResult.ran,
      postprocessWarnings: postprocessResult.warnings,
    };
  } finally {
    store.close();
  }
}

export async function updateGraph(options: UpdateGraphOptions): Promise<GraphBuildResult> {
  const repoRoot = resolve(options.repoRoot);
  const postprocess = options.postprocess ?? "minimal";
  ensureDir(dirname(graphDbPath(repoRoot, options.ocrDir)));
  const store = await GraphStore.open(repoRoot, options.ocrDir);
  try {
    const changedFiles = options.changedFiles ?? getChangedFiles(repoRoot, options);
    const status = store.status();
    if (status.status === "stale") {
      return {
        ...status,
        filesScanned: changedFiles.length,
        filesIndexed: 0,
        filesSkipped: 0,
        filesUnsupported: 0,
        filesErrored: 0,
        filesRemoved: 0,
        filesChanged: 0,
        postprocess,
        postprocessRan: false,
        postprocessWarnings: [],
      };
    }
    const result = await indexFiles(store, repoRoot, changedFiles, false, postprocess);
    const filesChanged = result.filesIndexed + result.filesErrored + result.filesRemoved;
    const postprocessResult = filesChanged > 0
      ? runPostprocess(store, postprocess, {
        mode: "incremental",
        changedFiles,
      })
      : { ran: false, warnings: [] };
    store.transaction(() => {
      store.setMetadata("parser_version", GRAPH_PARSER_VERSION);
      store.setMetadata("last_update_at", new Date().toISOString());
    });
    store.save();
    return {
      ...store.status(),
      ...result,
      filesChanged,
      postprocess,
      postprocessRan: postprocessResult.ran,
      postprocessWarnings: postprocessResult.warnings,
    };
  } finally {
    store.close();
  }
}

export function getChangedFiles(repoRoot: string, options: { base?: string; staged?: boolean; workingTree?: boolean } = {}): string[] {
  const args = options.staged
    ? ["diff", "--name-only", "--cached"]
    : options.workingTree
      ? ["diff", "--name-only"]
      : ["diff", "--name-only", options.base ?? "HEAD~1"];
  try {
    const output = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Fall through to staged + working tree status below.
  }

  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function listProjectFiles(repoRoot: string): string[] {
  try {
    const output = execFileSync("git", ["ls-files", "--recurse-submodules"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !shouldIgnore(line));
  } catch {
    return walkFiles(repoRoot, repoRoot);
  }
}

async function indexFiles(
  store: GraphStore,
  repoRoot: string,
  relFiles: string[],
  fullBuild: boolean,
  postprocess: GraphPostprocessLevel,
  onProgress?: (progress: GraphBuildProgress) => void,
): Promise<Pick<GraphBuildResult, "filesScanned" | "filesIndexed" | "filesSkipped" | "filesUnsupported" | "filesErrored" | "filesRemoved">> {
  let filesIndexed = 0;
  let filesSkipped = 0;
  let filesUnsupported = 0;
  let filesErrored = 0;
  let filesRemoved = 0;
  const files = unique(relFiles.map(toPosixPath).filter((file) => file && !shouldIgnore(file)));
  const totalFiles = files.length;
  const progressInterval = Math.max(1, Math.floor(totalFiles / 20));
  let processedFiles = 0;

  for (const relFile of files) {
    const absPath = resolve(repoRoot, relFile);
    if (!existsSync(absPath)) {
      store.transaction(() => {
        store.removeFile(relFile);
      });
      filesRemoved++;
      processedFiles++;
      emitIndexProgress();
      continue;
    }
    const language = detectLanguage(relFile);
    if (!language) {
      filesUnsupported++;
      const info = fileInfo(absPath);
      store.transaction(() => {
        store.upsertFile({
          path: relFile,
          language: "unsupported",
          hash: fileHash(absPath),
          size: info.size,
          mtimeMs: info.mtimeMs,
          parserVersion: GRAPH_PARSER_VERSION,
          indexedAt: new Date().toISOString(),
          status: "unsupported",
        });
      });
      processedFiles++;
      emitIndexProgress(relFile);
      continue;
    }

    try {
      const hash = fileHash(absPath);
      const existing = store.getFile(relFile);
      if (!fullBuild && existing?.hash === hash && existing.parserVersion === GRAPH_PARSER_VERSION) {
        filesSkipped++;
        processedFiles++;
        emitIndexProgress(relFile);
        continue;
      }

      const source = readFileSync(absPath, "utf-8");
      const parsed = await parseSourceFile(relFile, source);
      const info = fileInfo(absPath);
      store.transaction(() => {
        store.removeFile(relFile);
        store.upsertFile({
          path: relFile,
          language,
          hash,
          size: info.size,
          mtimeMs: info.mtimeMs,
          parserVersion: GRAPH_PARSER_VERSION,
          indexedAt: new Date().toISOString(),
          status: "indexed",
        });
        if (parsed) {
          for (const node of parsed.nodes) store.upsertNode(node);
          const edges = addNodeResolvedDependencyEdges(repoRoot, relFile, parsed.language, parsed.edges);
          for (const edge of edges) store.upsertEdge(edge);
        }
      });
      filesIndexed++;
    } catch {
      filesErrored++;
      const info = fileInfo(absPath);
      store.transaction(() => {
        store.removeFile(relFile);
        store.upsertFile({
          path: relFile,
          language,
          hash: fileHash(absPath),
          size: info.size,
          mtimeMs: info.mtimeMs,
          parserVersion: GRAPH_PARSER_VERSION,
          indexedAt: new Date().toISOString(),
          status: "error",
        });
      });
    }
    processedFiles++;
    emitIndexProgress(relFile);
  }

  return {
    filesScanned: files.length,
    filesIndexed,
    filesSkipped,
    filesUnsupported,
    filesErrored,
    filesRemoved,
  };

  function emitIndexProgress(currentFile?: string): void {
    if (!onProgress) return;
    if (processedFiles !== totalFiles && processedFiles % progressInterval !== 0) return;
    onProgress({
      phase: "indexing",
      totalFiles,
      processedFiles,
      currentFile,
      filesIndexed,
      filesSkipped,
      filesUnsupported,
      filesErrored,
    });
  }
}

function runPostprocess(
  store: GraphStore,
  postprocess: GraphPostprocessLevel,
  progress?: {
    mode?: "full" | "incremental";
    changedFiles?: string[];
    totalFiles?: number;
    processedFiles?: number;
    onProgress?: (progress: GraphBuildProgress) => void;
  },
): { ran: boolean; warnings: string[] } {
  if (postprocess === "none") return { ran: false, warnings: [] };
  const startedAt = Date.now();
  const warnings: string[] = [];
  store.transaction(() => {
    progress?.onProgress?.({
      phase: "rebuilding_search",
      totalFiles: progress.totalFiles,
      processedFiles: progress.processedFiles,
      nodeCount: store.status().nodeCount,
      edgeCount: store.edgeCount(),
    });
    if (progress?.mode === "incremental") {
      store.rebuildSearchIndexForFiles(progress.changedFiles ?? []);
    } else {
      store.rebuildSearchIndex();
    }
    if (postprocess === "full") {
      const edgeCount = store.edgeCount();
      if (progress?.mode === "incremental" && edgeCount > MAX_INCREMENTAL_FLOW_REBUILD_EDGES) {
        const downgradedReason = `Skipping incremental flow rebuild for large graph (${edgeCount} edge(s)); run ocr graph build --full to refresh flows.`;
        store.setMetadata("flows_status", "stale");
        store.setMetadata("flows_stale_reason", downgradedReason);
        warnings.push(downgradedReason);
        progress?.onProgress?.({
          phase: "rebuilding_flows",
          totalFiles: progress.totalFiles,
          processedFiles: progress.processedFiles,
          edgeCount,
          downgradedReason,
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }
      progress?.onProgress?.({
        phase: "rebuilding_flows",
        totalFiles: progress.totalFiles,
        processedFiles: progress.processedFiles,
        edgeCount,
      });
      const flowCount = progress?.mode === "incremental"
        ? rebuildFlowsForFiles(store, progress.changedFiles ?? [])
        : (rebuildFlows(store), store.flowCount());
      store.setMetadata("flows_status", "ready");
      store.setMetadata("flows_last_rebuilt_at", new Date().toISOString());
      progress?.onProgress?.({
        phase: "rebuilding_flows",
        totalFiles: progress.totalFiles,
        processedFiles: progress.processedFiles,
        edgeCount,
        flowCount,
        elapsedMs: Date.now() - startedAt,
      });
    }
  });
  return { ran: true, warnings };
}

function walkFiles(repoRoot: string, dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = join(dir, entry.name);
    const rel = relativePath(repoRoot, absPath);
    if (shouldIgnore(rel)) continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(repoRoot, absPath));
    } else if (entry.isFile()) {
      try {
        if (statSync(absPath).size < 2_000_000) files.push(rel);
      } catch {
        // Ignore unreadable files during best-effort fallback scanning.
      }
    }
  }
  return files;
}

function shouldIgnore(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.some((part) => IGNORE_PARTS.has(part))) return true;
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(relPath));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
