import { useMemo, useState } from 'react'
import { AlertTriangle, FileSearch, Network, Scissors } from 'lucide-react'
import { GraphContextCard } from './graph-context-card'
import {
  useGraphContextArtifact,
  useGraphMinimalContext,
  useGraphMinimalContextArtifact,
  useGraphReviewAnalysis,
  useGraphReviewAnalysisArtifact,
  useGraphReviewContext,
  useGraphReviewContextArtifact,
  useGraphSearch,
} from './use-graph'
import { cn } from '../../lib/utils'
import type {
  GraphMinimalContext,
  GraphNextToolSuggestion,
  GraphReviewAnalysis,
  GraphReviewAnalysisHint,
  GraphReviewContext,
  SessionSummary,
} from '../../lib/api-types'

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

function artifactMinimalContext(content: string | undefined): GraphMinimalContext | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as Partial<GraphMinimalContext>
    return parsed && typeof parsed.summary === 'string' && parsed.counts ? parsed as GraphMinimalContext : null
  } catch {
    return null
  }
}

function artifactReviewContext(content: string | undefined): GraphReviewContext | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as Partial<GraphReviewContext>
    return parsed && typeof parsed.summary === 'string' && Array.isArray(parsed.snippets) ? parsed as GraphReviewContext : null
  } catch {
    return null
  }
}

function SuggestionsList({ suggestions }: { suggestions: GraphNextToolSuggestion[] }) {
  if (suggestions.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No next tool suggestions yet.</p>
  }
  return (
    <div className="space-y-2">
      {suggestions.slice(0, 5).map((suggestion) => (
        <div key={suggestion.command} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-xs font-medium',
              suggestion.priority === 'high'
                ? 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
                : suggestion.priority === 'medium'
                  ? 'border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                  : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300',
            )}>
              {suggestion.priority}
            </span>
            <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
              {suggestion.command}
            </code>
          </div>
          <p className="mt-2 text-zinc-700 dark:text-zinc-300">{suggestion.reason}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{suggestion.evidenceRequirement}</p>
        </div>
      ))}
    </div>
  )
}

export function GraphExplorationPanel({ session, initialQuery = '' }: GraphExplorationPanelProps) {
  const workflow: 'map' | 'review' = session.workflow_type === 'map' && !session.has_review ? 'map' : 'review'
  const [query, setQuery] = useState(initialQuery)
  const [reanalyzeRequested, setReanalyzeRequested] = useState(false)
  const [includeModuleSummaries, setIncludeModuleSummaries] = useState(false)
  const [reviewContextRequested, setReviewContextRequested] = useState(false)
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null)
  const trimmedQuery = query.trim()

  const graphContextArtifact = useGraphContextArtifact(session.id)
  const graphMinimalContextArtifact = useGraphMinimalContextArtifact(session.id)
  const graphReviewAnalysisArtifact = useGraphReviewAnalysisArtifact(session.id)
  const graphReviewContextArtifact = useGraphReviewContextArtifact(session.id)
  const liveMinimalContext = useGraphMinimalContext({
    workflow,
    maxDepth: 2,
    maxFiles: 12,
    maxHints: 4,
    maxPriorities: 5,
    maxWarnings: 5,
    maxSuggestions: 5,
    enabled: true,
  })
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
  const liveReviewContext = useGraphReviewContext({
    workflow,
    maxDepth: 2,
    maxNodes: 60,
    maxFiles: 6,
    maxSnippets: 8,
    maxLinesPerSnippet: 40,
    maxChars: 12000,
    maxSuggestions: 4,
    enabled: reviewContextRequested,
  })
  const search = useGraphSearch(trimmedQuery, 10)
  const minimalContext = liveMinimalContext.data ?? artifactMinimalContext(graphMinimalContextArtifact.data?.content)
  const reviewContext = liveReviewContext.data ?? artifactReviewContext(graphReviewContextArtifact.data?.content)

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Minimal graph context</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Summary-first graph signal for low-token review routing.
            </p>
          </div>
          {minimalContext && <StatusPill status={minimalContext.status} />}
        </div>
        {liveMinimalContext.isLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading minimal graph context…</p>
        ) : liveMinimalContext.isError && !minimalContext ? (
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load minimal graph context.</p>
        ) : minimalContext ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{minimalContext.summary}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SectionTitle>Risk</SectionTitle>
                <div className="text-lg font-semibold capitalize text-zinc-900 dark:text-zinc-100">
                  {minimalContext.risk.level} ({minimalContext.risk.score.toFixed(2)})
                </div>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SectionTitle>Changed</SectionTitle>
                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{minimalContext.counts.changedFiles}</div>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SectionTitle>Symbols</SectionTitle>
                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{minimalContext.counts.changedSymbols}</div>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SectionTitle>Impacted</SectionTitle>
                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{minimalContext.counts.impactedFiles}</div>
              </div>
              <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <SectionTitle>Test gaps</SectionTitle>
                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{minimalContext.counts.testGaps}</div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <SectionTitle>Top priorities</SectionTitle>
                <BulletList
                  items={minimalContext.topPriorities.map((priority) => `${priority.qualifiedName} (${priority.filePath}) — ${priority.reason}`)}
                  empty="No top priorities yet."
                />
              </div>
              <div>
                <SectionTitle>Next tool suggestions</SectionTitle>
                <SuggestionsList suggestions={minimalContext.nextToolSuggestions} />
              </div>
            </div>
            {minimalContext.warnings.length > 0 && (
              <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <BulletList items={minimalContext.warnings} empty="" />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No minimal graph context is available yet.</p>
        )}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <Scissors className="mt-0.5 h-4 w-4 text-zinc-400" />
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Bounded review context</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Fetch small source snippets for graph-guided verification instead of reading whole files.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setReviewContextRequested(true)
              void liveReviewContext.refetch()
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Load review context
          </button>
        </div>
        {liveReviewContext.isLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading bounded review snippets…</p>
        ) : liveReviewContext.isError && !reviewContext ? (
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load bounded review context.</p>
        ) : reviewContext ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={reviewContext.status} />
              <span className="text-zinc-600 dark:text-zinc-300">{reviewContext.summary}</span>
              {reviewContext.budget.truncated && (
                <span className="rounded-full border border-yellow-500/25 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                  truncated
                </span>
              )}
            </div>
            <p className="rounded-md border border-blue-500/25 bg-blue-500/10 p-3 text-sm text-blue-800 dark:text-blue-200">
              Snippets are investigation helpers only. Findings still need source, diff, test, or runtime evidence.
            </p>
            {reviewContext.snippets.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No snippets returned for this scope.</p>
            ) : (
              <div className="space-y-3">
                {reviewContext.snippets.slice(0, 6).map((snippet) => (
                  <div key={`${snippet.filePath}:${snippet.lineStart}-${snippet.lineEnd}:${snippet.kind}`} className="rounded-md border border-zinc-200 dark:border-zinc-800">
                    <div className="border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {snippet.filePath}:{snippet.lineStart}-{snippet.lineEnd}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {snippet.kind.replaceAll('_', ' ')} · {snippet.qualifiedNames.join(', ')}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{snippet.reason}</div>
                    </div>
                    <pre className="max-h-64 overflow-auto bg-zinc-50 p-3 text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                      {snippet.text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
            {reviewContext.omittedFiles.length > 0 && (
              <div>
                <SectionTitle>Omitted files</SectionTitle>
                <BulletList
                  items={reviewContext.omittedFiles.map((file) => `${file.filePath} — ${file.reason}`)}
                  empty="No omitted files."
                />
              </div>
            )}
            {reviewContext.warnings.length > 0 && (
              <div className="rounded-md border border-yellow-500/25 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                <BulletList items={reviewContext.warnings} empty="" />
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Click Load review context when a graph suggestion needs source verification.
          </p>
        )}
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
