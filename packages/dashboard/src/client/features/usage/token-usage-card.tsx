import { Coins } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TokenUsageSummary } from '../../lib/api-types'

type TokenUsageCardProps = {
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

export function TokenUsageCard({ summary, isLoading, error }: TokenUsageCardProps) {
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
    </div>
  )
}
