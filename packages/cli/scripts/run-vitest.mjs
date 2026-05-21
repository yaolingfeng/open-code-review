import { spawnSync } from "node:child_process";

const passthroughArgs = process.argv.slice(2);
const vitestArgs = ["exec", "vitest", "run", "--config", "packages/cli/vitest.config.ts"];
let forceSerial = false;

for (const arg of passthroughArgs) {
  if (arg === "--runInBand" || arg === "--run-in-band") {
    forceSerial = true;
    continue;
  }
  vitestArgs.push(arg);
}

if (forceSerial) {
  vitestArgs.push("--no-file-parallelism", "--maxWorkers=1", "--minWorkers=1");
}

const result = spawnSync("pnpm", vitestArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
