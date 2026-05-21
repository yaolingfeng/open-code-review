import { useMemo, useState } from 'react'
import { AlertTriangle, FileSearch, Network } from 'lucide-react'
import { GraphContextCard } from './graph-context-card'
import { useGraphContextArtifact, useGraphReviewAnalysis, useGraphReviewAnalysisArtifact, useGraphSearch } from './use-graph'
import { cn } from '../../lib/utils'
import type { GraphReviewAnalysis, GraphReviewAnalysisHint, SessionSummary } from '../../lib/api-types'

type GraphExplorationPanelProps = {
  session: SessionSummary
  initialQuery?: string
}

const STATUS_STYLES: Record<string, string> = {
  ready: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  missing: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  stale: 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  degraded: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  error: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
  building: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
      STATUS_STYLES[status] ?? STATUS_STYLES.missing,
    )}>
      {status}
    </span>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {children}
    </div>
  )
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
  }

  return (
    <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
      {items.map((item) => (
        <li key={item} className="break-words">- {item}</li>
      ))}
    </ul>
  )
}

function hintTone(hint: GraphReviewAnalysisHint) {
  if (hint.severity === 'high') return 'text-red-700 dark:text-red-300'
  if (hint.severity === 'warning') return 'text-yellow-700 dark:text-yellow-300'
  return 'text-zinc-700 dark:text-zinc-300'
}

function prettyArtifact(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

function artifactAnalysis(content: string | undefined): GraphReviewAnalysis | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as Partial<GraphReviewAnalysis>;
    return parsed && typeof parsed.summary === 'string' && parsed.sourceScope ? parsed as GraphReviewAnalysis : null;
  } catch {
    return null;
  }
}

export function GraphExplorationPanel({ session, initialQuery = '' }: GraphExplorationPanelProps) {
  const workflow: 'map' | 'review' = session.workflow_type === 'map' && !session.has_review ? 'map' : 'review'
  const [query, setQuery] = useState(initialQuery)
  const [reanalyzeRequested, setReanalyzeRequested] = useState(false)
  const [includeModuleSummaries, setIncludeModuleSummaries] = useState(false)
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null)
  const trimmedQuery = query.trim()

  const graphContextArtifact = useGraphContextArtifact(session.id)
  const graphReviewAnalysisArtifact = useGraphReviewAnalysisArtifact(session.id)
  const liveAnalysis = useGraphReviewAnalysis({
    workflow,
    sessionDir: session.session_dir,
    maxDepth: 3,
    maxNodes: 60,
    maxFiles: 20,
    maxHints: 6,
    maxModules: includeModuleSummaries ? 3 : 0,
    enabled: reanalyzeRequested,
  })
  const search = useGraphSearch(trimmedQuery, 10)

  const analysisWarnings = useMemo(() => {
    const warnings = new Set<string>()
    for (const warning of liveAnalysis.data?.warnings ?? []) warnings.add(warning)
    return [...warnings]
  }, [liveAnalysis.data?.warnings])

  return (
    <div className="space-y-6 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-zinc-400" />
          <div>
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Graph Exploration</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Search indexed symbols and inspect graph-native review signals.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveAnalysis.isFetching ? (
            <button
              type="button"
              onClick={() => {
                void liveAnalysis.cancel?.()
                setReanalyzeRequested(false)
                setAnalysisNotice('Graph analysis cancelled. The server stops the underlying worker when the request is aborted.')
              }}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Cancel analysis
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAnalysisNotice(null)
                setReanalyzeRequested(true)
                void liveAnalysis.refetch()
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Reanalyze graph
            </button>
          )}
        </div>
        {liveAnalysis.data && <StatusPill status={liveAnalysis.data.status} />}
      </div>

      {analysisNotice && (
        <div className="rounded-md border border-blue-500/25 bg-blue-500/10 p-3 text-sm text-blue-800 dark:text-blue-200">
          {analysisNotice}
        </div>
      )}

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
        <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={includeModuleSummaries}
            onChange={(event) => setIncludeModuleSummaries(event.target.checked)}
            disabled={liveAnalysis.isFetching}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Advanced: include module summaries</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Off by default for large repositories. Enabling this requests up to 3 module summaries; the server may still downgrade on high CPU risk.
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <SectionTitle>Workflow</SectionTitle>
          <div className="text-lg font-semibold capitalize text-zinc-900 dark:text-zinc-100">{workflow}</div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <SectionTitle>Changed files</SectionTitle>
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {liveAnalysis.data?.sourceScope.changedFileCount ?? artifactAnalysis(graphReviewAnalysisArtifact.data?.content)?.sourceScope.changedFileCount ?? '—'}
          </div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <SectionTitle>Precision</SectionTitle>
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {liveAnalysis.data?.sourceScope.changedSymbolPrecision ?? artifactAnalysis(graphReviewAnalysisArtifact.data?.content)?.sourceScope.changedSymbolPrecision ?? '—'}
          </div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <SectionTitle>Generated</SectionTitle>
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {liveAnalysis.data?.generatedAt
              ? new Date(liveAnalysis.data.generatedAt).toLocaleString()
              : artifactAnalysis(graphReviewAnalysisArtifact.data?.content)?.generatedAt
                ? new Date(artifactAnalysis(graphReviewAnalysisArtifact.data?.content)!.generatedAt).toLocaleString()
                : 'Not available'}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Graph Search</h3>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search symbol, qualified name, path, kind, or signature"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
        {trimmedQuery.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Enter a query to search the graph index.
          </p>
        ) : search.isLoading ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Searching graph…</p>
        ) : search.isError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">Failed to search graph.</p>
        ) : search.data ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <StatusPill status={search.data.status} />
              <span>{search.data.summary}</span>
              <span>Limit {search.data.limit}</span>
            </div>
            {search.data.results.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No graph matches found.</p>
            ) : (
              <div className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {search.data.results.map((item) => (
                  <div key={`${item.entityType}-${item.qualifiedName}-${item.filePath}`} className="px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{item.qualifiedName}</div>
                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                        {item.kind}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.filePath}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Matches: {item.matchTypes.join(', ')}{item.score === undefined ? '' : ` · score ${item.score.toFixed(2)}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {search.data.warnings.length > 0 && (
              <BulletList items={search.data.warnings} empty="" />
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Review analysis</h3>
          {liveAnalysis.data && <StatusPill status={liveAnalysis.data.status} />}
        </div>
        {!reanalyzeRequested && !liveAnalysis.data ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Saved graph analysis is shown below when available. Click Reanalyze graph to run fresh analysis.
          </p>
        ) : liveAnalysis.isLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading review analysis…</p>
        ) : liveAnalysis.isError ? (
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load graph review analysis.</p>
        ) : liveAnalysis.data ? (
          <div className="space-y-5">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{liveAnalysis.data.summary}</p>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <SectionTitle>Priorities</SectionTitle>
                <BulletList
                  items={liveAnalysis.data.priorities.map((priority) => `${priority.qualifiedName} (${priority.filePath}, score ${priority.score}) — ${priority.reason}`)}
                  empty="No priority signals yet."
                />
              </div>
              <div>
                <SectionTitle>Impacted files</SectionTitle>
                <BulletList
                  items={liveAnalysis.data.drilldown.impactedFiles}
                  empty="No impacted files recorded."
                />
              </div>
              <div>
                <SectionTitle>Test gaps</SectionTitle>
                <BulletList
                  items={liveAnalysis.data.drilldown.testGaps.map((gap) => `${gap.qualifiedName} (${gap.filePath}:${gap.lineStart}) — ${gap.reason}`)}
                  empty="No graph test gaps detected."
                />
              </div>
              <div>
                <SectionTitle>Unsupported files</SectionTitle>
                <BulletList
                  items={liveAnalysis.data.drilldown.unsupportedChangedFiles}
                  empty="No unsupported changed files."
                />
              </div>
            </div>

            <div>
              <SectionTitle>Hints</SectionTitle>
              {liveAnalysis.data.hints.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No reviewer hints yet.</p>
              ) : (
                <div className="space-y-2">
                  {liveAnalysis.data.hints.map((hint) => (
                    <div key={`${hint.kind}-${hint.message}`} className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <div className={cn('text-sm font-medium capitalize', hintTone(hint))}>
                        {hint.kind.replaceAll('_', ' ')} · {hint.severity}
                      </div>
                      <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{hint.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <SectionTitle>Modules</SectionTitle>
              {liveAnalysis.data.modules.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No module summaries yet.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {liveAnalysis.data.modules.map((module) => (
                    <div key={module.name} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{module.name}</div>
                      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{module.summary}</p>
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {module.changedFiles.length} changed file(s) · {module.impactedFiles.length} impacted file(s) · {module.crossModuleEdgeCount} cross-module edge(s)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(analysisWarnings.length > 0 || liveAnalysis.data.truncated) && (
              <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Analysis notices
                </div>
                {analysisWarnings.length > 0 && <BulletList items={analysisWarnings} empty="" />}
                {liveAnalysis.data.truncated && (
                  <p className="mt-2">Result truncated; narrow the scope or raise limits in a future query surface.</p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {graphReviewAnalysisArtifact.data?.content && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
            Raw graph-review-analysis.json
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            {prettyArtifact(graphReviewAnalysisArtifact.data.content)}
          </pre>
        </details>
      )}

      {graphContextArtifact.data?.content && (
        <GraphContextCard content={graphContextArtifact.data.content} />
      )}

      {!graphContextArtifact.data?.content && !graphReviewAnalysisArtifact.data?.content && (
        <div className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No saved graph artifacts yet. Live graph search and review analysis remain available when the graph database exists.
        </div>
      )}
    </div>
  )
}
