import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphContextCard } from '../graph-context-card'
import { GraphExplorationPanel } from '../graph-exploration-panel'
import { GraphStatusBadge } from '../graph-status-badge'

const useGraphStatusMock = vi.hoisted(() => vi.fn())
const useGraphSearchMock = vi.hoisted(() => vi.fn())
const useGraphReviewAnalysisMock = vi.hoisted(() => vi.fn())
const useGraphContextArtifactMock = vi.hoisted(() => vi.fn())
const useGraphReviewAnalysisArtifactMock = vi.hoisted(() => vi.fn())

vi.mock('../use-graph', () => ({
  useGraphStatus: useGraphStatusMock,
  useGraphSearch: useGraphSearchMock,
  useGraphReviewAnalysis: useGraphReviewAnalysisMock,
  useGraphContextArtifact: useGraphContextArtifactMock,
  useGraphReviewAnalysisArtifact: useGraphReviewAnalysisArtifactMock,
}))

describe('graph UI components', () => {
  beforeEach(() => {
    useGraphStatusMock.mockReset()
    useGraphSearchMock.mockReset()
    useGraphReviewAnalysisMock.mockReset()
    useGraphContextArtifactMock.mockReset()
    useGraphReviewAnalysisArtifactMock.mockReset()

    useGraphSearchMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    })
    useGraphReviewAnalysisMock.mockReturnValue({
      data: {
        status: 'ready',
        summary: 'Review the auth login path first.',
        changedSymbols: [],
        priorities: [
          {
            qualifiedName: 'src/auth.ts::login',
            filePath: 'src/auth.ts',
            reason: 'Changed symbol touches the main auth flow.',
            score: 80,
          },
        ],
        hints: [
          {
            kind: 'review_order',
            severity: 'info',
            message: 'Start with src/auth.ts::login before inspecting downstream consumers.',
            filePaths: ['src/auth.ts'],
            qualifiedNames: ['src/auth.ts::login'],
          },
        ],
        modules: [
          {
            name: 'src/auth',
            changedFiles: ['src/auth.ts'],
            impactedFiles: ['src/auth.ts', 'src/user.ts'],
            changedSymbolCount: 1,
            impactedSymbolCount: 2,
            crossModuleEdgeCount: 1,
            bridgeFiles: ['src/auth.ts'],
            bridgeQualifiedNames: ['src/auth.ts::login'],
            summary: 'Auth changes cross into the user model.',
          },
        ],
        drilldown: {
          impactedFiles: ['src/auth.ts', 'src/user.ts'],
          impactedNodes: [],
          flows: [],
          testGaps: [
            {
              qualifiedName: 'src/auth.ts::login',
              filePath: 'src/auth.ts',
              lineStart: 10,
              kind: 'no_test_edge_for_changed_function',
              severity: 'medium',
              reason: 'Changed function has no TESTED_BY edge in graph.',
            },
          ],
          unsupportedChangedFiles: [],
        },
        warnings: [],
        truncated: false,
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceScope: {
          workflow: 'review',
          changedFileCount: 1,
          changedSymbolPrecision: 'symbol',
        },
      },
      isLoading: false,
      isError: false,
    })
    useGraphContextArtifactMock.mockReturnValue({
      data: {
        content: '# Graph Context\n\nRisk: medium (0.42)\n\n## Impacted Files\n\n- src/auth.ts',
      },
    })
    useGraphReviewAnalysisArtifactMock.mockReturnValue({
      data: {
        content: '{"status":"ready","summary":"saved"}',
      },
    })
  })

  it('renders graph status badge states with indexed and unsupported counts', () => {
    useGraphStatusMock.mockReturnValue({
      data: {
        status: 'ready',
        dbPath: '/repo/.ocr/data/graph.db',
        indexedFileCount: 12,
        unsupportedFileCount: 2,
        nodeCount: 40,
        edgeCount: 50,
        languages: ['typescript'],
        warnings: [],
      },
    })

    const html = renderToStaticMarkup(<GraphStatusBadge />)

    expect(html).toContain('Graph ready')
    expect(html).toContain('12 indexed files, 2 unsupported files')
    expect(html).toContain('emerald')
  })

  it('renders degraded graph status with warning styling', () => {
    useGraphStatusMock.mockReturnValue({
      data: {
        status: 'degraded',
        dbPath: '/repo/.ocr/data/graph.db',
        indexedFileCount: 7,
        unsupportedFileCount: 1,
        nodeCount: 20,
        edgeCount: 25,
        languages: ['typescript'],
        warnings: ['Graph build is in progress; some graph results may be incomplete.'],
      },
    })

    const html = renderToStaticMarkup(<GraphStatusBadge />)

    expect(html).toContain('Graph degraded')
    expect(html).toContain('7 indexed files, 1 unsupported files')
    expect(html).toContain('yellow')
  })

  it('renders missing, stale, and building graph status badge variants', () => {
    useGraphStatusMock.mockReturnValueOnce({ data: undefined })
    const missingHtml = renderToStaticMarkup(<GraphStatusBadge />)
    expect(missingHtml).toContain('Graph missing')
    expect(missingHtml).toContain('Graph status unavailable')
    expect(missingHtml).toContain('amber')

    useGraphStatusMock.mockReturnValueOnce({
      data: {
        status: 'stale',
        dbPath: '/repo/.ocr/data/graph.db',
        indexedFileCount: 9,
        unsupportedFileCount: 3,
        nodeCount: 33,
        edgeCount: 41,
        languages: ['typescript'],
        warnings: ['Graph snapshot is older than the current workspace state.'],
      },
    })
    const staleHtml = renderToStaticMarkup(<GraphStatusBadge />)
    expect(staleHtml).toContain('Graph stale')
    expect(staleHtml).toContain('9 indexed files, 3 unsupported files')
    expect(staleHtml).toContain('orange')

    useGraphStatusMock.mockReturnValueOnce({
      data: {
        status: 'building',
        dbPath: '/repo/.ocr/data/graph.db',
        indexedFileCount: 5,
        unsupportedFileCount: 0,
        nodeCount: 10,
        edgeCount: 12,
        languages: ['typescript'],
        warnings: ['Graph rebuild is in progress.'],
      },
    })
    const buildingHtml = renderToStaticMarkup(<GraphStatusBadge />)
    expect(buildingHtml).toContain('Graph building')
    expect(buildingHtml).toContain('5 indexed files, 0 unsupported files')
    expect(buildingHtml).toContain('blue')
  })

  it('renders graph exploration panel with live analysis, artifacts, and search results', () => {
    useGraphSearchMock.mockReturnValue({
      data: {
        status: 'ready',
        query: 'login',
        summary: 'Found 1 graph match.',
        limit: 10,
        results: [
          {
            entityType: 'node',
            qualifiedName: 'src/auth.ts::login',
            filePath: 'src/auth.ts',
            name: 'login',
            kind: 'Function',
            language: 'typescript',
            matchTypes: ['name', 'qualified_name'],
            score: 0.91,
          },
        ],
        warnings: [],
        truncated: false,
      },
      isLoading: false,
      isError: false,
    })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-1',
          branch: 'feature/auth',
          status: 'running',
          workflow_type: 'review',
          current_phase: 'analysis',
          phase_number: 3,
          current_round: 1,
          current_map_run: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: true,
          has_map: false,
          review_phase_number: 3,
          review_phase: 'analysis',
          map_phase_number: 0,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
      />,
    )

    expect(html).toContain('Graph Exploration')
    expect(html).toContain('Search indexed symbols and inspect graph-native review signals.')
    expect(html).toContain('Graph Search')
    expect(html).toContain('Enter a query to search the graph index.')
    expect(html).toContain('Review analysis')
    expect(html).toContain('Review the auth login path first.')
    expect(html).toContain('Auth changes cross into the user model.')
    expect(html).toContain('Raw graph-review-analysis.json')
    expect(html).toContain('Raw graph-context.md')
    expect(html).toContain('Advanced: include module summaries')
    expect(html).toContain('Off by default for large repositories.')
    expect(useGraphReviewAnalysisMock).toHaveBeenLastCalledWith(expect.objectContaining({
      maxModules: 0,
    }))
  })

  it('renders a cancel affordance while graph review analysis is fetching', () => {
    useGraphReviewAnalysisMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      cancel: vi.fn(),
    })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-cancel',
          branch: 'feature/cancel',
          status: 'running',
          workflow_type: 'review',
          current_phase: 'analysis',
          phase_number: 3,
          current_round: 1,
          current_map_run: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: true,
          has_map: false,
          review_phase_number: 3,
          review_phase: 'analysis',
          map_phase_number: 0,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
      />,
    )

    expect(html).toContain('Cancel analysis')
    expect(html).toContain('Click Reanalyze graph to run fresh analysis.')
  })

  it('renders graph exploration analysis notices for warnings and truncation', () => {
    useGraphReviewAnalysisMock.mockReturnValue({
      data: {
        status: 'degraded',
        summary: 'Graph analysis is partially available.',
        changedSymbols: [],
        priorities: [],
        hints: [],
        modules: [],
        drilldown: {
          impactedFiles: [],
          impactedNodes: [],
          flows: [],
          testGaps: [],
          unsupportedChangedFiles: ['docs/review.md'],
        },
        warnings: ['Graph build is still catching up for some files.'],
        truncated: true,
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceScope: {
          workflow: 'review',
          changedFileCount: 2,
          changedSymbolPrecision: 'file',
        },
      },
      isLoading: false,
      isError: false,
    })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-3',
          branch: 'feature/degraded-graph',
          status: 'running',
          workflow_type: 'review',
          current_phase: 'analysis',
          phase_number: 3,
          current_round: 1,
          current_map_run: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: true,
          has_map: false,
          review_phase_number: 3,
          review_phase: 'analysis',
          map_phase_number: 0,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
      />,
    )

    expect(html).toContain('Graph analysis is partially available.')
    expect(html).toContain('Analysis notices')
    expect(html).toContain('Graph build is still catching up for some files.')
    expect(html).toContain('Result truncated; narrow the scope or raise limits in a future query surface.')
    expect(html).toContain('Unsupported files')
    expect(html).toContain('docs/review.md')
    expect(html).toContain('No priority signals yet.')
    expect(html).toContain('No reviewer hints yet.')
    expect(html).toContain('No module summaries yet.')
  })

  it('renders graph search loading, error, empty, and populated states', () => {
    const session = {
      id: 'session-search',
      branch: 'feature/search',
      status: 'running',
      workflow_type: 'review',
      current_phase: 'analysis',
      phase_number: 3,
      current_round: 1,
      current_map_run: 0,
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      has_review: true,
      has_map: false,
      review_phase_number: 3,
      review_phase: 'analysis',
      map_phase_number: 0,
      map_phase: 'topology',
      latest_verdict: null,
      latest_blocker_count: 0,
      latest_round_status: null,
    } as const

    useGraphSearchMock.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    const loadingHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} initialQuery="login" />,
    )
    expect(loadingHtml).toContain('Searching graph…')

    useGraphSearchMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    const errorHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} initialQuery="login" />,
    )
    expect(errorHtml).toContain('Failed to search graph.')

    useGraphSearchMock.mockReturnValueOnce({
      data: {
        status: 'ready',
        query: 'login',
        summary: 'No graph matches found.',
        limit: 10,
        results: [],
        warnings: ['Search limited to indexed symbols only.'],
        truncated: false,
      },
      isLoading: false,
      isError: false,
    })
    const emptyHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} initialQuery="login" />,
    )
    expect(emptyHtml).toContain('No graph matches found.')
    expect(emptyHtml).toContain('Search limited to indexed symbols only.')

    useGraphSearchMock.mockReturnValueOnce({
      data: {
        status: 'ready',
        query: 'login',
        summary: 'Found 1 graph match.',
        limit: 10,
        results: [
          {
            entityType: 'node',
            qualifiedName: 'src/auth.ts::login',
            filePath: 'src/auth.ts',
            name: 'login',
            kind: 'Function',
            language: 'typescript',
            matchTypes: ['name', 'qualified_name'],
            score: 0.91,
          },
        ],
        warnings: [],
        truncated: false,
      },
      isLoading: false,
      isError: false,
    })
    const resultHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} initialQuery="login" />,
    )
    expect(resultHtml).toContain('Found 1 graph match.')
    expect(resultHtml).toContain('src/auth.ts::login')
    expect(resultHtml).toContain('Matches: name, qualified_name · score 0.91')
  })

  it('keeps review analysis read-only until explicit reanalysis is requested', () => {
    const session = {
      id: 'session-analysis',
      branch: 'feature/analysis-states',
      status: 'running',
      workflow_type: 'review',
      current_phase: 'analysis',
      phase_number: 3,
      current_round: 1,
      current_map_run: 0,
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      has_review: true,
      has_map: false,
      review_phase_number: 3,
      review_phase: 'analysis',
      map_phase_number: 0,
      map_phase: 'topology',
      latest_verdict: null,
      latest_blocker_count: 0,
      latest_round_status: null,
    } as const

    useGraphReviewAnalysisMock.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    const loadingHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} />,
    )
    expect(useGraphReviewAnalysisMock).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      maxModules: 0,
    }))
    expect(loadingHtml).toContain('Saved graph analysis is shown below when available.')
    expect(loadingHtml).not.toContain('Loading review analysis…')

    useGraphReviewAnalysisMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    const errorHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} />,
    )
    expect(useGraphReviewAnalysisMock).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      maxModules: 0,
    }))
    expect(errorHtml).toContain('Saved graph analysis is shown below when available.')
    expect(errorHtml).not.toContain('Failed to load graph review analysis.')

    useGraphReviewAnalysisMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: false,
    })
    const missingHtml = renderToStaticMarkup(
      <GraphExplorationPanel session={session} />,
    )
    expect(missingHtml).toContain('Review analysis')
    expect(missingHtml).not.toContain('Loading review analysis…')
    expect(missingHtml).not.toContain('Failed to load graph review analysis.')
    expect(missingHtml).not.toContain('Review the auth login path first.')
  })

  it('renders graph exploration empty artifact state when saved artifacts are absent', () => {
    useGraphContextArtifactMock.mockReturnValue({ data: undefined })
    useGraphReviewAnalysisArtifactMock.mockReturnValue({ data: undefined })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-2',
          branch: 'feature/map',
          status: 'running',
          workflow_type: 'map',
          current_phase: 'topology',
          phase_number: 2,
          current_round: 0,
          current_map_run: 1,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: false,
          has_map: true,
          review_phase_number: 0,
          review_phase: 'context',
          map_phase_number: 2,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
      />,
    )

    expect(html).toContain('No saved graph artifacts yet.')
    expect(html).toContain('Workflow')
    expect(html).toContain('map')
  })


  it('renders saved and live review-analysis surfaces together when both are available', () => {
    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-both-analysis',
          branch: 'feature/both-analysis',
          status: 'running',
          workflow_type: 'review',
          current_phase: 'analysis',
          phase_number: 3,
          current_round: 1,
          current_map_run: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: true,
          has_map: false,
          review_phase_number: 3,
          review_phase: 'analysis',
          map_phase_number: 0,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
      />,
    )

    expect(html).toContain('Review the auth login path first.')
    expect(html).toContain('Auth changes cross into the user model.')
    expect(html).toContain('Raw graph-review-analysis.json')
    expect(html).toContain('saved')
    expect(html).not.toContain('No saved graph artifacts yet.')
  })

  it('renders map workflow analysis and search warnings together with empty artifact fallback', () => {
    useGraphSearchMock.mockReturnValue({
      data: {
        status: 'degraded',
        query: 'topology',
        summary: 'Found 0 graph matches.',
        limit: 10,
        results: [],
        warnings: ['Search results may be incomplete while the graph rebuild finishes.'],
        truncated: false,
      },
      isLoading: false,
      isError: false,
    })
    useGraphReviewAnalysisMock.mockReturnValue({
      data: {
        status: 'degraded',
        summary: 'Map analysis highlights cross-module handoffs first.',
        changedSymbols: [],
        priorities: [],
        hints: [
          {
            kind: 'boundary_crossing',
            severity: 'warning',
            message: 'Topology changes cross from ingestion into synthesis.',
            filePaths: ['src/map/topology.ts'],
            qualifiedNames: ['src/map/topology.ts::buildTopology'],
          },
        ],
        modules: [
          {
            name: 'src/map',
            changedFiles: ['src/map/topology.ts'],
            impactedFiles: ['src/map/topology.ts', 'src/map/synthesis.ts'],
            changedSymbolCount: 1,
            impactedSymbolCount: 2,
            crossModuleEdgeCount: 2,
            bridgeFiles: ['src/map/topology.ts'],
            bridgeQualifiedNames: ['src/map/topology.ts::buildTopology'],
            summary: 'Map topology updates feed the synthesis stage.',
          },
        ],
        drilldown: {
          impactedFiles: ['src/map/topology.ts', 'src/map/synthesis.ts'],
          impactedNodes: [],
          flows: [],
          testGaps: [],
          unsupportedChangedFiles: [],
        },
        warnings: ['Map graph coverage is still partial for one changed file.'],
        truncated: true,
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceScope: {
          workflow: 'map',
          changedFileCount: 1,
          changedSymbolPrecision: 'symbol',
        },
      },
      isLoading: false,
      isError: false,
    })
    useGraphContextArtifactMock.mockReturnValue({ data: undefined })
    useGraphReviewAnalysisArtifactMock.mockReturnValue({ data: undefined })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-map-live-only',
          branch: 'feature/map-live',
          status: 'running',
          workflow_type: 'map',
          current_phase: 'topology',
          phase_number: 2,
          current_round: 0,
          current_map_run: 1,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: false,
          has_map: true,
          review_phase_number: 0,
          review_phase: 'context',
          map_phase_number: 2,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
        initialQuery="topology"
      />,
    )

    expect(html).toContain('map')
    expect(html).toContain('Found 0 graph matches.')
    expect(html).toContain('Search results may be incomplete while the graph rebuild finishes.')
    expect(html).toContain('Map analysis highlights cross-module handoffs first.')
    expect(html).toContain('Topology changes cross from ingestion into synthesis.')
    expect(html).toContain('Map topology updates feed the synthesis stage.')
    expect(html).toContain('Map graph coverage is still partial for one changed file.')
    expect(html).toContain('Result truncated; narrow the scope or raise limits in a future query surface.')
    expect(html).toContain('No saved graph artifacts yet.')
  })


  it('renders multiple graph search results and saved review-analysis JSON content', () => {
    useGraphSearchMock.mockReturnValue({
      data: {
        status: 'ready',
        query: 'auth',
        summary: 'Found 2 graph matches.',
        limit: 10,
        results: [
          {
            entityType: 'node',
            qualifiedName: 'src/auth.ts::login',
            filePath: 'src/auth.ts',
            name: 'login',
            kind: 'Function',
            language: 'typescript',
            matchTypes: ['name', 'qualified_name'],
            score: 0.91,
          },
          {
            entityType: 'node',
            qualifiedName: 'src/auth.ts::logout',
            filePath: 'src/auth.ts',
            name: 'logout',
            kind: 'Function',
            language: 'typescript',
            matchTypes: ['path', 'signature'],
            score: 0.73,
          },
        ],
        warnings: [],
        truncated: false,
      },
      isLoading: false,
      isError: false,
    })
    useGraphReviewAnalysisArtifactMock.mockReturnValue({
      data: {
        content: '{"status":"ready","summary":"saved pretty artifact","warnings":["artifact warning"]}',
      },
    })

    const html = renderToStaticMarkup(
      <GraphExplorationPanel
        session={{
          id: 'session-search-multi',
          branch: 'feature/search-multi',
          status: 'running',
          workflow_type: 'review',
          current_phase: 'analysis',
          phase_number: 3,
          current_round: 1,
          current_map_run: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          has_review: true,
          has_map: false,
          review_phase_number: 3,
          review_phase: 'analysis',
          map_phase_number: 0,
          map_phase: 'topology',
          latest_verdict: null,
          latest_blocker_count: 0,
          latest_round_status: null,
        }}
        initialQuery="auth"
      />,
    )

    expect(html).toContain('Found 2 graph matches.')
    expect(html).toContain('src/auth.ts::login')
    expect(html).toContain('src/auth.ts::logout')
    expect(html).toContain('Matches: name, qualified_name · score 0.91')
    expect(html).toContain('Matches: path, signature · score 0.73')
    expect(html).toContain('Raw graph-review-analysis.json')
    expect(html).toContain('saved pretty artifact')
    expect(html).toContain('artifact warning')
  })
  it('renders graph context card summary and raw markdown details', () => {
    const content = [
      '# Graph Context',
      '',
      'Workflow: review',
      'Status: ready',
      'Risk: medium (0.42)',
      '',
      '## Changed Files',
      '',
      '- src/auth.ts',
      '',
      '## Changed Ranges',
      '',
      '- src/auth.ts:10-12',
      '',
      '## Changed Symbols',
      '',
      '- src/auth.ts::login (Function, src/auth.ts:10)',
      '',
      '## Unsupported Changed Files',
      '',
      '- docs/review.md',
      '',
      '## Impacted Files',
      '',
      '- src/auth.ts',
      '- src/user.ts',
      '',
      '## Affected Flows',
      '',
      '- loginHandler (src/api/auth.ts) - 3 file(s), criticality 0.82',
      '',
      '## Review Priorities',
      '',
      '- src/auth.ts::login - Changed symbol has a test gap.',
      '',
      '## Test Gaps',
      '',
      '- src/auth.ts::login (src/auth.ts:10) - Changed function has no TESTED_BY edge in graph.',
      '',
      '## Suggested Questions',
      '',
      '- Do the high-priority impacted symbols have enough direct review and test coverage?',
      '',
      '## Warnings',
      '',
      '- Graph parser version changed; run `ocr graph build --full`.',
    ].join('\n')

    const html = renderToStaticMarkup(<GraphContextCard content={content} />)

    expect(html).toContain('Graph Context')
    expect(html).toContain('medium (0.42)')
    expect(html).toContain('Changed ranges')
    expect(html).toContain('src/auth.ts:10-12')
    expect(html).toContain('Changed symbols')
    expect(html).toContain('src/auth.ts::login (Function, src/auth.ts:10)')
    expect(html).toContain('Impacted files')
    expect(html).toContain('src/auth.ts')
    expect(html).toContain('src/user.ts')
    expect(html).toContain('Affected flows')
    expect(html).toContain('loginHandler')
    expect(html).toContain('Test gaps')
    expect(html).toContain('src/auth.ts::login')
    expect(html).toContain('Unsupported changed files')
    expect(html).toContain('docs/review.md')
    expect(html).toContain('Warnings')
    expect(html).toContain('Graph parser version changed')
    expect(html).toContain('Raw graph-context.md')
  })
})
