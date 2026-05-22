import { Command, InvalidArgumentError } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import {
  ensureDatabase,
  exportTokenUsageArtifacts,
  getSession,
  listTokenUsageForWorkflow,
  recordTokenUsage,
  saveDatabase,
  summarizeTokenUsageForWorkflow,
  type TokenUsageSource,
} from "../lib/db/index.js";
import { resolveActiveSession } from "../lib/state/index.js";

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return parsed;
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Must be a non-negative number");
  }
  return parsed;
}

function parseSource(value: string): TokenUsageSource {
  if (value !== "manual" && value !== "vendor_event" && value !== "estimated") {
    throw new InvalidArgumentError('Must be one of: manual, vendor_event, estimated');
  }
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

async function setup(): Promise<{ ocrDir: string; dbPath: string }> {
  const targetDir = process.cwd();
  requireOcrSetup(targetDir);
  const ocrDir = join(targetDir, ".ocr");
  return { ocrDir, dbPath: join(ocrDir, "data", "ocr.db") };
}

const recordSubcommand = new Command("record")
  .description("Record token usage for a workflow or agent session")
  .option("--workflow <id>", "Workflow session id (auto-detects active if omitted)")
  .option("--agent-session <id>", "OCR agent session id from `ocr session start-instance`")
  .option("--vendor <vendor>", "AI vendor, e.g. claude or opencode")
  .option("--vendor-session-id <id>", "Underlying vendor session id")
  .option("--model <id>", "Resolved model id")
  .option("--phase <phase>", "Workflow phase for this usage row")
  .option("--input-tokens <n>", "Input token count", parseNonNegativeInteger)
  .option("--output-tokens <n>", "Output token count", parseNonNegativeInteger)
  .option("--cache-read-tokens <n>", "Cache read token count", parseNonNegativeInteger)
  .option("--cache-write-tokens <n>", "Cache write token count", parseNonNegativeInteger)
  .option("--reasoning-tokens <n>", "Reasoning token count", parseNonNegativeInteger)
  .option("--total-tokens <n>", "Total token count", parseNonNegativeInteger)
  .option("--cost-usd <n>", "Cost in USD", parseNonNegativeNumber)
  .option("--source <source>", "manual | vendor_event | estimated", parseSource, "manual")
  .option("--raw-json <json>", "Raw vendor usage JSON for audit/debugging")
  .option("--json", "Emit the recorded row as JSON")
  .action(async (options: {
    workflow?: string;
    agentSession?: string;
    vendor?: string;
    vendorSessionId?: string;
    model?: string;
    phase?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    source: TokenUsageSource;
    rawJson?: string;
    json?: boolean;
  }) => {
    const { ocrDir, dbPath } = await setup();
    const db = await ensureDatabase(ocrDir);

    try {
      const workflowId = options.workflow ?? (
        options.agentSession ? undefined : (await resolveActiveSession(ocrDir)).id
      );
      const row = recordTokenUsage(db, {
        workflow_id: workflowId,
        agent_session_id: options.agentSession ?? null,
        vendor: options.vendor ?? null,
        vendor_session_id: options.vendorSessionId ?? null,
        model: options.model ?? null,
        phase: options.phase ?? null,
        input_tokens: options.inputTokens,
        output_tokens: options.outputTokens,
        cache_read_tokens: options.cacheReadTokens,
        cache_write_tokens: options.cacheWriteTokens,
        reasoning_tokens: options.reasoningTokens,
        total_tokens: options.totalTokens,
        cost_usd: options.costUsd ?? null,
        source: options.source,
        raw_usage_json: options.rawJson ?? null,
      });
      saveDatabase(db, dbPath);

      if (options.json) {
        printJson(row);
        return;
      }
      console.log(
        `Recorded ${row.total_tokens} tokens for workflow ${row.workflow_id}` +
          (row.agent_session_id ? ` (${row.agent_session_id})` : ""),
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Failed to record token usage");
    }
  });

const showSubcommand = new Command("show")
  .description("Show token usage for a workflow")
  .option("--workflow <id>", "Workflow session id (auto-detects active if omitted)")
  .option("--json", "Emit JSON summary and rows")
  .action(async (options: { workflow?: string; json?: boolean }) => {
    const { ocrDir } = await setup();
    const db = await ensureDatabase(ocrDir);

    try {
      const workflowId = options.workflow ?? (await resolveActiveSession(ocrDir)).id;
      const summary = summarizeTokenUsageForWorkflow(db, workflowId);
      const rows = listTokenUsageForWorkflow(db, workflowId);

      if (options.json) {
        printJson({ summary, rows });
        return;
      }

      console.log(chalk.bold(`Token usage for ${workflowId}`));
      console.log(`  Total: ${summary.total_tokens}`);
      console.log(`  Input: ${summary.input_tokens}`);
      console.log(`  Output: ${summary.output_tokens}`);
      console.log(`  Cache read/write: ${summary.cache_read_tokens}/${summary.cache_write_tokens}`);
      console.log(`  Reasoning: ${summary.reasoning_tokens}`);
      console.log(`  Cost: ${summary.cost_usd === null ? "(not recorded)" : `$${summary.cost_usd.toFixed(6)}`}`);

      if (summary.by_agent.length > 0) {
        console.log();
        console.log(chalk.bold("By agent"));
        for (const agent of summary.by_agent) {
          const label = agent.name ?? agent.agent_session_id ?? "(workflow)";
          const model = agent.model ?? "(default)";
          const cost = agent.cost_usd === null ? "" : ` $${agent.cost_usd.toFixed(6)}`;
          console.log(`  ${label.padEnd(24)} ${model.padEnd(32)} ${agent.total_tokens}${cost}`);
        }
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : "Failed to show token usage");
    }
  });

const exportSubcommand = new Command("export")
  .description("Write usage.md and usage.json artifacts for a workflow")
  .option("--workflow <id>", "Workflow session id (auto-detects active if omitted)")
  .option("--session-dir <dir>", "Session directory where usage artifacts are written")
  .option("--json", "Emit written artifact paths as JSON")
  .action(async (options: { workflow?: string; sessionDir?: string; json?: boolean }) => {
    const { ocrDir } = await setup();
    const db = await ensureDatabase(ocrDir);

    try {
      const workflowId = options.workflow ?? (await resolveActiveSession(ocrDir)).id;
      const session = getSession(db, workflowId);
      const sessionDir = options.sessionDir ?? session?.session_dir;
      if (!sessionDir) {
        throw new Error("session directory is required when workflow is not found in state");
      }
      const { usageJsonPath, usageMdPath } = exportTokenUsageArtifacts(db, workflowId, sessionDir);

      if (options.json) {
        printJson({ workflow_id: workflowId, usage_json: usageJsonPath, usage_md: usageMdPath });
        return;
      }
      console.log(`Wrote ${usageMdPath}`);
      console.log(`Wrote ${usageJsonPath}`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Failed to export token usage");
    }
  });

export const usageCommand = new Command("usage")
  .description("Record and inspect LLM token usage")
  .addCommand(recordSubcommand)
  .addCommand(showSubcommand)
  .addCommand(exportSubcommand);
