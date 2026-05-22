/**
 * Workflow-level graph context e2e tests.
 *
 * These verify the observable orchestration contract through the built CLI:
 * graph context generation is automatic at context-discovery transitions and
 * missing graph data never blocks review/map progress.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { spawnCli } from "./helpers/spawn-cli.js";
import {
  createInitializedProject,
  type TempProject,
} from "./helpers/temp-project.js";

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.forEach((fn) => fn()));

function tracked<T extends TempProject>(project: T): T {
  cleanups.push(project.cleanup);
  return project;
}

function writeProjectFile(project: TempProject, filePath: string, content: string): void {
  const absPath = resolve(project.dir, filePath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf-8");
}

function commitProject(project: TempProject): void {
  execFileSync("git", ["add", "."], { cwd: project.dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "add graph fixtures"], { cwd: project.dir, stdio: "ignore" });
}

function readGraphContext(project: TempProject, sessionId: string): {
  workflow: string;
  status: string;
  changedFiles: string[];
  warnings: string[];
} {
  const sessionDir = resolve(project.dir, ".ocr", "sessions", sessionId);
  const graphMd = resolve(sessionDir, "graph-context.md");
  const graphJson = resolve(sessionDir, "graph-context.json");
  expect(existsSync(graphMd)).toBe(true);
  expect(existsSync(graphJson)).toBe(true);
  return JSON.parse(readFileSync(graphJson, "utf-8"));
}

describe("workflow graph context artifacts", () => {
  it("auto-generates review graph context and does not block when graph DB is missing", async () => {
    const project = tracked(createInitializedProject());
    const sessionId = "2026-05-16-feat-graph-review-e2e";

    const init = await spawnCli(
      [
        "state",
        "init",
        "--session-id",
        sessionId,
        "--branch",
        "feat/graph-review-e2e",
        "--workflow-type",
        "review",
      ],
      { cwd: project.dir },
    );
    expect(init.exitCode).toBe(0);

    const transition = await spawnCli(
      [
        "state",
        "transition",
        "--session-id",
        sessionId,
        "--phase",
        "change-context",
        "--phase-number",
        "2",
        "--current-round",
        "1",
      ],
      { cwd: project.dir },
    );
    expect(transition.exitCode).toBe(0);
    expect(transition.stdout).toContain(`${sessionId}: change-context`);

    const graphContext = readGraphContext(project, sessionId);
    expect(graphContext).toMatchObject({
      workflow: "review",
      status: "missing",
    });
    expect(graphContext.warnings.join("\n")).toContain("Graph database missing");
  });

  it("auto-generates map graph context and does not block when graph DB is missing", async () => {
    const project = tracked(createInitializedProject());
    const sessionId = "2026-05-16-feat-graph-map-e2e";

    const init = await spawnCli(
      [
        "state",
        "init",
        "--session-id",
        sessionId,
        "--branch",
        "feat/graph-map-e2e",
        "--workflow-type",
        "map",
      ],
      { cwd: project.dir },
    );
    expect(init.exitCode).toBe(0);

    const transition = await spawnCli(
      [
        "state",
        "transition",
        "--session-id",
        sessionId,
        "--phase",
        "map-context",
        "--phase-number",
        "1",
        "--current-map-run",
        "1",
      ],
      { cwd: project.dir },
    );
    expect(transition.exitCode).toBe(0);
    expect(transition.stdout).toContain(`${sessionId}: map-context`);

    const graphContext = readGraphContext(project, sessionId);
    expect(graphContext).toMatchObject({
      workflow: "map",
      status: "missing",
    });
    expect(graphContext.warnings.join("\n")).toContain("Graph database missing");
  });

  it("auto-generates ready graph context for review and map when graph DB exists", async () => {
    const project = tracked(createInitializedProject());
    writeProjectFile(project, "src/auth.ts", [
      "export function login(user: string) {",
      "  return user.length > 0",
      "}",
    ].join("\n"));
    writeProjectFile(project, "src/app.ts", [
      "import { login } from './auth'",
      "",
      "export function run() {",
      "  return login('alice')",
      "}",
    ].join("\n"));
    commitProject(project);

    const env = { OCR_NO_UPDATE_CHECK: "1" };
    const build = await spawnCli(["graph", "build", "--full", "--json"], {
      cwd: project.dir,
      env,
      timeout: 60_000,
    });
    expect(build.exitCode).toBe(0);

    writeProjectFile(project, "src/app.ts", [
      "import { login } from './auth'",
      "",
      "export function run() {",
      "  return login('bob')",
      "}",
    ].join("\n"));

    const reviewSessionId = "2026-05-16-feat-graph-ready-review-e2e";
    const reviewInit = await spawnCli(
      [
        "state",
        "init",
        "--session-id",
        reviewSessionId,
        "--branch",
        "feat/graph-ready-review-e2e",
        "--workflow-type",
        "review",
      ],
      { cwd: project.dir, env },
    );
    expect(reviewInit.exitCode).toBe(0);

    const reviewTransition = await spawnCli(
      [
        "state",
        "transition",
        "--session-id",
        reviewSessionId,
        "--phase",
        "change-context",
        "--phase-number",
        "2",
      ],
      { cwd: project.dir, env },
    );
    expect(reviewTransition.exitCode).toBe(0);
    const reviewGraphContext = readGraphContext(project, reviewSessionId);
    expect(reviewGraphContext).toMatchObject({
      workflow: "review",
      status: "ready",
    });
    expect(reviewGraphContext.changedFiles).toContain("src/app.ts");

    const mapSessionId = "2026-05-16-feat-graph-ready-map-e2e";
    const mapInit = await spawnCli(
      [
        "state",
        "init",
        "--session-id",
        mapSessionId,
        "--branch",
        "feat/graph-ready-map-e2e",
        "--workflow-type",
        "map",
      ],
      { cwd: project.dir, env },
    );
    expect(mapInit.exitCode).toBe(0);

    const mapTransition = await spawnCli(
      [
        "state",
        "transition",
        "--session-id",
        mapSessionId,
        "--phase",
        "map-context",
        "--phase-number",
        "1",
      ],
      { cwd: project.dir, env },
    );
    expect(mapTransition.exitCode).toBe(0);
    const mapGraphContext = readGraphContext(project, mapSessionId);
    expect(mapGraphContext).toMatchObject({
      workflow: "map",
      status: "ready",
    });
    expect(mapGraphContext.changedFiles).toContain("src/app.ts");
  });
});
