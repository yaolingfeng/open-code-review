import type { Database } from "sql.js";
import { compareWorkflowUsage, type UsageComparison } from "./usage-compare.js";

export type UsageBenchmarkPair = {
  baseline: string;
  candidate: string;
};

export type UsageBenchmarkThresholds = {
  minTotalTokenReductionPct: number;
  minBroadCallReductionPct: number;
};

export type UsageBenchmarkRun = {
  index: number;
  baseline: string;
  candidate: string;
  comparison: UsageComparison;
  totalTokenDeltaPct: number | null;
  broadCallDeltaPct: number | null;
  graphCallDelta: number | null;
  caveats: string[];
};

export type UsageBenchmarkQualityGate = {
  status: "pass" | "unknown";
  checklist: string[];
};

export type UsageBenchmarkResult = {
  pairs: UsageBenchmarkPair[];
  thresholds: UsageBenchmarkThresholds;
  runs: UsageBenchmarkRun[];
  medians: {
    totalTokenDeltaPct: number | null;
    broadCallDeltaPct: number | null;
    graphCallDelta: number | null;
  };
  qualityGate: UsageBenchmarkQualityGate;
  verdict: {
    status: "passed" | "failed" | "inconclusive";
    summary: string;
    caveats: string[];
  };
};

const DEFAULT_QUALITY_CHECKLIST = [
  "blocker/should-fix findings 未减少，且没有遗漏 baseline 中确认有效的关键问题。",
  "每条 finding 仍引用源码、diff、测试、运行日志或复现证据，不能只引用 graph signal。",
  "review 覆盖 changed files、top impacted symbols、test gaps 和高风险调用链。",
  "若 candidate token 明显下降，人工抽查确认不是因为 reviewer 提前停止调查或跳过证据收集。",
];

export function benchmarkWorkflowUsage(
  db: Database,
  ocrDir: string,
  pairs: UsageBenchmarkPair[],
  options: {
    minTotalTokenReductionPct?: number;
    minBroadCallReductionPct?: number;
    qualityPass?: boolean;
    qualityChecklist?: string[];
  } = {},
): UsageBenchmarkResult {
  const thresholds: UsageBenchmarkThresholds = {
    minTotalTokenReductionPct: options.minTotalTokenReductionPct ?? 0.1,
    minBroadCallReductionPct: options.minBroadCallReductionPct ?? 0.2,
  };
  const runs = pairs.map((pair, index) => {
    const comparison = compareWorkflowUsage(db, ocrDir, pair.baseline, pair.candidate);
    return {
      index: index + 1,
      baseline: pair.baseline,
      candidate: pair.candidate,
      comparison,
      totalTokenDeltaPct: comparison.delta.total_tokens.percent,
      broadCallDeltaPct: broadCallDelta(comparison),
      graphCallDelta: comparison.delta.graphCalls.absolute,
      caveats: comparison.caveats,
    };
  });
  const medians = {
    totalTokenDeltaPct: medianNullable(runs.map((run) => run.totalTokenDeltaPct)),
    broadCallDeltaPct: medianNullable(runs.map((run) => run.broadCallDeltaPct)),
    graphCallDelta: medianNullable(runs.map((run) => run.graphCallDelta)),
  };
  const qualityGate: UsageBenchmarkQualityGate = {
    status: options.qualityPass ? "pass" : "unknown",
    checklist: options.qualityChecklist?.length ? options.qualityChecklist : DEFAULT_QUALITY_CHECKLIST,
  };
  const caveats = benchmarkCaveats(runs, medians, qualityGate, thresholds);
  const status = caveats.length > 0 ? "inconclusive" : "passed";

  return {
    pairs,
    thresholds,
    runs,
    medians,
    qualityGate,
    verdict: {
      status,
      summary: benchmarkSummary(status, medians, thresholds),
      caveats,
    },
  };
}

function broadCallDelta(comparison: UsageComparison): number | null {
  const baseline = broadExplorationCalls(comparison.baseline.telemetry);
  const candidate = broadExplorationCalls(comparison.candidate.telemetry);
  if (baseline === null || candidate === null || baseline === 0) return null;
  return (candidate - baseline) / baseline;
}

function broadExplorationCalls(telemetry: UsageComparison["baseline"]["telemetry"]): number {
  return Math.max(0, telemetry.readCalls + telemetry.grepCalls + telemetry.bashCalls - telemetry.graphCalls);
}

function medianNullable(values: Array<number | null>): number | null {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function benchmarkCaveats(
  runs: UsageBenchmarkRun[],
  medians: UsageBenchmarkResult["medians"],
  qualityGate: UsageBenchmarkQualityGate,
  thresholds: UsageBenchmarkThresholds,
): string[] {
  const caveats: string[] = [];
  if (runs.length < 3) {
    caveats.push("benchmark runs 少于 3 组；建议使用 3-5 组同 diff、同 model、同 reviewer team 的配对样本。");
  }
  for (const run of runs) {
    for (const caveat of run.caveats) {
      caveats.push(`run ${run.index}: ${caveat}`);
    }
  }
  if (medians.totalTokenDeltaPct === null) {
    caveats.push("无法计算 total token 中位数变化；不得宣称 token efficiency 改善。");
  } else if (medians.totalTokenDeltaPct > -thresholds.minTotalTokenReductionPct) {
    caveats.push(`median total token reduction 未达到 ${(thresholds.minTotalTokenReductionPct * 100).toFixed(1)}% 阈值。`);
  }
  if (medians.broadCallDeltaPct === null) {
    caveats.push("无法计算 broad exploration 调用中位数变化；不得宣称盲搜减少。");
  } else if (medians.broadCallDeltaPct > -thresholds.minBroadCallReductionPct) {
    caveats.push(`median Read/Grep/Bash reduction 未达到 ${(thresholds.minBroadCallReductionPct * 100).toFixed(1)}% 阈值。`);
  }
  if (qualityGate.status !== "pass") {
    caveats.push("质量门禁未标记为通过；token 降低不能单独视为成功。");
  }
  return caveats;
}

function benchmarkSummary(
  status: UsageBenchmarkResult["verdict"]["status"],
  medians: UsageBenchmarkResult["medians"],
  thresholds: UsageBenchmarkThresholds,
): string {
  if (status === "passed") {
    return `Benchmark passed: median total tokens and Read/Grep/Bash calls both improved beyond configured thresholds (${formatPct(-thresholds.minTotalTokenReductionPct)}, ${formatPct(-thresholds.minBroadCallReductionPct)}), with quality gate passed.`;
  }
  return `Benchmark is inconclusive: median total token delta=${formatPct(medians.totalTokenDeltaPct)}, median broad exploration delta=${formatPct(medians.broadCallDeltaPct)}. Review caveats before claiming graph efficiency gains.`;
}

export function formatBenchmarkPercent(value: number | null): string {
  return formatPct(value);
}

function formatPct(value: number | null): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}
