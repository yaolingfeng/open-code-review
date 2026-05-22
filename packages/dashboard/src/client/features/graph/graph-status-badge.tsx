import { Network } from 'lucide-react'
import { useGraphStatus } from './use-graph'

const STATUS_STYLES: Record<string, string> = {
  ready: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  missing: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  stale: 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  degraded: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  error: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
  building: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
}

export function GraphStatusBadge() {
  const { data } = useGraphStatus()
  const status = data?.status ?? 'missing'
  const className = STATUS_STYLES[status] ?? STATUS_STYLES['missing']

  return (
    <span
      title={data ? `${data.indexedFileCount} indexed files, ${data.unsupportedFileCount} unsupported files` : 'Graph status unavailable'}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <Network className="h-3 w-3" />
      Graph {status}
    </span>
  )
}
