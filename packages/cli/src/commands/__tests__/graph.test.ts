import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const graphMocks = vi.hoisted(() => ({
  buildGraph: vi.fn(),
  generateGraphContext: vi.fn(),
  generateGraphMinimalContext: vi.fn(),
  generateGraphReviewAnalysis: vi.fn(),
  generateGraphReviewContext: vi.fn(),
  getGraphStatus: vi.fn(),
  getImpactRadius: vi.fn(),
  queryGraph: vi.fn(),
  renderGraphContextMarkdown: vi.fn(),
  searchGraph: vi.fn(),
  updateGraph: vi.fn(),
}));

vi.mock("@open-code-review/graph", () => graphMocks);

import { graphCommand } from "../graph.js";

let tmpDir: string;
let originalCwd: typeof process.cwd;

function makeStatus() {
  return {
    status: "ready",
    dbPath: join(tmpDir, ".ocr", "data", "graph.db"),
    indexedFileCount: 1,
    unsupportedFileCount: 0,
    nodeCount: 2,
    edgeCount: 1,
    languages: ["typescript"],
    lastIndexedAt: "2026-01-01T00:00:00.000Z",
    warnings: [],
  };
}

function makeBuildResult() {
  return {
    ...makeStatus(),
    filesScanned: 1,
    filesIndexed: 1,
    filesSkipped: 0,
    filesUnsupported: 0,
    filesErrored: 0,
    filesRemoved: 0,
    filesChanged: 1,
    postprocess: "minimal",
    postprocessRan: true,
  };
}

function makeQueryResult(summary = "ok") {
  return {
    status: "ok",
    summary,
    files: ["src/auth.ts"],
    nodes: [],
    edges: [],
    warnings: [],
    truncated: false,
  };
}

function makeSearchResult({
  status = "ready",
  summary = "search ok",
  warnings = [] as string[],
  truncated = false,
  results = [
    {
      entityType: "node",
      qualifiedName: "src/auth.ts#login",
      filePath: "src/auth.ts",
      name: "login",
      kind: "Function",
      language: "typescript",
      matchTypes: ["name"],
      score: 0.9,
    },
  ],
}: {
  status?: string;
  summary?: string;
  warnings?: string[];
  truncated?: boolean;
  results?: Array<{
    entityType: string;
    qualifiedName: string;
    filePath: string;
    name: string;
    kind: string;
    language: string;
    matchTypes: string[];
    score?: number;
  }>;
} = {}) {
  return {
    status,
    query: "auth",
    summary,
    limit: 20,
    results,
    warnings,
    truncated,
  };
}

function makeReviewAnalysis({
  status = "ready",
  summary = "analysis ok",
  warnings = [] as string[],
  truncated = false,
  priorities = [
    {
      qualifiedName: "src/auth.ts#login",
      filePath: "src/auth.ts",
      reason: "High fan-out from changed symbol.",
      score: 80,
    },
  ],
  hints = [
    {
      kind: "review_order",
      severity: "info",
      message: "Start review with src/auth.ts#login.",
      filePaths: ["src/auth.ts"],
      qualifiedNames: ["src/auth.ts#login"],
    },
  ],
  modules = [
    {
      name: "src",
      changedFiles: ["src/auth.ts"],
      impactedFiles: ["src/auth.ts"],
      changedSymbolCount: 1,
      impactedSymbolCount: 1,
      crossModuleEdgeCount: 0,
      bridgeFiles: [],
      bridgeQualifiedNames: [],
      summary: "src has 1 changed file(s).",
    },
  ],
  drilldown = {
    impactedFiles: ["src/auth.ts"],
    impactedNodes: [],
    flows: [],
    testGaps: [],
    unsupportedChangedFiles: [],
  },
}: {
  status?: string;
  summary?: string;
  warnings?: string[];
  truncated?: boolean;
  priorities?: Array<{
    qualifiedName: string;
    filePath: string;
    reason: string;
    score: number;
  }>;
  hints?: Array<{
    kind: string;
    severity: string;
    message: string;
    filePaths: string[];
    qualifiedNames: string[];
  }>;
  modules?: Array<{
    name: string;
    changedFiles: string[];
    impactedFiles: string[];
    changedSymbolCount: number;
    impactedSymbolCount: number;
    crossModuleEdgeCount: number;
    bridgeFiles: string[];
    bridgeQualifiedNames: string[];
    summary: string;
  }>;
  drilldown?: {
    impactedFiles: string[];
    impactedNodes: unknown[];
    flows: unknown[];
    testGaps: Array<{
      qualifiedName: string;
      filePath: string;
      lineStart: number;
      reason: string;
    }>;
    unsupportedChangedFiles: string[];
  };
} = {}) {
  return {
    status,
    summary,
    changedSymbols: [],
    priorities,
    hints,
    modules,
    drilldown,
    warnings,
    truncated,
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceScope: {
      workflow: "review",
      changedFileCount: 1,
      changedSymbolPrecision: "file",
    },
  };
}

function makeMinimalContext() {
  return {
    version: 1,
    workflow: "review",
    status: "ready",
    summary: "minimal ok",
    risk: {
      level: "medium",
      score: 0.42,
    },
    counts: {
      changedFiles: 1,
      changedSymbols: 1,
      impactedFiles: 2,
      testGaps: 1,
    },
    topPriorities: [
      {
        qualifiedName: "src/auth.ts#login",
        filePath: "src/auth.ts",
        reason: "Highest graph priority.",
        score: 0.9,
      },
    ],
    warnings: [],
    nextToolSuggestions: [
      {
        command: "ocr graph query tests_for --target src/auth.ts#login --limit 40",
        reason: "Check linked tests.",
        expectedValue: "Bounded test coverage lookup.",
        evidenceRequirement: "Confirm with source.",
        priority: "high",
      },
    ],
    budget: {
      maxPriorities: 5,
      maxWarnings: 5,
      maxSuggestions: 4,
      truncated: false,
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceScope: {
      workflow: "review",
      changedFileCount: 1,
      changedSymbolPrecision: "file",
    },
  };
}

function makeReviewContext() {
  return {
    version: 1,
    workflow: "review",
    status: "ready",
    summary: "review context ok",
    snippets: [
      {
        filePath: "src/auth.ts",
        lineStart: 10,
        lineEnd: 12,
        qualifiedNames: ["src/auth.ts#login"],
        kind: "changed_symbol",
        reason: "Changed symbol selected for direct source verification.",
        text: "export function login() {\n  return true\n}",
        truncated: false,
      },
    ],
    omittedFiles: [],
    warnings: [],
    nextToolSuggestions: [
      {
        command: "ocr graph query tests_for --target src/auth.ts#login --limit 40",
        reason: "Check linked tests.",
        expectedValue: "Bounded test coverage lookup.",
        evidenceRequirement: "Confirm with source.",
        priority: "high",
      },
    ],
    budget: {
      maxFiles: 6,
      maxSnippets: 12,
      maxLinesPerSnippet: 40,
      maxChars: 16000,
      truncated: false,
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    sourceScope: {
      workflow: "review",
      changedFileCount: 1,
      changedSymbolPrecision: "file",
    },
  };
}

async function runGraph(args: string[] = []): Promise<{ logOutput: string; errorOutput: string }> {
  const logLines: string[] = [];
  const errorLines: string[] = [];
  const stripAnsi = (value: string) =>
    value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");

  vi.spyOn(console, "log").mockImplementation((...messages: unknown[]) => {
    logLines.push(stripAnsi(messages.map(String).join(" ")));
  });
  vi.spyOn(console, "error").mockImplementation((...messages: unknown[]) => {
    errorLines.push(stripAnsi(messages.map(String).join(" ")));
  });

  await graphCommand.parseAsync(["node", "graph", ...args]);

  return {
    logOutput: logLines.join("\n"),
    errorOutput: errorLines.join("\n"),
  };
}

describe("graphCommand", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ocr-graph-command-test-"));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;

    graphMocks.getGraphStatus.mockResolvedValue(makeStatus());
    graphMocks.buildGraph.mockResolvedValue(makeBuildResult());
    graphMocks.updateGraph.mockResolvedValue(makeBuildResult());
    graphMocks.queryGraph.mockResolvedValue(makeQueryResult("query ok"));
    graphMocks.getImpactRadius.mockResolvedValue(makeQueryResult("impact ok"));
    graphMocks.searchGraph.mockResolvedValue(makeSearchResult({ summary: "search ok" }));
    graphMocks.generateGraphMinimalContext.mockResolvedValue(makeMinimalContext());
    graphMocks.generateGraphReviewAnalysis.mockResolvedValue(makeReviewAnalysis({ summary: "analysis ok" }));
    graphMocks.generateGraphReviewContext.mockResolvedValue(makeReviewContext());
    graphMocks.generateGraphContext.mockResolvedValue({
      version: 1,
      workflow: "map",
      status: "ready",
      graphUpdateStatus: "updated",
      changedFiles: ["src/auth.ts"],
      changedRanges: [],
      unsupportedChangedFiles: [],
      changedSymbolPrecision: "file",
      changedSymbolReason: "range_unavailable",
      changedNodes: [],
      impactedNodes: [],
      impactedFiles: ["src/auth.ts"],
      affectedFlows: [],
      testGaps: [],
      riskScore: 20,
      riskLevel: "low",
      reviewPriorities: [],
      suggestedQuestions: [],
      warnings: [],
      structuredWarnings: [],
    });
    graphMocks.renderGraphContextMarkdown.mockReturnValue("# Graph Context");
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    for (const mock of Object.values(graphMocks)) {
      mock.mockClear();
    }
  });

  it("registers graph subcommands", () => {
    expect(graphCommand.name()).toBe("graph");
    expect(graphCommand.commands.map((command) => command.name())).toEqual([
      "status",
      "build",
      "update",
      "query",
      "impact",
      "context",
      "search",
      "minimal-context",
      "review-analysis",
      "review-context",
    ]);
  });

  it("prints graph status as JSON", async () => {
    const result = await runGraph(["status", "--json"]);

    expect(graphMocks.getGraphStatus).toHaveBeenCalledWith({ repoRoot: tmpDir });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      status: "ready",
      indexedFileCount: 1,
    });
  });

  it("requires explicit full build and forwards build options", async () => {
    const result = await runGraph(["build", "--full", "--json"]);

    expect(graphMocks.buildGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      mode: "full",
      postprocess: "full",
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      filesScanned: 1,
      filesIndexed: 1,
    });
  });

  it("forwards a progress reporter for interactive full builds", async () => {
    await runGraph(["build", "--full"]);

    expect(graphMocks.buildGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: tmpDir,
        mode: "full",
        postprocess: "full",
        onProgress: expect.any(Function),
      }),
    );
  });

  it("forwards incremental update options", async () => {
    await runGraph(["update", "--base", "origin/main", "--staged", "--working-tree", "--json"]);

    expect(graphMocks.updateGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      base: "origin/main",
      staged: true,
      workingTree: true,
      postprocess: "minimal",
    });
  });

  it("forwards explicit graph postprocess levels", async () => {
    await runGraph(["update", "--postprocess", "none", "--json"]);

    expect(graphMocks.updateGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      postprocess: "none",
    });
  });

  it("downgrades full postprocess on large graph updates and reports JSON warning", async () => {
    graphMocks.getGraphStatus.mockResolvedValueOnce({
      ...makeStatus(),
      edgeCount: 50_001,
    });
    graphMocks.updateGraph.mockResolvedValueOnce({
      ...makeBuildResult(),
      postprocess: "minimal",
    });

    const result = await runGraph(["update", "--postprocess", "full", "--json"]);

    expect(graphMocks.updateGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      postprocess: "minimal",
    });
    const parsed = JSON.parse(result.logOutput);
    expect(parsed.postprocessWarnings[0]).toContain("CPU-risk guard");
    expect(parsed.postprocessWarnings[0]).toContain("downgraded update postprocess from full to minimal");
  });

  it("forwards pattern query options", async () => {
    const result = await runGraph([
      "query",
      "callers_of",
      "--target",
      "src/auth.ts#login",
      "--limit",
      "25",
      "--json",
    ]);

    expect(graphMocks.queryGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      query: {
        kind: "pattern",
        pattern: "callers_of",
        target: "src/auth.ts#login",
        limit: 25,
      },
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({ summary: "query ok" });
  });

  it("forwards impact options", async () => {
    const result = await runGraph(["impact", "--files", "src/auth.ts, src/user.ts", "--depth", "3", "--json"]);

    expect(graphMocks.getImpactRadius).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      changedFiles: ["src/auth.ts", "src/user.ts"],
      maxDepth: 3,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({ summary: "impact ok" });
  });

  it("downgrades deep impact traversal on large graphs and reports JSON warning", async () => {
    graphMocks.getGraphStatus.mockResolvedValueOnce({
      ...makeStatus(),
      edgeCount: 50_001,
    });
    graphMocks.getImpactRadius.mockResolvedValueOnce(makeQueryResult("guarded impact"));

    const result = await runGraph(["impact", "--files", "src/auth.ts", "--depth", "8", "--json"]);

    expect(graphMocks.getImpactRadius).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      changedFiles: ["src/auth.ts"],
      maxDepth: 2,
    });
    const parsed = JSON.parse(result.logOutput);
    expect(parsed.warnings[0]).toContain("CPU-risk guard");
    expect(parsed.warnings[0]).toContain("downgraded impact traversal depth from 8 to 2");
  });

  it("forwards context generation options", async () => {
    const result = await runGraph([
      "context",
      "--workflow",
      "map",
      "--base",
      "origin/main",
      "--files",
      "src/auth.ts",
      "--depth",
      "4",
      "--session-dir",
      "/tmp/session",
      "--no-write-artifacts",
      "--json",
    ]);

    expect(graphMocks.generateGraphContext).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      workflow: "map",
      base: "origin/main",
      changedFiles: ["src/auth.ts"],
      maxDepth: 4,
      sessionDir: "/tmp/session",
      update: undefined,
      postprocess: "minimal",
      writeArtifacts: false,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      workflow: "map",
      riskLevel: "low",
    });
  });

  it("forwards explicit context update options", async () => {
    await runGraph([
      "context",
      "--workflow",
      "review",
      "--files",
      "src/auth.ts",
      "--update",
      "--postprocess",
      "full",
      "--json",
    ]);

    expect(graphMocks.generateGraphContext).toHaveBeenCalledWith(expect.objectContaining({
      repoRoot: tmpDir,
      workflow: "review",
      changedFiles: ["src/auth.ts"],
      update: true,
      postprocess: "full",
    }));
  });

  it("forwards graph search options", async () => {
    const result = await runGraph(["search", "auth", "--limit", "15", "--json"]);

    expect(graphMocks.searchGraph).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      query: "auth",
      limit: 15,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      query: "auth",
      summary: "search ok",
    });
  });

  it("forwards minimal context options", async () => {
    const result = await runGraph([
      "minimal-context",
      "--workflow",
      "review",
      "--base",
      "origin/main",
      "--files",
      "src/auth.ts, src/user.ts",
      "--depth",
      "3",
      "--max-priorities",
      "2",
      "--max-warnings",
      "3",
      "--max-suggestions",
      "2",
      "--json",
    ]);

    expect(graphMocks.generateGraphMinimalContext).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      workflow: "review",
      base: "origin/main",
      changedFiles: ["src/auth.ts", "src/user.ts"],
      maxDepth: 3,
      maxPriorities: 2,
      maxWarnings: 3,
      maxSuggestions: 2,
      writeArtifacts: false,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      status: "ready",
      summary: "minimal ok",
    });
  });

  it("prints minimal context suggestions for humans", async () => {
    const result = await runGraph(["minimal-context", "--workflow", "review", "--files", "src/auth.ts"]);

    expect(result.logOutput).toContain("Status: ready");
    expect(result.logOutput).toContain("Risk: medium (0.42)");
    expect(result.logOutput).toContain("Next tool suggestions");
    expect(result.logOutput).toContain("ocr graph query tests_for --target src/auth.ts#login --limit 40");
  });

  it("prints explicit graph search exploration states", async () => {
    graphMocks.searchGraph
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "missing",
          summary: "Graph database missing.",
          warnings: ["Run `ocr graph build --full` to create the graph database."],
          results: [],
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "stale",
          summary: "Graph index is stale relative to the working tree.",
          warnings: ["Run `ocr graph update --working-tree` to refresh the graph."],
          results: [],
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "degraded",
          summary: "Search results may be incomplete because the graph update degraded.",
          warnings: ["Some files could not be indexed during the latest update."],
          truncated: true,
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "error",
          summary: "Graph search failed while reading the index.",
          warnings: ["Retry after rebuilding the graph database."],
          results: [],
        }),
      );

    const missing = await runGraph(["search", "auth"]);
    const stale = await runGraph(["search", "auth"]);
    const degraded = await runGraph(["search", "auth"]);
    const error = await runGraph(["search", "auth"]);

    expect(missing.logOutput).toContain("Status: missing");
    expect(missing.logOutput).toContain("Graph database missing.");
    expect(missing.logOutput).toContain("Warning: Run `ocr graph build --full` to create the graph database.");

    expect(stale.logOutput).toContain("Status: stale");
    expect(stale.logOutput).toContain("Graph index is stale relative to the working tree.");
    expect(stale.logOutput).toContain("Warning: Run `ocr graph update --working-tree` to refresh the graph.");

    expect(degraded.logOutput).toContain("Status: degraded");
    expect(degraded.logOutput).toContain("Search results may be incomplete because the graph update degraded.");
    expect(degraded.logOutput).toContain("Warning: Some files could not be indexed during the latest update.");
    expect(degraded.logOutput).toContain("Result truncated; increase --limit if needed.");

    expect(error.logOutput).toContain("Status: error");
    expect(error.logOutput).toContain("Graph search failed while reading the index.");
    expect(error.logOutput).toContain("Warning: Retry after rebuilding the graph database.");
  });

  it("prints explicit graph search exploration states", async () => {
    graphMocks.searchGraph
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "missing",
          summary: "Graph database missing.",
          warnings: ["Run `ocr graph build --full` to create the graph database."],
          results: [],
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "stale",
          summary: "Graph index is stale relative to the working tree.",
          warnings: ["Run `ocr graph update --working-tree` to refresh the graph."],
          results: [],
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "degraded",
          summary: "Search results may be incomplete because the graph update degraded.",
          warnings: ["Some files could not be indexed during the latest update."],
          truncated: true,
        }),
      )
      .mockResolvedValueOnce(
        makeSearchResult({
          status: "error",
          summary: "Graph search failed while reading the index.",
          warnings: ["Retry after rebuilding the graph database."],
          results: [],
        }),
      );

    const missing = await runGraph(["search", "auth"]);
    const stale = await runGraph(["search", "auth"]);
    const degraded = await runGraph(["search", "auth"]);
    const error = await runGraph(["search", "auth"]);

    expect(missing.logOutput).toContain("Status: missing");
    expect(missing.logOutput).toContain("Graph database missing.");
    expect(missing.logOutput).toContain("Warning: Run `ocr graph build --full` to create the graph database.");

    expect(stale.logOutput).toContain("Status: stale");
    expect(stale.logOutput).toContain("Graph index is stale relative to the working tree.");
    expect(stale.logOutput).toContain("Warning: Run `ocr graph update --working-tree` to refresh the graph.");

    expect(degraded.logOutput).toContain("Status: degraded");
    expect(degraded.logOutput).toContain("Search results may be incomplete because the graph update degraded.");
    expect(degraded.logOutput).toContain("Warning: Some files could not be indexed during the latest update.");
    expect(degraded.logOutput).toContain("Result truncated; increase --limit if needed.");

    expect(error.logOutput).toContain("Status: error");
    expect(error.logOutput).toContain("Graph search failed while reading the index.");
    expect(error.logOutput).toContain("Warning: Retry after rebuilding the graph database.");
  });

  it("surfaces search execution failures as command errors", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    graphMocks.searchGraph.mockRejectedValueOnce(new Error("search backend exploded"));

    await expect(runGraph(["search", "auth"])).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Error: search backend exploded"));
  });

  it("surfaces review-analysis execution failures as command errors", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    graphMocks.generateGraphReviewAnalysis.mockRejectedValueOnce(new Error("review analysis exploded"));

    await expect(runGraph(["review-analysis", "--workflow", "review"])).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Error: review analysis exploded"));
  });

  it("forwards graph review analysis options", async () => {
    const result = await runGraph([
      "review-analysis",
      "--workflow",
      "review",
      "--base",
      "origin/main",
      "--files",
      "src/auth.ts, src/user.ts",
      "--depth",
      "4",
      "--max-nodes",
      "120",
      "--max-files",
      "12",
      "--max-hints",
      "5",
      "--max-modules",
      "3",
      "--session-dir",
      "/tmp/session",
      "--no-write-artifacts",
      "--json",
    ]);

    expect(graphMocks.generateGraphReviewAnalysis).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      workflow: "review",
      base: "origin/main",
      changedFiles: ["src/auth.ts", "src/user.ts"],
      maxDepth: 4,
      maxNodes: 120,
      maxFiles: 12,
      maxHints: 5,
      maxModules: 3,
      sessionDir: "/tmp/session",
      writeArtifacts: false,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      status: "ready",
      summary: "analysis ok",
      sourceScope: {
        workflow: "review",
      },
    });
  });

  it("reports CPU-risk warnings for expensive review-analysis options on large graphs", async () => {
    graphMocks.getGraphStatus.mockResolvedValueOnce({
      ...makeStatus(),
      edgeCount: 50_001,
    });

    const result = await runGraph([
      "review-analysis",
      "--workflow",
      "review",
      "--files",
      "src/auth.ts",
      "--depth",
      "8",
      "--max-modules",
      "3",
      "--json",
    ]);

    expect(graphMocks.generateGraphReviewAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      maxDepth: 2,
      maxModules: 3,
    }));
    const parsed = JSON.parse(result.logOutput);
    expect(parsed.warnings.some((warning: string) => warning.includes("downgraded review-analysis traversal depth from 8 to 2"))).toBe(true);
    expect(parsed.warnings.some((warning: string) => warning.includes("module summaries were requested"))).toBe(true);
  });

  it("forwards graph review-context options", async () => {
    const result = await runGraph([
      "review-context",
      "--workflow",
      "review",
      "--base",
      "origin/main",
      "--files",
      "src/auth.ts, src/user.ts",
      "--depth",
      "3",
      "--max-files",
      "2",
      "--max-snippets",
      "5",
      "--max-lines-per-snippet",
      "20",
      "--max-chars",
      "5000",
      "--max-suggestions",
      "2",
      "--json",
    ]);

    expect(graphMocks.generateGraphReviewContext).toHaveBeenCalledWith({
      repoRoot: tmpDir,
      workflow: "review",
      base: "origin/main",
      changedFiles: ["src/auth.ts", "src/user.ts"],
      maxDepth: 3,
      maxFiles: 2,
      maxSnippets: 5,
      maxLinesPerSnippet: 20,
      maxChars: 5000,
      maxSuggestions: 2,
      writeArtifacts: false,
    });
    expect(JSON.parse(result.logOutput)).toMatchObject({
      status: "ready",
      summary: "review context ok",
    });
  });

  it("prints graph review-context snippets for humans", async () => {
    const result = await runGraph(["review-context", "--workflow", "review", "--files", "src/auth.ts"]);

    expect(result.logOutput).toContain("Status: ready");
    expect(result.logOutput).toContain("Graph snippets are investigation context");
    expect(result.logOutput).toContain("[changed_symbol] src/auth.ts:10-12");
    expect(result.logOutput).toContain("export function login()");
    expect(result.logOutput).toContain("Next tool suggestions");
  });
});
