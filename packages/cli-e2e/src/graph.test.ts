import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { spawnCli } from "./helpers/spawn-cli.js";
import { createTempProject, type TempProject } from "./helpers/temp-project.js";

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

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

describe("ocr graph e2e smoke", () => {
  it("builds, queries, impacts, and writes graph context artifacts from the bundled CLI", async () => {
    const project = tracked(createTempProject());
    writeProjectFile(project, "package.json", JSON.stringify({
      name: "graph-smoke",
      exports: {
        ".": "./src/auth.ts",
      },
      imports: {
        "#auth": "./src/auth.ts",
      },
    }));
    writeProjectFile(project, "src/auth.ts", [
      "export function login(user: string) {",
      "  return user.length > 0",
      "}",
      "",
      "export function testLogin() {",
      "  return login('a')",
      "}",
    ].join("\n"));
    writeProjectFile(project, "src/app.ts", [
      "import { login } from '#auth'",
      "",
      "export function run() {",
      "  return login('a')",
      "}",
    ].join("\n"));
    commitProject(project);

    const env = { OCR_NO_UPDATE_CHECK: "1" };

    const missingStatus = await spawnCli(["graph", "status", "--json"], {
      cwd: project.dir,
      env,
    });
    expect(missingStatus.exitCode).toBe(0);
    expect(parseJson<{ status: string }>(missingStatus.stdout).status).toBe("missing");

    const build = await spawnCli(["graph", "build", "--full", "--json"], {
      cwd: project.dir,
      env,
      timeout: 60_000,
    });
    expect(build.exitCode).toBe(0);
    const buildJson = parseJson<{ status: string; filesIndexed: number }>(build.stdout);
    expect(buildJson.status).toBe("ready");
    expect(buildJson.filesIndexed).toBe(2);
    expect(existsSync(resolve(project.dir, ".ocr", "data", "graph.db"))).toBe(true);

    const summary = await spawnCli([
      "graph",
      "query",
      "file_summary",
      "--target",
      "src/app.ts",
      "--json",
    ], {
      cwd: project.dir,
      env,
    });
    expect(summary.exitCode).toBe(0);
    const summaryJson = parseJson<{
      status: string;
      edges?: { kind: string; targetQualified: string; metadata?: Record<string, unknown> }[];
    }>(summary.stdout);
    expect(summaryJson.status).toBe("ok");
    expect(summaryJson.edges?.some((edge) =>
      edge.kind === "DEPENDS_ON" &&
      edge.targetQualified === "src/auth.ts" &&
      edge.metadata?.["resolver"] === "nodejs",
    )).toBe(true);

    const stdinQuery = await spawnCli(["graph", "query", "--stdin", "--json"], {
      cwd: project.dir,
      env,
      stdin: JSON.stringify({
        kind: "impact",
        changedFiles: ["src/app.ts"],
        maxDepth: 2,
      }),
    });
    expect(stdinQuery.exitCode).toBe(0);
    const stdinJson = parseJson<{ status: string; files?: string[] }>(stdinQuery.stdout);
    expect(stdinJson.status).toBe("ok");
    expect(stdinJson.files).toContain("src/app.ts");

    const impact = await spawnCli([
      "graph",
      "impact",
      "--files",
      "src/app.ts",
      "--depth",
      "2",
      "--json",
    ], {
      cwd: project.dir,
      env,
    });
    expect(impact.exitCode).toBe(0);
    expect(parseJson<{ status: string }>(impact.stdout).status).toBe("ok");

    const sessionDir = ".ocr/sessions/graph-smoke";
    const context = await spawnCli([
      "graph",
      "context",
      "--workflow",
      "review",
      "--files",
      "src/app.ts",
      "--session-dir",
      sessionDir,
      "--json",
    ], {
      cwd: project.dir,
      env,
    });
    expect(context.exitCode).toBe(0);
    const contextJson = parseJson<{ status: string; changedFiles: string[] }>(context.stdout);
    expect(contextJson.status).toBe("ready");
    expect(contextJson.changedFiles).toEqual(["src/app.ts"]);
    expect(existsSync(resolve(project.dir, sessionDir, "graph-context.md"))).toBe(true);
    expect(existsSync(resolve(project.dir, sessionDir, "graph-context.json"))).toBe(true);
  });
});
