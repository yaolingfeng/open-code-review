import { Command, InvalidArgumentError } from "commander";
import chalk from "chalk";
import {
  buildGraph,
  generateGraphContext,
  generateGraphMinimalContext,
  generateGraphReviewAnalysis,
  generateGraphReviewContext,
  getGraphStatus,
  getImpactRadius,
  queryGraph,
  renderGraphContextMarkdown,
  searchGraph,
  updateGraph,
  type GraphContext,
  type GraphBuildProgress,
  type GraphMinimalContext,
  type GraphNextToolSuggestion,
  type GraphQuery,
  type GraphQueryPattern,
  type GraphQueryResult,
  type GraphPostprocessLevel,
  type GraphReviewAnalysis,
  type GraphReviewContext,
  type GraphSearchResult,
  type GraphStatus,
  type GraphWorkflow,
} from "@open-code-review/graph";

const QUERY_PATTERNS = new Set<GraphQueryPattern>([
  "callers_of",
  "callees_of",
  "imports_of",
  "importers_of",
  "tests_for",
  "children_of",
  "file_summary",
]);

const LARGE_GRAPH_EDGE_THRESHOLD = 50_000;
const SAFE_IMPACT_DEPTH = 2;
const DEEP_TRAVERSAL_DEPTH = 4;

function repoRoot(): string {
  return process.cwd();
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return parsed;
}

function parseWorkflow(value: string): GraphWorkflow {
  if (value !== "review" && value !== "map") {
    throw new InvalidArgumentError('Must be "review" or "map"');
  }
  return value;
}

function parsePostprocess(value: string): GraphPostprocessLevel {
  if (value === "none" || value === "minimal" || value === "full") return value;
  throw new InvalidArgumentError("Must be one of: none, minimal, full");
}

function parsePattern(value: string): GraphQueryPattern {
  if (!QUERY_PATTERNS.has(value as GraphQueryPattern)) {
    throw new InvalidArgumentError(`Must be one of: ${[...QUERY_PATTERNS].join(", ")}`);
  }
  return value as GraphQueryPattern;
}

function splitFiles(value: string): string[] {
  return value
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (text.length === 0) {
    throw new Error("No JSON received on stdin");
  }
  return text;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function withWarnings<T extends { warnings?: string[] }>(value: T, warnings: string[]): T {
  if (warnings.length === 0) return value;
  return {
    ...value,
    warnings: [...new Set([...(value.warnings ?? []), ...warnings])],
  };
}

function withBuildWarnings<T extends { postprocessWarnings?: string[] }>(value: T, warnings: string[]): T {
  if (warnings.length === 0) return value;
  return {
    ...value,
    postprocessWarnings: [...new Set([...(value.postprocessWarnings ?? []), ...warnings])],
  };
}

async function cpuRiskWarnings(): Promise<{ status: GraphStatus; largeGraph: boolean }> {
  const status = await getGraphStatus({ repoRoot: repoRoot() });
  return {
    status,
    largeGraph: status.edgeCount > LARGE_GRAPH_EDGE_THRESHOLD,
  };
}

function printStatus(status: GraphStatus): void {
  const color =
    status.status === "ready"
      ? chalk.green
      : status.status === "missing"
        ? chalk.yellow
        : chalk.red;

  console.log(`${chalk.bold("Graph status:")} ${color(status.status)}`);
  console.log(`${chalk.bold("DB:")} ${status.dbPath}`);
  console.log(`${chalk.bold("Files:")} ${status.indexedFileCount} indexed, ${status.unsupportedFileCount} unsupported`);
  console.log(`${chalk.bold("Nodes/Edges:")} ${status.nodeCount}/${status.edgeCount}`);
  console.log(`${chalk.bold("Languages:")} ${status.languages.length > 0 ? status.languages.join(", ") : "none"}`);
  if (status.lastIndexedAt) {
    console.log(`${chalk.bold("Last indexed:")} ${status.lastIndexedAt}`);
  }
  if (status.warnings.length > 0) {
    console.log();
    for (const warning of status.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
}

function printBuildResult(result: Awaited<ReturnType<typeof buildGraph>>): void {
  printStatus(result);
  console.log();
  console.log(
    `${chalk.bold("Scan:")} ${result.filesScanned} scanned, ${result.filesIndexed} indexed, ` +
      `${result.filesSkipped} skipped, ${result.filesUnsupported} unsupported, ${result.filesErrored} errored`,
  );
}

function createGraphBuildProgressReporter(): (progress: GraphBuildProgress) => void {
  return (progress) => {
    switch (progress.phase) {
      case "discovering":
        console.error(chalk.gray("Graph build: discovering project files..."));
        break;
      case "discovered":
        console.error(chalk.gray(`Graph build: discovered ${progress.totalFiles ?? 0} file(s).`));
        break;
      case "indexing": {
        const processed = progress.processedFiles ?? 0;
        const total = progress.totalFiles ?? 0;
        const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
        console.error(
          chalk.gray(
            `Graph build: indexing ${processed}/${total} (${percent}%) ` +
              `${progress.filesIndexed ?? 0} indexed, ${progress.filesSkipped ?? 0} skipped, ` +
              `${progress.filesUnsupported ?? 0} unsupported, ${progress.filesErrored ?? 0} errored`,
          ),
        );
        break;
      }
      case "rebuilding_flows":
        console.error(chalk.gray("Graph build: rebuilding flow summaries..."));
        break;
      case "saving":
        console.error(chalk.gray("Graph build: saving graph database..."));
        break;
      case "done":
        console.error(chalk.gray("Graph build: done."));
        break;
    }
  };
}

function printQueryResult(result: GraphQueryResult): void {
  console.log(`${chalk.bold("Status:")} ${result.status}`);
  console.log(result.summary);
  if (result.files && result.files.length > 0) {
    console.log();
    console.log(chalk.bold("Files"));
    for (const file of result.files) console.log(`- ${file}`);
  }
  if (result.nodes && result.nodes.length > 0) {
    console.log();
    console.log(chalk.bold("Nodes"));
    for (const node of result.nodes) {
      console.log(`- ${node.qualifiedName} (${node.kind}, ${node.filePath}:${node.lineStart})`);
    }
  }
  if (result.edges && result.edges.length > 0) {
    console.log();
    console.log(chalk.bold("Edges"));
    for (const edge of result.edges) {
      console.log(`- ${edge.kind}: ${edge.sourceQualified} -> ${edge.targetQualified}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
  if (result.truncated) {
    console.log(chalk.yellow("Result truncated; increase --limit or --depth if needed."));
  }
  printNextToolSuggestions(result.nextToolSuggestions);
}

function printContext(context: GraphContext): void {
  console.log(renderGraphContextMarkdown(context));
}

function printSearchResult(result: GraphSearchResult): void {
  console.log(`${chalk.bold("Status:")} ${result.status}`);
  console.log(result.summary);
  console.log(`${chalk.bold("Query:")} ${result.query}`);
  console.log(`${chalk.bold("Limit:")} ${result.limit}`);
  if (result.results.length > 0) {
    console.log();
    console.log(chalk.bold("Results"));
    for (const item of result.results) {
      const matches = item.matchTypes.join(", ");
      const score = item.score === undefined ? "" : `, score ${item.score.toFixed(2)}`;
      console.log(`- ${item.qualifiedName} (${item.kind}, ${item.filePath}; matches: ${matches}${score})`);
    }
  }
  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
  if (result.truncated) {
    console.log(chalk.yellow("Result truncated; increase --limit if needed."));
  }
  printNextToolSuggestions(result.nextToolSuggestions);
}

function printMinimalContext(context: GraphMinimalContext): void {
  console.log(`${chalk.bold("Status:")} ${context.status}`);
  console.log(context.summary);
  console.log(
    `${chalk.bold("Risk:")} ${context.risk.level} (${context.risk.score.toFixed(2)})`,
  );
  console.log(
    `${chalk.bold("Counts:")} ${context.counts.changedFiles} changed file(s), ` +
      `${context.counts.changedSymbols} changed symbol(s), ` +
      `${context.counts.impactedFiles} impacted file(s), ` +
      `${context.counts.testGaps} test gap(s)`,
  );

  if (context.topPriorities.length > 0) {
    console.log();
    console.log(chalk.bold("Top priorities"));
    for (const priority of context.topPriorities) {
      console.log(`- ${priority.qualifiedName} (${priority.filePath}, score ${priority.score}): ${priority.reason}`);
    }
  }

  if (context.warnings.length > 0) {
    console.log();
    for (const warning of context.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
  if (context.budget.truncated) {
    console.log(chalk.yellow("Minimal context truncated by budget; use graph suggestions for bounded drill-down."));
  }
  printNextToolSuggestions(context.nextToolSuggestions);
}

function printReviewAnalysis(result: GraphReviewAnalysis): void {
  console.log(`${chalk.bold("Status:")} ${result.status}`);
  console.log(result.summary);
  console.log(
    `${chalk.bold("Scope:")} ${result.sourceScope.workflow} workflow, ${result.sourceScope.changedFileCount} changed file(s), ` +
      `${result.sourceScope.changedSymbolPrecision} precision`,
  );

  if (result.priorities.length > 0) {
    console.log();
    console.log(chalk.bold("Priorities"));
    for (const priority of result.priorities) {
      console.log(`- ${priority.qualifiedName} (${priority.filePath}, score ${priority.score}): ${priority.reason}`);
    }
  }

  if (result.hints.length > 0) {
    console.log();
    console.log(chalk.bold("Hints"));
    for (const hint of result.hints) {
      console.log(`- [${hint.severity}] ${hint.kind}: ${hint.message}`);
    }
  }

  if (result.modules.length > 0) {
    console.log();
    console.log(chalk.bold("Modules"));
    for (const module of result.modules) {
      console.log(`- ${module.name}: ${module.summary}`);
    }
  }

  if (result.drilldown.testGaps.length > 0) {
    console.log();
    console.log(chalk.bold("Test gaps"));
    for (const gap of result.drilldown.testGaps) {
      console.log(`- ${gap.qualifiedName} (${gap.filePath}:${gap.lineStart}): ${gap.reason}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
  if (result.truncated) {
    console.log(chalk.yellow("Result truncated; tighten scope or raise max result limits if needed."));
  }
  printNextToolSuggestions(result.nextToolSuggestions);
}

function printReviewContext(result: GraphReviewContext): void {
  console.log(`${chalk.bold("Status:")} ${result.status}`);
  console.log(result.summary);
  console.log(chalk.yellow("Graph snippets are investigation context; verify findings against source, diff, tests, or runtime evidence."));

  if (result.snippets.length > 0) {
    console.log();
    console.log(chalk.bold("Snippets"));
    for (const snippet of result.snippets) {
      console.log(`- [${snippet.kind}] ${snippet.filePath}:${snippet.lineStart}-${snippet.lineEnd}`);
      console.log(`  Symbols: ${snippet.qualifiedNames.join(", ")}`);
      console.log(`  Reason: ${snippet.reason}`);
      if (snippet.truncated) console.log(chalk.yellow("  Truncated by max-lines-per-snippet."));
      console.log("  ```");
      for (const line of snippet.text.split("\n")) {
        console.log(`  ${line}`);
      }
      console.log("  ```");
    }
  }

  if (result.omittedFiles.length > 0) {
    console.log();
    console.log(chalk.bold("Omitted files"));
    for (const omitted of result.omittedFiles) {
      console.log(`- ${omitted.filePath}: ${omitted.reason}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) {
      console.log(`${chalk.yellow("Warning:")} ${warning}`);
    }
  }
  if (result.budget.truncated) {
    console.log(chalk.yellow("Review context truncated; tighten scope or raise snippet budgets if needed."));
  }
  printNextToolSuggestions(result.nextToolSuggestions);
}

function printNextToolSuggestions(suggestions: GraphNextToolSuggestion[] | undefined): void {
  if (!suggestions || suggestions.length === 0) return;
  console.log();
  console.log(chalk.bold("Next tool suggestions"));
  for (const suggestion of suggestions) {
    console.log(`- [${suggestion.priority}] ${suggestion.command}`);
    console.log(`  Reason: ${suggestion.reason}`);
    console.log(`  Expected value: ${suggestion.expectedValue}`);
    console.log(`  Evidence: ${suggestion.evidenceRequirement}`);
  }
}

function fail(error: unknown): never {
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
}

const statusCommand = new Command("status")
  .description("Show code graph database status")
  .option("--json", "Print JSON output")
  .action(async (options: { json?: boolean }) => {
    try {
      const result = await getGraphStatus({ repoRoot: repoRoot() });
      if (options.json) printJson(result);
      else printStatus(result);
    } catch (error) {
      fail(error);
    }
  });

const buildCommand = new Command("build")
  .description("Build the code graph database")
  .option("--full", "Run a full rebuild")
  .option("--postprocess <level>", "Derived graph work (none, minimal, or full)", parsePostprocess, "full")
  .option("--json", "Print JSON output")
  .action(async (options: { full?: boolean; postprocess: GraphPostprocessLevel; json?: boolean }) => {
    try {
      if (!options.full) {
        throw new Error("Only full graph builds are supported. Pass --full.");
      }
      const warnings: string[] = [];
      let postprocess = options.postprocess;
      if (postprocess === "full") {
        const risk = await cpuRiskWarnings();
        if (risk.largeGraph) {
          postprocess = "minimal";
          warnings.push(
            `CPU-risk guard: graph has ${risk.status.edgeCount} edge(s); ` +
              "downgraded build postprocess from full to minimal. Run explicit offline full postprocess from a controlled environment if flow summaries must be refreshed.",
          );
        }
      }
      const buildOptions: Parameters<typeof buildGraph>[0] = {
        repoRoot: repoRoot(),
        mode: "full",
        postprocess,
      };
      if (!options.json) {
        buildOptions.onProgress = createGraphBuildProgressReporter();
      }
      const result = withBuildWarnings(await buildGraph(buildOptions), warnings);
      if (options.json) printJson(result);
      else printBuildResult(result);
    } catch (error) {
      fail(error);
    }
  });

const updateCommand = new Command("update")
  .description("Incrementally update the code graph database")
  .option("--base <ref>", "Git base ref for changed files")
  .option("--staged", "Update staged files")
  .option("--working-tree", "Update working tree files")
  .option("--postprocess <level>", "Derived graph work (none, minimal, or full)", parsePostprocess, "minimal")
  .option("--json", "Print JSON output")
  .action(async (options: { base?: string; staged?: boolean; workingTree?: boolean; postprocess: GraphPostprocessLevel; json?: boolean }) => {
    try {
      const warnings: string[] = [];
      let postprocess = options.postprocess;
      if (postprocess === "full") {
        const risk = await cpuRiskWarnings();
        if (risk.largeGraph) {
          postprocess = "minimal";
          warnings.push(
            `CPU-risk guard: graph has ${risk.status.edgeCount} edge(s); ` +
              "downgraded update postprocess from full to minimal. Run `ocr graph build --full` during an explicit maintenance window if full derived summaries are required.",
          );
        }
      }
      const result = withBuildWarnings(await updateGraph({
        repoRoot: repoRoot(),
        base: options.base,
        staged: options.staged,
        workingTree: options.workingTree,
        postprocess,
      }), warnings);
      if (options.json) printJson(result);
      else printBuildResult(result);
    } catch (error) {
      fail(error);
    }
  });

const queryCommand = new Command("query")
  .description("Query the code graph")
  .argument("[pattern]", "Query pattern", parsePattern)
  .option("--target <target>", "File path or qualified graph target")
  .option("--stdin", "Read a GraphQuery JSON object from stdin")
  .option("--limit <number>", "Maximum nodes/edges to return", parseInteger, 100)
  .option("--json", "Print JSON output")
  .action(
    async (
      pattern: GraphQueryPattern | undefined,
      options: { target?: string; stdin?: boolean; limit: number; json?: boolean },
    ) => {
      try {
        let query: GraphQuery;
        if (options.stdin) {
          query = JSON.parse(await readStdin()) as GraphQuery;
        } else {
          if (!pattern) throw new Error("Query pattern is required unless --stdin is used.");
          if (!options.target) throw new Error("--target is required unless --stdin is used.");
          query = {
            kind: "pattern",
            pattern,
            target: options.target,
            limit: options.limit,
          };
        }
        const result = await queryGraph({ repoRoot: repoRoot(), query });
        if (options.json) printJson(result);
        else printQueryResult(result);
      } catch (error) {
        fail(error);
      }
    },
  );

const impactCommand = new Command("impact")
  .description("Compute graph impact radius for changed files")
  .requiredOption("--files <files>", "Comma-separated file paths")
  .option("--depth <number>", "Traversal depth", parseInteger, 2)
  .option("--json", "Print JSON output")
  .action(async (options: { files: string; depth: number; json?: boolean }) => {
    try {
      const warnings: string[] = [];
      let depth = options.depth;
      if (depth > DEEP_TRAVERSAL_DEPTH) {
        const risk = await cpuRiskWarnings();
        if (risk.largeGraph) {
          depth = SAFE_IMPACT_DEPTH;
          warnings.push(
            `CPU-risk guard: graph has ${risk.status.edgeCount} edge(s); ` +
              `downgraded impact traversal depth from ${options.depth} to ${SAFE_IMPACT_DEPTH}.`,
          );
        }
      }
      const result = withWarnings(await getImpactRadius({
        repoRoot: repoRoot(),
        changedFiles: splitFiles(options.files),
        maxDepth: depth,
      }), warnings);
      if (options.json) printJson(result);
      else printQueryResult(result);
    } catch (error) {
      fail(error);
    }
  });

const contextCommand = new Command("context")
  .description("Generate graph context artifacts for review or map workflows")
  .requiredOption("--workflow <workflow>", "Workflow type (review or map)", parseWorkflow)
  .option("--base <ref>", "Git base ref for changed files")
  .option("--files <files>", "Comma-separated changed files")
  .option("--depth <number>", "Impact traversal depth", parseInteger, 2)
  .option("--session-dir <dir>", "Session directory where graph-context artifacts are written")
  .option("--update", "Explicitly update graph before generating context")
  .option("--postprocess <level>", "Derived graph work for --update (none, minimal, or full)", parsePostprocess, "minimal")
  .option("--no-write-artifacts", "Do not write graph-context.md/json")
  .option("--json", "Print JSON output")
  .action(
    async (options: {
      workflow: GraphWorkflow;
      base?: string;
      files?: string;
      depth: number;
      sessionDir?: string;
      update?: boolean;
      postprocess: GraphPostprocessLevel;
      writeArtifacts?: boolean;
      json?: boolean;
    }) => {
      try {
        const context = await generateGraphContext({
          repoRoot: repoRoot(),
          workflow: options.workflow,
          base: options.base,
          changedFiles: options.files ? splitFiles(options.files) : undefined,
          maxDepth: options.depth,
          sessionDir: options.sessionDir,
          update: options.update,
          postprocess: options.postprocess,
          writeArtifacts: options.writeArtifacts,
        });
        if (options.json) printJson(context);
        else printContext(context);
      } catch (error) {
        fail(error);
      }
    },
  );

const searchCommand = new Command("search")
  .description("Search the code graph index")
  .argument("<query>", "Search query")
  .option("--limit <number>", "Maximum search results to return", parseInteger, 20)
  .option("--json", "Print JSON output")
  .action(async (query: string, options: { limit: number; json?: boolean }) => {
    try {
      const result = await searchGraph({
        repoRoot: repoRoot(),
        query,
        limit: options.limit,
      });
      if (options.json) printJson(result);
      else printSearchResult(result);
    } catch (error) {
      fail(error);
    }
  });

const minimalContextCommand = new Command("minimal-context")
  .description("Generate bounded minimal graph context for review or map workflows")
  .requiredOption("--workflow <workflow>", "Workflow type (review or map)", parseWorkflow)
  .option("--base <ref>", "Git base ref for changed files")
  .option("--files <files>", "Comma-separated changed files")
  .option("--depth <number>", "Impact traversal depth", parseInteger, 2)
  .option("--max-priorities <number>", "Maximum top priorities", parseInteger, 5)
  .option("--max-warnings <number>", "Maximum warnings", parseInteger, 5)
  .option("--max-suggestions <number>", "Maximum next tool suggestions", parseInteger, 4)
  .option("--json", "Print JSON output")
  .action(
    async (options: {
      workflow: GraphWorkflow;
      base?: string;
      files?: string;
      depth: number;
      maxPriorities: number;
      maxWarnings: number;
      maxSuggestions: number;
      json?: boolean;
    }) => {
      try {
        const context = await generateGraphMinimalContext({
          repoRoot: repoRoot(),
          workflow: options.workflow,
          base: options.base,
          changedFiles: options.files ? splitFiles(options.files) : undefined,
          maxDepth: options.depth,
          maxPriorities: options.maxPriorities,
          maxWarnings: options.maxWarnings,
          maxSuggestions: options.maxSuggestions,
          writeArtifacts: false,
        });
        if (options.json) printJson(context);
        else printMinimalContext(context);
      } catch (error) {
        fail(error);
      }
    },
  );

const reviewAnalysisCommand = new Command("review-analysis")
  .description("Generate reviewer-focused graph analysis")
  .requiredOption("--workflow <workflow>", "Workflow type (review or map)", parseWorkflow)
  .option("--base <ref>", "Git base ref for changed files")
  .option("--files <files>", "Comma-separated changed files")
  .option("--depth <number>", "Impact traversal depth", parseInteger, 2)
  .option("--max-nodes <number>", "Maximum impacted nodes in drilldown", parseInteger, 200)
  .option("--max-files <number>", "Maximum impacted files in drilldown", parseInteger, 30)
  .option("--max-hints <number>", "Maximum reviewer hints", parseInteger, 8)
  .option("--max-modules <number>", "Maximum module summaries; disabled by default because it can be expensive on large graphs", parseInteger, 0)
  .option("--session-dir <dir>", "Session directory where graph-review-analysis.json is written")
  .option("--no-write-artifacts", "Do not write graph-review-analysis.json")
  .option("--json", "Print JSON output")
  .action(
    async (options: {
      workflow: GraphWorkflow;
      base?: string;
      files?: string;
      depth: number;
      maxNodes: number;
      maxFiles: number;
      maxHints: number;
      maxModules: number;
      sessionDir?: string;
      writeArtifacts?: boolean;
      json?: boolean;
    }) => {
      try {
        const warnings: string[] = [];
        let maxDepth = options.depth;
        let maxModules = options.maxModules;
        const requestedExpensiveAnalysis = maxDepth > DEEP_TRAVERSAL_DEPTH || maxModules > 0;
        if (requestedExpensiveAnalysis) {
          const risk = await cpuRiskWarnings();
          if (risk.largeGraph && maxDepth > DEEP_TRAVERSAL_DEPTH) {
            warnings.push(
              `CPU-risk guard: graph has ${risk.status.edgeCount} edge(s); ` +
                `downgraded review-analysis traversal depth from ${maxDepth} to ${SAFE_IMPACT_DEPTH}.`,
            );
            maxDepth = SAFE_IMPACT_DEPTH;
          }
          if (risk.largeGraph && maxModules > 0) {
            warnings.push(
              `CPU-risk guard: graph has ${risk.status.edgeCount} edge(s); ` +
                "module summaries were requested but may be skipped for large graphs.",
            );
          }
        }
        const result = await generateGraphReviewAnalysis({
          repoRoot: repoRoot(),
          workflow: options.workflow,
          base: options.base,
          changedFiles: options.files ? splitFiles(options.files) : undefined,
          maxDepth,
          maxNodes: options.maxNodes,
          maxFiles: options.maxFiles,
          maxHints: options.maxHints,
          maxModules,
          sessionDir: options.sessionDir,
          writeArtifacts: options.writeArtifacts,
        });
        const guardedResult = withWarnings(result, warnings);
        if (options.json) printJson(guardedResult);
        else printReviewAnalysis(guardedResult);
      } catch (error) {
        fail(error);
      }
    },
  );

const reviewContextCommand = new Command("review-context")
  .description("Generate bounded source snippets for graph-guided review")
  .requiredOption("--workflow <workflow>", "Workflow type (review or map)", parseWorkflow)
  .option("--base <ref>", "Git base ref for changed files")
  .option("--files <files>", "Comma-separated changed files")
  .option("--depth <number>", "Impact traversal depth", parseInteger, 2)
  .option("--max-files <number>", "Maximum files with snippets", parseInteger, 6)
  .option("--max-snippets <number>", "Maximum snippets", parseInteger, 12)
  .option("--max-lines-per-snippet <number>", "Maximum lines per snippet", parseInteger, 40)
  .option("--max-chars <number>", "Maximum snippet characters", parseInteger, 16000)
  .option("--max-suggestions <number>", "Maximum next tool suggestions", parseInteger, 4)
  .option("--json", "Print JSON output")
  .action(
    async (options: {
      workflow: GraphWorkflow;
      base?: string;
      files?: string;
      depth: number;
      maxFiles: number;
      maxSnippets: number;
      maxLinesPerSnippet: number;
      maxChars: number;
      maxSuggestions: number;
      json?: boolean;
    }) => {
      try {
        const result = await generateGraphReviewContext({
          repoRoot: repoRoot(),
          workflow: options.workflow,
          base: options.base,
          changedFiles: options.files ? splitFiles(options.files) : undefined,
          maxDepth: options.depth,
          maxFiles: options.maxFiles,
          maxSnippets: options.maxSnippets,
          maxLinesPerSnippet: options.maxLinesPerSnippet,
          maxChars: options.maxChars,
          maxSuggestions: options.maxSuggestions,
          writeArtifacts: false,
        });
        if (options.json) printJson(result);
        else printReviewContext(result);
      } catch (error) {
        fail(error);
      }
    },
  );

export const graphCommand = new Command("graph")
  .description("Build, update, query, and render OCR code graph context")
  .addCommand(statusCommand)
  .addCommand(buildCommand)
  .addCommand(updateCommand)
  .addCommand(queryCommand)
  .addCommand(impactCommand)
  .addCommand(contextCommand)
  .addCommand(searchCommand)
  .addCommand(minimalContextCommand)
  .addCommand(reviewAnalysisCommand)
  .addCommand(reviewContextCommand);
