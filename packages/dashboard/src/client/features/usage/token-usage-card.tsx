import { Coins, GitCompareArrows } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { TokenUsageSummary, UsageComparison, UsageMetricDelta } from '../../lib/api-types'
import { useUsageComparison } from './use-token-usage'

type TokenUsageCardProps = {
  workflowId?: string
  summary?: TokenUsageSummary
  isLoading?: boolean
  error?: unknown
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCost(value: number | null): string {
  return value === null ? 'Not recorded' : `$${value.toFixed(6)}`
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  )
}

function formatDelta(delta: UsageMetricDelta | undefined): string {
  if (!delta || delta.absolute === null) return 'n/a'
  const sign = delta.absolute > 0 ? '+' : ''
  const percent = delta.percent === null ? '' : ` (${sign}${(delta.percent * 100).toFixed(1)}%)`
  return `${sign}${formatNumber(delta.absolute)}${percent}`
}

function CompareResult({ comparison }: { comparison: UsageComparison }) {
  const broadBaseline =
    comparison.baseline.telemetry.readCalls +
    comparison.baseline.telemetry.grepCalls +
    comparison.baseline.telemetry.bashCalls
  const broadCandidate =
    comparison.candidate.telemetry.readCalls +
    comparison.candidate.telemetry.grepCalls +
    comparison.candidate.telemetry.bashCalls
  return (
    <div className="mt-5 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-zinc-400" />
        <div>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Usage comparison
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {comparison.baseline.workflow_id} {'->'} {comparison.candidate.workflow_id}
          </div>
        </div>
      </div>
      <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
        {comparison.verdict.summary}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total delta" value={formatDelta(comparison.delta.total_tokens)} />
        <Metric label="Input delta" value={formatDelta(comparison.delta.input_tokens)} />
        <Metric label="Output delta" value={formatDelta(comparison.delta.output_tokens)} />
        <Metric label="Graph calls" value={formatDelta(comparison.delta.graphCalls)} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Broad exploration
          </div>
          <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
            {broadBaseline} {'->'} {broadCandidate} calls
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Read + Grep + Bash
          </div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Evidence quality
          </div>
          <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
            {comparison.caveats.length === 0 ? 'No caveats' : `${comparison.caveats.length} caveat(s)`}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Missing rows or telemetry prevent strong claims.
          </div>
        </div>
      </div>
      {comparison.caveats.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
          {comparison.caveats.map((caveat) => (
            <li key={caveat}>- {caveat}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TokenUsageShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-zinc-400" />
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Token Usage
        </h2>
      </div>
      {children}
    </div>
  )
}

export function TokenUsageCard({ workflowId = '', summary, isLoading, error }: TokenUsageCardProps) {
  const [baselineId, setBaselineId] = useState('')
  const comparison = useUsageComparison(workflowId, baselineId)
  if (isLoading) {
    return (
      <TokenUsageShell>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Loading token usage...
        </p>
      </TokenUsageShell>
    )
  }

  if (error) {
    return (
      <TokenUsageShell>
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          Failed to load token usage. Refresh the page or check the dashboard server logs.
        </p>
      </TokenUsageShell>
    )
  }

  if (!summary) {
    return (
      <TokenUsageShell>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Token usage is not available for this workflow yet.
        </p>
      </TokenUsageShell>
    )
  }

  if (summary.row_count === 0) {
    return (
      <TokenUsageShell>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          No token usage has been recorded for this workflow yet.
        </p>
      </TokenUsageShell>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Token Usage
          </h2>
        </div>
        <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          {summary.row_count} record{summary.row_count === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total" value={formatNumber(summary.total_tokens)} />
        <Metric label="Input" value={formatNumber(summary.input_tokens)} />
        <Metric label="Output" value={formatNumber(summary.output_tokens)} />
        <Metric label="Cost" value={formatCost(summary.cost_usd)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Cache read" value={formatNumber(summary.cache_read_tokens)} />
        <Metric label="Cache write" value={formatNumber(summary.cache_write_tokens)} />
        <Metric label="Reasoning" value={formatNumber(summary.reasoning_tokens)} />
      </div>

      {summary.by_agent.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            By agent
          </div>
          <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {summary.by_agent.slice(0, 8).map((agent) => {
              const label = agent.name ?? agent.agent_session_id ?? 'workflow'
              return (
                <div key={`${label}-${agent.model ?? 'default'}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                      {label}
                    </div>
                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {agent.model ?? '(default model)'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-zinc-700 dark:text-zinc-300">
                    <div>{formatNumber(agent.total_tokens)}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatCost(agent.cost_usd)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-zinc-400" />
          <div>
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Compare against baseline
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Enter a baseline workflow id to verify token and exploration changes.
            </div>
          </div>
        </div>
        <input
          value={baselineId}
          onChange={(event) => setBaselineId(event.target.value)}
          placeholder="baseline workflow id"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
        {baselineId.trim().length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            No comparison loaded. This avoids guessing a baseline and overstating token savings.
          </p>
        ) : comparison.isLoading ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Loading usage comparison...</p>
        ) : comparison.isError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Failed to compare usage. Check that the baseline workflow exists.
          </p>
        ) : comparison.data ? (
          <CompareResult comparison={comparison.data} />
        ) : null}
      </div>
    </div>
  )
}
