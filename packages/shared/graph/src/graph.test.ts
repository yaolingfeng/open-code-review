import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGraph,
  generateGraphContext,
  generateGraphMinimalContext,
  generateGraphReviewAnalysis,
  generateGraphReviewContext,
  getGraphStatus,
  getImpactRadius,
  isGraphReviewAnalysis,
  parseUnifiedDiffRanges,
  queryGraph,
  renderGraphContextMarkdown,
  searchGraph,
  updateGraph,
} from "./index.js";
import { GraphStore } from "./storage/db.js";

const tempRoots: string[] = [];

function makeRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "ocr-graph-"));
  tempRoots.push(repoRoot);
  return repoRoot;
}

function write(repoRoot: string, filePath: string, content: string): void {
  const path = join(repoRoot, filePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function initGitRepo(repoRoot: string): void {
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@ocr.dev"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "OCR Test"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoRoot, stdio: "ignore" });
}

function commitAll(repoRoot: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd: repoRoot, stdio: "ignore" });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("graph engine", () => {
  it("parses unified diff hunks into merged changed ranges", () => {
    const ranges = parseUnifiedDiffRanges([
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -2 +2 @@",
      "@@ -8,0 +9,2 @@",
      "diff --git a/src/ignored.ts b/src/ignored.ts",
      "--- a/src/ignored.ts",
      "+++ b/src/ignored.ts",
      "@@ -1 +1 @@",
      "diff --git a/src/auth.ts b/src/auth.ts",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -10 +11 @@",
    ].join("\n"), ["src/auth.ts"]);

    expect(ranges).toEqual([
      { filePath: "src/auth.ts", lineStart: 2, lineEnd: 2 },
      { filePath: "src/auth.ts", lineStart: 9, lineEnd: 11 },
    ]);
  });

  it("indexes the first supported language set and Node.js resolver signals", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/tool.py", [
      "import os",
      "class Tool:",
      "    def run(self):",
      "        return helper()",
      "",
      "def helper():",
      "    return os.getcwd()",
    ].join("\n"));
    write(repoRoot, "src/node-service.cjs", [
      "const fs = require('node:fs')",
      "function readConfig() {",
      "  return fs.readFileSync('config.json', 'utf8')",
      "}",
      "exports.readConfig = readConfig",
    ].join("\n"));
    write(repoRoot, "src/model.ts", [
      "import { readConfig } from './node-service.cjs'",
      "export interface User { id: string }",
      "export function mapUser(user: User) {",
      "  return readConfig() + user.id",
      "}",
    ].join("\n"));
    write(repoRoot, "cmd/app.go", [
      "package main",
      "import \"fmt\"",
      "type User struct { ID string }",
      "func Run() {",
      "  fmt.Println(\"ok\")",
      "}",
    ].join("\n"));
    write(repoRoot, "src/UserService.java", [
      "import java.util.List;",
      "class UserService implements Runnable {",
      "  public void run() {",
      "    findUser();",
      "  }",
      "  public String findUser() { return \"ok\"; }",
      "}",
    ].join("\n"));
    write(repoRoot, "src/UserCard.vue", [
      "<template><div>{{ name }}</div></template>",
      "<script lang=\"ts\">",
      "export function renderUser(name: string) {",
      "  return name.toUpperCase()",
      "}",
      "</script>",
    ].join("\n"));
    write(repoRoot, "db/schema.sql", [
      "CREATE TABLE users (id text primary key);",
      "CREATE VIEW active_users AS SELECT id FROM users;",
    ].join("\n"));

    const result = await buildGraph({ repoRoot, mode: "full" });

    expect(result.status).toBe("ready");
    expect(result.filesIndexed).toBe(7);
    expect(result.languages).toEqual(["go", "java", "javascript", "python", "sql", "typescript", "vue"]);

    const summaries = await Promise.all([
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "src/tool.py" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "src/node-service.cjs" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "src/model.ts" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "cmd/app.go" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "src/UserService.java" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "src/UserCard.vue" } }),
      queryGraph({ repoRoot, query: { kind: "pattern", pattern: "file_summary", target: "db/schema.sql" } }),
    ]);

    for (const summary of summaries) {
      expect(summary.status).toBe("ready");
    }
    expect(summaries[0]?.nodes?.some((node) => node.name === "helper")).toBe(true);
    expect(summaries[1]?.edges?.some((edge) => edge.kind === "IMPORTS_FROM" && edge.targetQualified === "node:fs" && edge.metadata?.["builtin"] === true)).toBe(true);
    expect(summaries[1]?.edges?.some((edge) => edge.kind === "REFERENCES" && edge.targetQualified === "exports.readConfig")).toBe(true);
    expect(summaries[2]?.nodes?.some((node) => node.kind === "Type" && node.name === "User")).toBe(true);
    expect(summaries[3]?.nodes?.some((node) => node.name === "Run")).toBe(true);
    expect(summaries[4]?.edges?.some((edge) => edge.kind === "IMPLEMENTS" && edge.targetQualified === "Runnable")).toBe(true);
    expect(summaries[5]?.nodes?.some((node) => node.name === "renderUser" && node.language === "vue")).toBe(true);
    expect(summaries[6]?.nodes?.some((node) => node.kind === "Type" && node.name === "users")).toBe(true);
  });

  it("builds a graph and supports file summary queries", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/auth.ts", [
      "import { readFileSync } from 'node:fs'",
      "export function validateToken(token: string) {",
      "  readFileSync('/tmp/token')",
      "  return token.length > 0",
      "}",
      "",
      "export function handleAuth(token: string) {",
      "  return validateToken(token)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/auth.test.ts", [
      "import { describe, it } from 'vitest'",
      "import { validateToken } from './auth'",
      "it('validates token', () => {",
      "  validateToken('ok')",
      "})",
    ].join("\n"));
    write(repoRoot, "README.md", "# Unsupported for graph parsing\n");

    const result = await buildGraph({ repoRoot, mode: "full" });

    expect(result.status).toBe("ready");
    expect(result.filesIndexed).toBe(2);
    expect(result.filesUnsupported).toBe(1);
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);

    const summary = await queryGraph({
      repoRoot,
      query: { kind: "pattern", pattern: "file_summary", target: "src/auth.ts" },
    });

    expect(summary.status).toBe("ready");
    expect(summary.nodes?.some((node) => node.name === "validateToken")).toBe(true);
    expect(summary.edges?.some((edge) => edge.kind === "IMPORTS_FROM")).toBe(true);
  });

  it("resolves Node.js package.json main, exports, and imports into dependency edges", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "package.json", JSON.stringify({
      name: "@scope/demo",
      main: "./src/main.ts",
      exports: {
        ".": "./src/main.ts",
        "./feature": {
          import: "./src/feature.ts",
          default: "./src/feature-fallback.ts",
        },
        "./utils/*": "./src/utils/*.ts",
      },
      imports: {
        "#internal": "./src/internal.ts",
      },
    }));
    write(repoRoot, "src/app.ts", [
      "import { main } from '@scope/demo'",
      "import { feature } from '@scope/demo/feature'",
      "import { helper } from '@scope/demo/utils/helper'",
      "import { internal } from '#internal'",
      "export function app() {",
      "  return main() + feature() + helper() + internal()",
      "}",
    ].join("\n"));
    write(repoRoot, "src/main.ts", "export function main() { return 'main' }\n");
    write(repoRoot, "src/feature.ts", "export function feature() { return 'feature' }\n");
    write(repoRoot, "src/feature-fallback.ts", "export function fallback() { return 'fallback' }\n");
    write(repoRoot, "src/utils/helper.ts", "export function helper() { return 'helper' }\n");
    write(repoRoot, "src/internal.ts", "export function internal() { return 'internal' }\n");

    await buildGraph({ repoRoot, mode: "full" });

    const summary = await queryGraph({
      repoRoot,
      query: { kind: "pattern", pattern: "file_summary", target: "src/app.ts" },
    });

    const resolvedTargets = new Set(
      summary.edges
        ?.filter((edge) => edge.kind === "DEPENDS_ON" && edge.metadata?.["resolver"] === "nodejs")
        .map((edge) => edge.targetQualified),
    );
    expect(resolvedTargets).toEqual(new Set([
      "src/feature.ts",
      "src/internal.ts",
      "src/main.ts",
      "src/utils/helper.ts",
    ]));
  });

  it("detects lightweight flows and includes affected flows in graph context", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "import { readUser } from '../db/user'",
      "",
      "export function getUser(id: string) {",
      "  return readUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/db/user.ts", [
      "export function readUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const context = await generateGraphContext({
      repoRoot,
      workflow: "map",
      changedFiles: ["src/service/user.ts"],
      writeArtifacts: false,
    });

    expect(context.affectedFlows.some((flow) => flow.name === "userHandler (src/api/user.ts)")).toBe(true);
    const userFlow = context.affectedFlows.find((flow) => flow.name === "userHandler (src/api/user.ts)");
    expect(userFlow?.files).toEqual(["src/api/user.ts", "src/db/user.ts", "src/service/user.ts"]);
    expect(userFlow?.criticality).toBeGreaterThan(0.5);
    expect(context.testGaps.some((gap) => gap.kind === "no_test_edge_for_changed_function")).toBe(true);
    expect(context.testGaps.some((gap) => gap.kind === "changed_flow_entry_without_test")).toBe(false);
    expect(context.riskScore).toBeGreaterThan(0);

    const markdownContext = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service/user.ts"],
      sessionDir: join(repoRoot, ".ocr", "sessions", "flow-session"),
    });
    expect(markdownContext.affectedFlows.length).toBeGreaterThan(0);
    expect(markdownContext.changedSymbolPrecision).toBe("file");
    expect(existsSync(join(repoRoot, ".ocr", "sessions", "flow-session", "graph-context.md"))).toBe(true);
  });

  it("updates changed files incrementally and writes graph context artifacts", async () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    write(repoRoot, "src/service.py", [
      "def helper():",
      "    return 1",
      "",
      "def run():",
      "    return helper()",
    ].join("\n"));
    commitAll(repoRoot, "add baseline service");

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/service.py", [
      "def helper():",
      "    return 2",
      "",
      "def run():",
      "    return helper()",
    ].join("\n"));

    const update = await updateGraph({ repoRoot, changedFiles: ["src/service.py"] });
    expect(update.filesIndexed).toBe(1);

    const impact = await getImpactRadius({
      repoRoot,
      changedFiles: ["src/service.py"],
      maxDepth: 2,
    });
    expect(impact.status).toBe("ready");
    expect(impact.files).toContain("src/service.py");

    const sessionDir = join(repoRoot, ".ocr", "sessions", "test-session");
    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      sessionDir,
      base: "HEAD",
      changedFiles: ["src/service.py", "docs/notes.md"],
      update: true,
    });

    expect(context.status).toBe("ready");
    expect(context.unsupportedChangedFiles).toEqual(["docs/notes.md"]);
    expect(context.changedRanges).toEqual([
      { filePath: "src/service.py", lineStart: 2, lineEnd: 2 },
    ]);
    expect(context.changedSymbolPrecision).toBe("symbol");
    expect(context.changedSymbolReason).toBe("exact_overlap");
    expect(context.changedNodes.some((node) => node.name === "helper")).toBe(true);
    expect(context.changedNodes.some((node) => node.name === "run")).toBe(false);
    expect(existsSync(join(sessionDir, "graph-context.md"))).toBe(true);
    expect(existsSync(join(sessionDir, "graph-context.json"))).toBe(true);

    const status = await getGraphStatus({ repoRoot });
    expect(status.status).toBe("ready");
  });

  it("does not update graph or rebuild derived tables while generating graph context by default", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.ts", "export function run() { return true }\n");
    await buildGraph({ repoRoot, mode: "full" });

    const originalRebuildSearchIndex = GraphStore.prototype.rebuildSearchIndex;
    const originalReplaceFlows = GraphStore.prototype.replaceFlows;
    const rebuildSearchIndex = vi.spyOn(GraphStore.prototype, "rebuildSearchIndex").mockImplementation(function (this: GraphStore) {
      return originalRebuildSearchIndex.call(this);
    });
    const replaceFlows = vi.spyOn(GraphStore.prototype, "replaceFlows").mockImplementation(function (
      this: GraphStore,
      flows,
    ) {
      return originalReplaceFlows.call(this, flows);
    });

    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.ts"],
      writeArtifacts: false,
    });

    expect(context.graphUpdateStatus).toBe("noop");
    expect(context.warnings).toContain("Graph context is read-only; run `ocr graph update` or `ocr graph build --full` to refresh stale graph data.");
    expect(rebuildSearchIndex).not.toHaveBeenCalled();
    expect(replaceFlows).not.toHaveBeenCalled();
  });

  it("falls back to file-level changed nodes when git diff ranges are unavailable", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.py", [
      "def helper():",
      "    return 1",
      "",
      "def run():",
      "    return helper()",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/service.py", [
      "def helper():",
      "    return 2",
      "",
      "def run():",
      "    return helper()",
      "",
      "def new_feature():",
      "    return run()",
    ].join("\n"));
    await updateGraph({ repoRoot, changedFiles: ["src/service.py"] });

    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.py"],
      writeArtifacts: false,
    });

    expect(context.changedRanges).toEqual([]);
    expect(context.changedSymbolPrecision).toBe("file");
    expect(context.changedSymbolReason).toBe("range_unavailable");
    expect(context.structuredWarnings.some((warning) => warning.code === "git_diff_ranges_unavailable")).toBe(true);
    expect(context.warnings).toContain(
      "Changed line ranges unavailable; graph context fell back to file-level changed nodes.",
    );
    expect(context.changedNodes.some((node) => node.name === "helper")).toBe(true);
    expect(context.changedNodes.some((node) => node.name === "run")).toBe(true);
    expect(context.changedNodes.some((node) => node.name === "new_feature")).toBe(true);
  });

  it("pins review-analysis module grouping heuristics and explainable hints", async () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    write(repoRoot, "src/api/orders.ts", [
      "import { createInvoice } from '../billing/invoice'",
      "import { saveOrder } from '../orders/repository'",
      "",
      "export function orderHandler(orderId: string) {",
      "  return saveOrder(createInvoice(orderId))",
      "}",
    ].join("\n"));
    write(repoRoot, "src/billing/invoice.ts", [
      "import { saveOrder } from '../orders/repository'",
      "import { renderSummary } from '../shared/format'",
      "",
      "export function createInvoice(orderId: string) {",
      "  return renderSummary(saveOrder(orderId))",
      "}",
    ].join("\n"));
    write(repoRoot, "src/orders/repository.ts", [
      "import { renderSummary } from '../shared/format'",
      "",
      "export function saveOrder(orderId: string) {",
      "  return renderSummary(orderId)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/shared/format.ts", [
      "export function renderSummary(value: string) {",
      "  return `summary:${value}`",
      "}",
    ].join("\n"));
    write(repoRoot, "src/isolated/note.ts", [
      "export function annotate(note: string) {",
      "  return note.trim()",
      "}",
    ].join("\n"));
    commitAll(repoRoot, "add review analysis fixtures");

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/billing/invoice.ts", [
      "import { saveOrder } from '../orders/repository'",
      "import { renderSummary } from '../shared/format'",
      "",
      "export function createInvoice(orderId: string) {",
      "  return renderSummary(saveOrder(`${orderId}:updated`))",
      "}",
    ].join("\n"));
    write(repoRoot, "src/orders/repository.ts", [
      "import { renderSummary } from '../shared/format'",
      "",
      "export function saveOrder(orderId: string) {",
      "  return renderSummary(`${orderId}:persisted`)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/isolated/note.ts", [
      "export function annotate(note: string) {",
      "  return `${note.trim()}!`",
      "}",
    ].join("\n"));

    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: [
        "src/billing/invoice.ts",
        "src/orders/repository.ts",
        "src/isolated/note.ts",
      ],
      base: "HEAD",
      maxHints: 5,
      maxModules: 2,
      writeArtifacts: false,
    });

    expect(isGraphReviewAnalysis(analysis)).toBe(true);
    expect(analysis.modules).toHaveLength(2);
    expect(analysis.truncated).toBe(true);
    expect(analysis.modules.map((module) => module.name)).toEqual(["src/billing", "src/isolated"]);

    const billingModule = analysis.modules[0];
    expect(billingModule).toMatchObject({
      name: "src/billing",
      changedFiles: ["src/billing/invoice.ts"],
      impactedFiles: ["src/billing/invoice.ts"],
      changedSymbolCount: 1,
      impactedSymbolCount: 1,
      crossModuleEdgeCount: 4,
      bridgeFiles: ["src/billing/invoice.ts"],
      bridgeQualifiedNames: ["src/billing/invoice.ts", "src/billing/invoice.ts::createInvoice"],
    });

    const isolatedModule = analysis.modules[1];
    expect(isolatedModule).toMatchObject({
      name: "src/isolated",
      changedFiles: ["src/isolated/note.ts"],
      impactedFiles: ["src/isolated/note.ts"],
      changedSymbolCount: 1,
      impactedSymbolCount: 1,
      crossModuleEdgeCount: 0,
      bridgeFiles: [],
      bridgeQualifiedNames: [],
    });

    expect(analysis.hints).toHaveLength(4);
    expect(analysis.hints.map((hint) => hint.kind)).toEqual([
      "review_order",
      "coupling_hotspot",
      "test_gap",
      "test_gap",
    ]);
    expect(analysis.hints[0]).toMatchObject({
      kind: "review_order",
      severity: "info",
      filePaths: ["src/billing/invoice.ts"],
      qualifiedNames: ["src/billing/invoice.ts::createInvoice"],
    });
    expect(analysis.hints[0]?.message).toContain("Start review with src/billing/invoice.ts::createInvoice");
    expect(analysis.hints[1]).toMatchObject({
      kind: "coupling_hotspot",
      severity: "warning",
      filePaths: ["src/billing/invoice.ts"],
      qualifiedNames: ["src/billing/invoice.ts", "src/billing/invoice.ts::createInvoice"],
    });
    expect(analysis.hints[1]?.message).toContain("src/billing shows 4 cross-module edges");
    expect(analysis.hints[2]).toMatchObject({
      kind: "test_gap",
      severity: "high",
      filePaths: ["src/billing/invoice.ts"],
      qualifiedNames: ["src/billing/invoice.ts::createInvoice"],
    });
    expect(analysis.hints[2]?.message).toContain("no_test_edge_for_changed_function");
    expect(analysis.hints[3]).toMatchObject({
      kind: "test_gap",
      severity: "high",
      filePaths: ["src/orders/repository.ts"],
      qualifiedNames: ["src/orders/repository.ts::saveOrder"],
    });
  });

  it("emits each explainable review-analysis hint branch with representative fields", async () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    write(repoRoot, "src/api/entry.ts", [
      "import { stepOne } from '../feature/step-one'",
      "import { stepTwo } from '../feature/step-two'",
      "",
      "export function entryHandler(input: string) {",
      "  return stepTwo(stepOne(input))",
      "}",
    ].join("\n"));
    write(repoRoot, "src/feature/step-one.ts", [
      "import { helper } from '../shared/helper'",
      "",
      "export function stepOne(input: string) {",
      "  return helper(input)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/feature/step-two.ts", [
      "import { helper } from '../shared/helper'",
      "",
      "export function stepTwo(input: string) {",
      "  return helper(input)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/shared/helper.ts", [
      "export function helper(input: string) {",
      "  return input.toUpperCase()",
      "}",
    ].join("\n"));
    write(repoRoot, "src/docs/notes.ts", [
      "export function draftNote(text: string) {",
      "  return text.trim()",
      "}",
    ].join("\n"));
    commitAll(repoRoot, "add explainable hint fixtures");

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/api/entry.ts", [
      "import { stepOne } from '../feature/step-one'",
      "import { stepTwo } from '../feature/step-two'",
      "",
      "export function entryHandler(input: string) {",
      "  return `${stepTwo(stepOne(input))}:changed`",
      "}",
    ].join("\n"));
    write(repoRoot, "src/feature/step-one.ts", [
      "import { helper } from '../shared/helper'",
      "",
      "export function stepOne(input: string) {",
      "  return helper(`${input}:one`)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/feature/step-two.ts", [
      "import { helper } from '../shared/helper'",
      "",
      "export function stepTwo(input: string) {",
      "  return helper(`${input}:two`)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/docs/notes.md", [
      "# Notes",
      "",
      "updated review context",
    ].join("\n"));

    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: [
        "src/api/entry.ts",
        "src/feature/step-one.ts",
        "src/feature/step-two.ts",
        "src/docs/notes.md",
      ],
      base: "HEAD",
      maxHints: 8,
      maxModules: 6,
      writeArtifacts: false,
    });

    const reviewOrder = analysis.hints.find((hint) => hint.kind === "review_order");
    expect(reviewOrder).toMatchObject({
      kind: "review_order",
      severity: "info",
      filePaths: ["src/api/entry.ts"],
      qualifiedNames: ["src/api/entry.ts::entryHandler"],
    });
    expect(reviewOrder?.message).toContain("Start review with src/api/entry.ts::entryHandler");

    const boundaryCrossing = analysis.hints.find((hint) => hint.kind === "boundary_crossing");
    expect(boundaryCrossing).toMatchObject({
      kind: "boundary_crossing",
      severity: "warning",
      filePaths: ["src/api/entry.ts"],
      qualifiedNames: ["src/api/entry.ts::entryHandler"],
    });
    expect(boundaryCrossing?.message).toContain("flow entry inside the impact radius");

    const couplingHotspot = analysis.hints.find((hint) => hint.kind === "coupling_hotspot");
    expect(couplingHotspot).toMatchObject({
      kind: "coupling_hotspot",
      severity: "warning",
    });
    expect(couplingHotspot?.filePaths?.length).toBeGreaterThan(0);
    expect(couplingHotspot?.qualifiedNames?.length).toBeGreaterThan(0);
    expect(couplingHotspot?.message).toContain("cross-module edges");

    const weaklyConnected = analysis.hints.find((hint) => hint.kind === "weakly_connected_change");
    expect(weaklyConnected).toMatchObject({
      kind: "weakly_connected_change",
      severity: "info",
      filePaths: ["src/docs/notes.md"],
    });
    expect(weaklyConnected?.qualifiedNames).toBeUndefined();
    expect(weaklyConnected?.message).toContain("manual review context");

    const testGap = analysis.hints.find((hint) => hint.kind === "test_gap");
    expect(testGap).toMatchObject({
      kind: "test_gap",
      severity: "high",
      filePaths: ["src/api/entry.ts"],
      qualifiedNames: ["src/api/entry.ts::entryHandler"],
    });
    expect(testGap?.message).toContain("no_test_edge_for_changed_function");
  });

  it("validates populated, degraded, and malformed review-analysis payloads", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/auth.ts", [
      "export function validateToken(token: string) {",
      "  return token.length > 0",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    const valid = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/auth.ts"],
      writeArtifacts: false,
    });
    expect(isGraphReviewAnalysis(valid)).toBe(true);

    const missing = await generateGraphReviewAnalysis({
      repoRoot: makeRepo(),
      workflow: "map",
      changedFiles: ["src/missing.ts"],
      writeArtifacts: false,
    });
    expect(missing.status).toBe("missing");
    expect(isGraphReviewAnalysis(missing)).toBe(true);

    const invalidHintKind = {
      ...valid,
      hints: valid.hints.length > 0
        ? [{ ...valid.hints[0], kind: "bad_hint" }, ...valid.hints.slice(1)]
        : [{ kind: "bad_hint", severity: "info", message: "bad" }],
    };
    expect(isGraphReviewAnalysis(invalidHintKind)).toBe(false);

    const invalidNestedSeverity = {
      ...valid,
      drilldown: {
        ...valid.drilldown,
        testGaps: valid.drilldown.testGaps.length > 0
          ? [{ ...valid.drilldown.testGaps[0], severity: "urgent" }, ...valid.drilldown.testGaps.slice(1)]
          : [{
            qualifiedName: "validateToken",
            filePath: "src/auth.ts",
            lineStart: 1,
            kind: "no_test_edge_for_changed_function",
            severity: "urgent",
            reason: "invalid",
          }],
      },
    };
    expect(isGraphReviewAnalysis(invalidNestedSeverity)).toBe(false);

    const invalidWorkflow = {
      ...valid,
      sourceScope: {
        ...valid.sourceScope,
        workflow: "ship",
      },
    };
    expect(isGraphReviewAnalysis(invalidWorkflow)).toBe(false);

    const missingNestedField = {
      ...valid,
      modules: valid.modules.length > 0
        ? valid.modules.map((module, index) => {
          if (index !== 0) return module;
          const { summary: _summary, ...rest } = module;
          return rest;
        })
        : [
          {
            name: "src/auth",
            changedFiles: ["src/auth.ts"],
            impactedFiles: ["src/auth.ts"],
            changedSymbolCount: 1,
            impactedSymbolCount: 1,
            crossModuleEdgeCount: 0,
            bridgeFiles: [],
            bridgeQualifiedNames: [],
          },
        ],
    };
    expect(isGraphReviewAnalysis(missingNestedField)).toBe(false);
  });

  it("classifies changed flow entries without test coverage", async () => {
    const repoRoot = makeRepo();
    initGitRepo(repoRoot);
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));
    commitAll(repoRoot, "add user flow");

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id).id",
      "}",
    ].join("\n"));

    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      base: "HEAD",
      writeArtifacts: false,
    });

    expect(context.changedSymbolPrecision).toBe("symbol");
    expect(context.testGaps.some((gap) => gap.kind === "changed_flow_entry_without_test")).toBe(true);
    expect(context.testGaps.some((gap) => gap.kind === "no_test_edge_for_changed_function")).toBe(true);
  });

  it("classifies changed files without graph-linked tests during file fallback", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/orphan.ts", [
      "export function alpha() {",
      "  return 1",
      "}",
      "",
      "export function beta() {",
      "  return alpha()",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/orphan.ts", [
      "export function alpha() {",
      "  return 2",
      "}",
      "",
      "export function beta() {",
      "  return alpha()",
      "}",
      "",
      "export function gamma() {",
      "  return beta()",
      "}",
    ].join("\n"));
    await updateGraph({ repoRoot, changedFiles: ["src/orphan.ts"] });

    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/orphan.ts"],
      writeArtifacts: false,
    });

    expect(context.changedSymbolPrecision).toBe("file");
    expect(context.testGaps.some((gap) => gap.kind === "changed_testless_file" && gap.severity === "low")).toBe(true);
  });

  it("records structured warnings and markdown summaries", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.py", [
      "def helper():",
      "    return 1",
      "",
      "def run():",
      "    return helper()",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.py"],
      writeArtifacts: false,
    });
    const markdown = renderGraphContextMarkdown(context);

    expect(context.structuredWarnings.some((warning) => warning.code === "git_diff_ranges_unavailable")).toBe(true);
    expect(markdown).toContain("Changed symbol precision: file (range_unavailable)");
    expect(markdown).toContain("[git_diff_ranges_unavailable]");
    expect(markdown).toContain("no_test_edge_for_changed_function [high]");
  });
  it("removes graph data for deleted files during incremental update", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/deleted.ts", [
      "export function removed() {",
      "  return true",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    rmSync(join(repoRoot, "src/deleted.ts"));

    const update = await updateGraph({ repoRoot, changedFiles: ["src/deleted.ts"] });
    expect(update.filesScanned).toBe(1);
    expect(update.filesIndexed).toBe(0);

    const summary = await queryGraph({
      repoRoot,
      query: { kind: "pattern", pattern: "file_summary", target: "src/deleted.ts" },
    });
    expect(summary.status).toBe("ready");
  });

  it("searches graph nodes and files with bounded results", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/auth.ts", [
      "export function validateToken(token: string) {",
      "  return token.length > 0",
      "}",
      "",
      "export function handleAuth(token: string) {",
      "  return validateToken(token)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/auth.test.ts", [
      "import { validateToken } from './auth'",
      "export function testValidateToken() {",
      "  return validateToken('ok')",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const byName = await searchGraph({ repoRoot, query: "validateToken", limit: 5 });
    expect(byName.status).toBe("ready");
    expect(byName.results.some((result) => result.entityType === "node" && result.name === "validateToken")).toBe(true);
    expect(byName.results.some((result) => result.matchTypes.includes("name"))).toBe(true);

    const byFile = await searchGraph({ repoRoot, query: "src/auth", limit: 5 });
    expect(byFile.results.some((result) => result.filePath === "src/auth.ts")).toBe(true);
    expect(byFile.results.some((result) => result.matchTypes.includes("file_path"))).toBe(true);

    const limited = await searchGraph({ repoRoot, query: "auth", limit: 1 });
    expect(limited.limit).toBe(1);
    expect(limited.results).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it("keeps search data consistent across full build and incremental updates", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/auth.ts", [
      "export function validateToken(token: string) {",
      "  return token.length > 0",
      "}",
    ].join("\n"));
    write(repoRoot, "src/legacy.ts", [
      "export function legacyAuth() {",
      "  return validateLegacy('legacy')",
      "}",
      "",
      "function validateLegacy(token: string) {",
      "  return token.length > 0",
      "}",
    ].join("\n"));

    const build = await buildGraph({ repoRoot, mode: "full" });
    expect(build.status).toBe("ready");

    const initialName = await searchGraph({ repoRoot, query: "validateToken", limit: 10 });
    expect(initialName.results.some((result) => result.name === "validateToken" && result.filePath === "src/auth.ts")).toBe(true);

    const initialFile = await searchGraph({ repoRoot, query: "legacy.ts", limit: 10 });
    expect(initialFile.results.some((result) => result.qualifiedName === "src/legacy.ts")).toBe(true);

    write(repoRoot, "src/auth.ts", [
      "export function verifySession(sessionId: string) {",
      "  return sessionId.length > 0",
      "}",
    ].join("\n"));
    rmSync(join(repoRoot, "src/legacy.ts"));

    const update = await updateGraph({ repoRoot, changedFiles: ["src/auth.ts", "src/legacy.ts"] });
    expect(update.status).toBe("ready");
    expect(update.filesScanned).toBe(2);
    expect(update.filesIndexed).toBe(1);

    const removedName = await searchGraph({ repoRoot, query: "validateToken", limit: 10 });
    expect(removedName.results.some((result) => result.name === "validateToken")).toBe(false);

    const newName = await searchGraph({ repoRoot, query: "verifySession", limit: 10 });
    expect(newName.results.some((result) => result.name === "verifySession" && result.filePath === "src/auth.ts")).toBe(true);

    const deletedFile = await searchGraph({ repoRoot, query: "legacy.ts", limit: 10 });
    expect(deletedFile.results.some((result) => result.filePath === "src/legacy.ts" || result.qualifiedName === "src/legacy.ts")).toBe(false);
  });

  it("maintains search index incrementally during graph updates", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/auth.ts", "export function validateToken() { return true }\n");

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/auth.ts", "export function verifySession() { return true }\n");

    const rebuildSearchIndex = vi.spyOn(GraphStore.prototype, "rebuildSearchIndex");
    const rebuildSearchIndexForFiles = vi.spyOn(GraphStore.prototype, "rebuildSearchIndexForFiles");

    const update = await updateGraph({ repoRoot, changedFiles: ["src/auth.ts"] });

    expect(update.postprocess).toBe("minimal");
    expect(update.postprocessRan).toBe(true);
    expect(rebuildSearchIndex).not.toHaveBeenCalled();
    expect(rebuildSearchIndexForFiles).toHaveBeenCalledWith(["src/auth.ts"]);

    const search = await searchGraph({ repoRoot, query: "verifySession", limit: 5 });
    expect(search.results.some((result) => result.name === "verifySession")).toBe(true);
  });

  it("skips full flow rebuild for large incremental graph updates and marks flows stale", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "export function userHandler() {",
      "  return true",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    write(repoRoot, "src/api/user.ts", [
      "export function userHandler() {",
      "  return false",
      "}",
    ].join("\n"));

    const edgeCount = vi.spyOn(GraphStore.prototype, "edgeCount").mockReturnValue(50_001);
    const replaceFlows = vi.spyOn(GraphStore.prototype, "replaceFlows");
    const replaceFlowsForFiles = vi.spyOn(GraphStore.prototype, "replaceFlowsForFiles");

    const update = await updateGraph({ repoRoot, changedFiles: ["src/api/user.ts"], postprocess: "full" });

    expect(update.postprocessRan).toBe(true);
    expect(update.postprocessWarnings?.[0]).toContain("Skipping incremental flow rebuild for large graph");
    expect(replaceFlows).not.toHaveBeenCalled();
    expect(replaceFlowsForFiles).not.toHaveBeenCalled();
    expect(edgeCount).toHaveBeenCalled();

    const store = await GraphStore.open(repoRoot);
    try {
      expect(store.getMetadata("flows_status")).toBe("stale");
      expect(store.getMetadata("flows_stale_reason")).toContain("Skipping incremental flow rebuild");
    } finally {
      store.close();
    }
  });

  it("reports degraded status when some files fail to index", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/ok.ts", "export function ok() { return true }\n");

    await buildGraph({ repoRoot, mode: "full" });
    const degradedStore = await GraphStore.open(repoRoot);
    degradedStore.upsertFile({
      path: "src/bad.ts",
      language: "typescript",
      hash: "error-hash",
      size: 1,
      mtimeMs: Date.now(),
      parserVersion: "1",
      indexedAt: new Date().toISOString(),
      status: "error",
    });
    degradedStore.save();

    const result = await getGraphStatus({ repoRoot });
    expect(result.status).toBe("degraded");
    expect(result.erroredFileCount).toBe(1);
    expect(result.warnings).toContain("Graph contains files that failed to index; some graph results may be incomplete.");

    const summary = await queryGraph({
      repoRoot,
      query: { kind: "pattern", pattern: "file_summary", target: "src/ok.ts" },
    });
    expect(summary.status).toBe("degraded");

    const search = await searchGraph({ repoRoot, query: "ok", limit: 5 });
    expect(search.status).toBe("degraded");

    const context = await generateGraphContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/ok.ts"],
      writeArtifacts: false,
    });
    expect(context.status).toBe("degraded");
    expect(context.warnings).toContain("Graph contains files that failed to index; some graph results may be incomplete.");
  });

  it("keeps stale graphs read-only for incremental updates and workflow context", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/stale.ts", [
      "export function staleTarget() {",
      "  return true",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });
    const store = await GraphStore.open(repoRoot);
    store.setMetadata("parser_version", "outdated");
    store.save();

    const update = await updateGraph({ repoRoot, changedFiles: ["src/stale.ts"] });
    expect(update.status).toBe("stale");
    expect(update.filesIndexed).toBe(0);
    expect(update.warnings).toContain("Graph parser version changed; run `ocr graph build --full`.");

    const context = await generateGraphContext({
      repoRoot,
      workflow: "map",
      changedFiles: ["src/stale.ts"],
      writeArtifacts: false,
    });
    expect(context.status).toBe("stale");
    expect(context.graphUpdateStatus).toBe("stale");
    expect(context.warnings).toContain("Graph parser version changed; run `ocr graph build --full`.");
    expect(context.structuredWarnings.some((warning) => warning.code === "graph_parser_stale")).toBe(true);
    expect(context.changedNodes.some((node) => node.name === "staleTarget")).toBe(true);
  });

  it("generates bounded graph review analysis artifacts and hints", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "import { readUser } from '../db/user'",
      "",
      "export function getUser(id: string) {",
      "  return readUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/db/user.ts", [
      "export function readUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));
    write(repoRoot, "src/ui/profile.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function loadProfile(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const sessionDir = join(repoRoot, ".ocr", "sessions", "review-analysis");
    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      sessionDir,
      writeArtifacts: true,
      maxFiles: 2,
      maxHints: 3,
      maxModules: 2,
      maxNodes: 10,
    });

    expect(analysis.status).toBe("ready");
    expect(analysis.summary).toContain("Graph review analysis:");
    expect(analysis.sourceScope.workflow).toBe("review");
    expect(analysis.sourceScope.changedSymbolPrecision).toBe("file");
    expect(analysis.changedSymbols.some((node) => node.name === "userHandler")).toBe(true);
    expect(analysis.priorities.length).toBeGreaterThan(0);
    expect(analysis.hints.length).toBeLessThanOrEqual(3);
    expect(analysis.hints.some((hint) => hint.kind === "review_order")).toBe(true);
    expect(analysis.hints.some((hint) => hint.kind === "boundary_crossing")).toBe(true);
    expect(analysis.modules.length).toBeLessThanOrEqual(2);
    expect(analysis.modules.some((module) => module.changedFiles.includes("src/api/user.ts"))).toBe(true);
    expect(analysis.drilldown.impactedFiles.length).toBeLessThanOrEqual(2);
    expect(analysis.drilldown.impactedNodes.length).toBeLessThanOrEqual(10);
    expect(analysis.drilldown.flows.some((flow) => flow.name === "userHandler (src/api/user.ts)")).toBe(true);
    expect(analysis.drilldown.testGaps.some((gap) => gap.kind === "no_test_edge_for_changed_function")).toBe(true);
    expect(analysis.truncated).toBe(true);
    expect(existsSync(join(sessionDir, "graph-review-analysis.json"))).toBe(true);
  });

  it("does not update graph or rebuild derived tables while generating review analysis", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const originalRebuildSearchIndex = GraphStore.prototype.rebuildSearchIndex;
    const originalReplaceFlows = GraphStore.prototype.replaceFlows;
    const rebuildSearchIndex = vi.spyOn(GraphStore.prototype, "rebuildSearchIndex").mockImplementation(function (this: GraphStore) {
      return originalRebuildSearchIndex.call(this);
    });
    const rebuildSearchIndexForFiles = vi.spyOn(GraphStore.prototype, "rebuildSearchIndexForFiles");
    const replaceFlows = vi.spyOn(GraphStore.prototype, "replaceFlows").mockImplementation(function (
      this: GraphStore,
      flows,
    ) {
      return originalReplaceFlows.call(this, flows);
    });
    const replaceFlowsForFiles = vi.spyOn(GraphStore.prototype, "replaceFlowsForFiles");
    const moduleBridgeSummaries = vi.spyOn(GraphStore.prototype, "moduleBridgeSummaries");

    await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      writeArtifacts: false,
    });

    expect(rebuildSearchIndex).not.toHaveBeenCalled();
    expect(rebuildSearchIndexForFiles).not.toHaveBeenCalled();
    expect(replaceFlows).not.toHaveBeenCalled();
    expect(replaceFlowsForFiles).not.toHaveBeenCalled();
    expect(moduleBridgeSummaries).not.toHaveBeenCalled();
  });

  it("skips expensive module summaries when maxModules is zero", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const moduleBridgeSummaries = vi.spyOn(GraphStore.prototype, "moduleBridgeSummaries");
    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      maxModules: 0,
      writeArtifacts: false,
    });

    expect(analysis.modules).toEqual([]);
    expect(moduleBridgeSummaries).not.toHaveBeenCalled();
  });

  it("downgrades module summaries for large graph review analysis requests", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const edgeCount = vi.spyOn(GraphStore.prototype, "edgeCount").mockReturnValue(50_001);
    const moduleBridgeSummaries = vi.spyOn(GraphStore.prototype, "moduleBridgeSummaries");
    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      maxModules: 3,
      writeArtifacts: false,
    });

    expect(edgeCount).toHaveBeenCalled();
    expect(moduleBridgeSummaries).not.toHaveBeenCalled();
    expect(analysis.modules).toEqual([]);
    expect(analysis.warnings.some((warning) => warning.includes("Skipping module summaries for large graph"))).toBe(true);
    expect(analysis.performance?.downgradedReason).toContain("Skipping module summaries for large graph");
    expect(analysis.performance?.phases.some((phase) => phase.phase === "module_summaries")).toBe(true);
  });

  it("returns missing graph review analysis when graph database is absent", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.ts", "export function run() { return true }\n");

    const analysis = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.ts"],
      writeArtifacts: false,
    });

    expect(analysis.status).toBe("missing");
    expect(analysis.summary).toContain("graph database is missing");
    expect(analysis.changedSymbols).toEqual([]);
    expect(analysis.warnings).toContain("Graph database missing. Run `ocr graph build --full` to enable graph review analysis.");
    expect(analysis.nextToolSuggestions?.[0]?.command).toBe("ocr graph build --full");
  });

  it("generates bounded minimal graph context with next tool suggestions", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const context = await generateGraphMinimalContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      maxPriorities: 1,
      maxWarnings: 2,
      maxSuggestions: 2,
      writeArtifacts: false,
    });

    expect(context.version).toBe(1);
    expect(context.status).toBe("ready");
    expect(context.counts.changedFiles).toBe(1);
    expect(context.counts.changedSymbols).toBeGreaterThan(0);
    expect(context.topPriorities.length).toBeLessThanOrEqual(1);
    expect(context.nextToolSuggestions.length).toBeLessThanOrEqual(2);
    expect(context.nextToolSuggestions[0]?.command).toContain("ocr graph query");
    expect(context.nextToolSuggestions[0]?.evidenceRequirement).toContain("source");
    expect(context.budget.maxPriorities).toBe(1);
  });

  it("generates missing minimal graph context without building the graph", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.ts", "export function run() { return true }\n");

    const context = await generateGraphMinimalContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.ts"],
      writeArtifacts: false,
    });

    expect(context.status).toBe("missing");
    expect(context.risk.level).toBe("unknown");
    expect(context.counts.changedFiles).toBe(1);
    expect(context.counts.changedSymbols).toBe(0);
    expect(context.nextToolSuggestions[0]?.command).toBe("ocr graph build --full");
  });

  it("generates bounded graph review context snippets", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));

    await buildGraph({ repoRoot, mode: "full" });

    const context = await generateGraphReviewContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts"],
      maxFiles: 2,
      maxSnippets: 4,
      maxLinesPerSnippet: 2,
      maxChars: 2000,
      writeArtifacts: false,
    });

    expect(context.status).toBe("ready");
    expect(context.snippets.length).toBeGreaterThan(0);
    expect(context.snippets.length).toBeLessThanOrEqual(4);
    expect(context.snippets[0]?.filePath).toBe("src/api/user.ts");
    expect(context.snippets[0]?.text.split("\n").length).toBeLessThanOrEqual(2);
    expect(context.snippets.some((snippet) => snippet.kind === "changed_symbol")).toBe(true);
    expect(context.nextToolSuggestions.some((suggestion) => suggestion.command.includes("ocr graph review-context"))).toBe(true);
  });

  it("handles missing graph review context without throwing", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/service.ts", "export function run() { return true }\n");

    const context = await generateGraphReviewContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/service.ts"],
      writeArtifacts: false,
    });

    expect(context.status).toBe("missing");
    expect(context.snippets).toEqual([]);
    expect(context.warnings).toContain("Graph database missing. Run `ocr graph build --full` to enable graph review analysis.");
    expect(context.nextToolSuggestions[0]?.command).toBe("ocr graph build --full");
  });

  it("omits unsupported files and marks review context budget truncation", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/api/user.ts", [
      "import { getUser } from '../service/user'",
      "export function userHandler(id: string) {",
      "  return getUser(id)",
      "}",
    ].join("\n"));
    write(repoRoot, "src/service/user.ts", [
      "export function getUser(id: string) {",
      "  return { id }",
      "}",
    ].join("\n"));
    write(repoRoot, "README.md", "# docs\n");

    await buildGraph({ repoRoot, mode: "full" });

    const context = await generateGraphReviewContext({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/api/user.ts", "README.md"],
      maxFiles: 1,
      maxSnippets: 1,
      maxLinesPerSnippet: 1,
      maxChars: 30,
      writeArtifacts: false,
    });

    expect(context.omittedFiles.some((file) => file.filePath === "README.md")).toBe(true);
    expect(context.budget.truncated).toBe(true);
    expect(context.warnings.some((warning) => warning.includes("truncated"))).toBe(true);
  });

  it("propagates degraded and stale status into graph review analysis", async () => {
    const repoRoot = makeRepo();
    write(repoRoot, "src/ok.ts", "export function ok() { return true }\n");

    await buildGraph({ repoRoot, mode: "full" });

    const degradedStore = await GraphStore.open(repoRoot);
    degradedStore.upsertFile({
      path: "src/bad.ts",
      language: "typescript",
      hash: "error-hash",
      size: 1,
      mtimeMs: Date.now(),
      parserVersion: "1",
      indexedAt: new Date().toISOString(),
      status: "error",
    });
    degradedStore.save();

    const degraded = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/ok.ts"],
      writeArtifacts: false,
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.summary).toContain("Graph coverage is degraded");
    expect(degraded.warnings).toContain("Graph contains files that failed to index; some graph results may be incomplete.");

    const staleStore = await GraphStore.open(repoRoot);
    staleStore.setMetadata("parser_version", "outdated");
    staleStore.save();

    const stale = await generateGraphReviewAnalysis({
      repoRoot,
      workflow: "review",
      changedFiles: ["src/ok.ts"],
      writeArtifacts: false,
    });
    expect(stale.status).toBe("stale");
    expect(stale.summary).toContain("Graph is stale");
    expect(stale.warnings).toContain("Graph parser version changed; run `ocr graph build --full`.");
  });
});
