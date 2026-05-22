/**
 * Workflow-level token usage e2e tests.
 *
 * These verify the observable review workflow contract through the built
 * CLI: usage export is automatic at completion and missing vendor usage
 * never blocks the review from closing.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("review workflow token usage artifacts", () => {
  it("does not block review close when usage is missing and auto-generates usage artifacts", async () => {
    const project = tracked(createInitializedProject());
    const sessionId = "2026-05-16-feat-usage-e2e";

    const init = await spawnCli(
      [
        "state",
        "init",
        "--session-id",
        sessionId,
        "--branch",
        "feat/usage-e2e",
        "--workflow-type",
        "review",
      ],
      { cwd: project.dir },
    );
    expect(init.exitCode).toBe(0);

    const phases = [
      ["change-context", "2"],
      ["analysis", "3"],
      ["reviews", "4"],
      ["aggregation", "5"],
      ["discourse", "6"],
      ["synthesis", "7"],
    ] as const;

    for (const [phase, phaseNumber] of phases) {
      const transition = await spawnCli(
        [
          "state",
          "transition",
          "--session-id",
          sessionId,
          "--phase",
          phase,
          "--phase-number",
          phaseNumber,
          "--current-round",
          "1",
        ],
        { cwd: project.dir },
      );
      expect(transition.exitCode).toBe(0);
    }

    const close = await spawnCli(
      ["state", "close", "--session-id", sessionId],
      { cwd: project.dir },
    );
    expect(close.exitCode).toBe(0);
    expect(close.stdout).toContain(`${sessionId}: closed`);

    const sessionDir = resolve(project.dir, ".ocr", "sessions", sessionId);
    const usageMd = resolve(sessionDir, "usage.md");
    const usageJson = resolve(sessionDir, "usage.json");
    expect(existsSync(usageMd)).toBe(true);
    expect(existsSync(usageJson)).toBe(true);

    expect(readFileSync(usageMd, "utf-8")).toContain("Total tokens: 0");
    const usage = JSON.parse(readFileSync(usageJson, "utf-8"));
    expect(usage.summary).toMatchObject({
      workflow_id: sessionId,
      row_count: 0,
      total_tokens: 0,
    });
    expect(usage.rows).toEqual([]);

    const show = await spawnCli(
      ["state", "show", "--session-id", sessionId, "--json"],
      { cwd: project.dir },
    );
    expect(show.exitCode).toBe(0);
    const state = JSON.parse(show.stdout);
    expect(state.session.status).toBe("closed");
    expect(state.session.current_phase).toBe("complete");
  });
});
