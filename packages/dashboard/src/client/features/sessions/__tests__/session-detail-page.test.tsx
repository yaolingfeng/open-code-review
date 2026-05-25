import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SessionDetailPage } from '../session-detail-page'

const useParamsMock = vi.hoisted(() => vi.fn())
const useQueryMock = vi.hoisted(() => vi.fn())
const useQueryClientMock = vi.hoisted(() => vi.fn())
const useSessionMock = vi.hoisted(() => vi.fn())
const useAgentSessionsMock = vi.hoisted(() => vi.fn())
const classifyLivenessMock = vi.hoisted(() => vi.fn())
const useSocketEventMock = vi.hoisted(() => vi.fn())
const useTokenUsageMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: string | string[]; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useParams: useParamsMock,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}))

vi.mock('../hooks/use-sessions', () => ({
  useSession: useSessionMock,
}))

vi.mock('../hooks/use-agent-sessions', () => ({
  useAgentSessions: useAgentSessionsMock,
  classifyLiveness: classifyLivenessMock,
}))

vi.mock('../../../providers/socket-provider', () => ({
  useSocketEvent: useSocketEventMock,
}))

vi.mock('../../usage/use-token-usage', () => ({
  useTokenUsage: useTokenUsageMock,
}))

vi.mock('../../components/ui/status-badge', () => ({
  StatusBadge: ({ variant }: { variant: string }) => <div>StatusBadge:{variant}</div>,
}))

vi.mock('../../components/ui/phase-timeline', () => ({
  PhaseTimeline: ({ phases }: { phases: Array<{ name: string; status: string }> }) => (
    <div>PhaseTimeline:{phases.map((phase) => `${phase.name}:${phase.status}`).join('|')}</div>
  ),
}))

vi.mock('../components/session-tabs', () => ({
  SessionTabs: ({ session }: { session: { id: string } }) => <div>SessionTabs:{session.id}</div>,
}))

vi.mock('../components/liveness-header', () => ({
  LivenessHeader: ({ workflowId }: { workflowId: string }) => <div>LivenessHeader:{workflowId}</div>,
}))

vi.mock('../components/resume-card', () => ({
  ResumeCard: ({ workflowId, variant }: { workflowId: string; variant: string }) => (
    <div>ResumeCard:{workflowId}:{variant}</div>
  ),
}))

vi.mock('../../graph/graph-status-badge', () => ({
  GraphStatusBadge: () => <div>GraphStatusBadge</div>,
}))

vi.mock('../../graph/graph-exploration-panel', () => ({
  GraphExplorationPanel: ({ session }: { session: { id: string; branch: string } }) => (
    <div>GraphExplorationPanel:{session.id}:{session.branch}</div>
  ),
}))

vi.mock('../../usage/token-usage-card', () => ({
  TokenUsageCard: ({
    workflowId,
    summary,
    isLoading,
    error,
  }: {
    workflowId?: string
    summary?: { total_tokens?: number }
    isLoading?: boolean
    error?: unknown
  }) => (
    <div>
      TokenUsageCard:{workflowId}:{summary?.total_tokens ?? 0}:{isLoading ? 'loading' : 'idle'}:
      {error ? 'error' : 'ok'}
    </div>
  ),
}))

describe('SessionDetailPage', () => {
  beforeEach(() => {
    useParamsMock.mockReset()
    useQueryMock.mockReset()
    useQueryClientMock.mockReset()
    useSessionMock.mockReset()
    useAgentSessionsMock.mockReset()
    classifyLivenessMock.mockReset()
    useSocketEventMock.mockReset()
    useTokenUsageMock.mockReset()

    useParamsMock.mockReturnValue({ id: 'session-1' })
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    })
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: [],
    })
    useSessionMock.mockReturnValue({
      isLoading: false,
      data: {
        id: 'session-1',
        branch: 'feature/auth',
        status: 'active',
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
      },
    })
    useAgentSessionsMock.mockReturnValue({
      data: { agent_sessions: [] },
    })
    classifyLivenessMock.mockReturnValue({
      status: 'idle',
      newestHeartbeat: null,
      liveRow: null,
      orphanedRow: null,
    })
    useTokenUsageMock.mockReturnValue({
      data: {
        summary: {
          total_tokens: 321,
        },
      },
      isLoading: false,
      error: null,
    })
  })

  it('renders loading state while the session is still loading', () => {
    useSessionMock.mockReturnValue({
      isLoading: true,
      data: undefined,
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('Loading session...')
    expect(html).not.toContain('GraphExplorationPanel:session-1:feature/auth')
  })

  it('renders not found state when the session is missing', () => {
    useSessionMock.mockReturnValue({
      isLoading: false,
      data: undefined,
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('Back to sessions')
    expect(html).toContain('Session not found.')
    expect(html).not.toContain('GraphExplorationPanel:session-1:feature/auth')
  })

  it('renders graph exploration panel inside the session detail workflow view', () => {
    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('LivenessHeader:session-1')
    expect(html).toContain('GraphStatusBadge')
    expect(html).toContain('Active')
    expect(html).toContain('TokenUsageCard:session-1:321:idle:ok')
    expect(html).toContain('GraphExplorationPanel:session-1:feature/auth')
    expect(html).toContain('SessionTabs:session-1')
    expect(html).toContain('Event Log')
    expect(html).toContain('No events recorded.')
  })

  it('renders map label and dual timelines when both review and map workflows exist', () => {
    useSessionMock.mockReturnValue({
      isLoading: false,
      data: {
        id: 'session-1',
        branch: 'feature/auth',
        status: 'active',
        workflow_type: 'review',
        current_phase: 'analysis',
        phase_number: 3,
        current_round: 1,
        current_map_run: 1,
        started_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        has_review: true,
        has_map: true,
        review_phase_number: 3,
        review_phase: 'analysis',
        map_phase_number: 2,
        map_phase: 'topology',
        latest_verdict: null,
        latest_blocker_count: 0,
        latest_round_status: null,
      },
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('Review + Map')
    expect(html).toContain('GraphExplorationPanel:session-1:feature/auth')
    expect(html).toContain('aria-label="Context: complete"')
    expect(html).toContain('aria-label="Analysis: active"')
    expect(html).toContain('aria-label="Map Context: complete"')
    expect(html).toContain('aria-label="Topology: active"')
  })

  it('renders completed resume affordance when a resumable vendor session exists', () => {
    useAgentSessionsMock.mockReturnValue({
      data: {
        agent_sessions: [
          {
            vendor_session_id: 'vendor-123',
          },
        ],
      },
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('ResumeCard:session-1:completed')
    expect(html).toContain('GraphExplorationPanel:session-1:feature/auth')
  })

  it('renders event log loading state while orchestration events are pending', () => {
    useQueryMock.mockReturnValue({
      isLoading: true,
      data: undefined,
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('Loading events...')
    expect(html).not.toContain('No events recorded.')
  })

  it('renders event log entries when orchestration events exist', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: 'event-1',
          created_at: '2026-01-01T00:00:00.000Z',
          event_type: 'phase.changed',
          phase: 'analysis',
          round: 2,
        },
      ],
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('phase.changed')
    expect(html).toContain('Phase: analysis')
    expect(html).toContain('Round: 2')
    expect(html).not.toContain('No events recorded.')
  })

  it('renders resume affordance when liveness indicates a paused workflow', () => {
    classifyLivenessMock.mockReturnValue({
      status: 'stalled',
      newestHeartbeat: '2026-01-01 00:00:00',
      liveRow: null,
      orphanedRow: null,
    })

    const html = renderToStaticMarkup(<SessionDetailPage />)

    expect(html).toContain('ResumeCard:session-1:paused')
    expect(html).toContain('GraphExplorationPanel:session-1:feature/auth')
  })
})
