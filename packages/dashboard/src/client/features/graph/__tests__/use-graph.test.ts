import { beforeEach, describe, expect, it, vi } from 'vitest'

const useQueryMock = vi.hoisted(() => vi.fn())
const cancelQueriesMock = vi.hoisted(() => vi.fn())
const fetchApiMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({
    cancelQueries: cancelQueriesMock,
  }),
}))

vi.mock('../../../lib/utils', () => ({
  fetchApi: fetchApiMock,
}))

import {
  useGraphContextArtifact,
  useGraphReviewAnalysis,
  useGraphReviewAnalysisArtifact,
  useGraphSearch,
  useGraphStatus,
} from '../use-graph'

describe('use-graph hook contracts', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    cancelQueriesMock.mockReset()
    fetchApiMock.mockReset()
    useQueryMock.mockImplementation((options: unknown) => options)
  })

  it('configures graph status query with a stable key and stale time', async () => {
    const options = useGraphStatus() as {
      queryKey: unknown[]
      queryFn: (context?: { signal?: AbortSignal }) => Promise<unknown>
      staleTime: number
      retry: boolean
    }

    expect(options.queryKey).toEqual(['graph', 'status'])
    expect(options.staleTime).toBe(10_000)
    expect(options.retry).toBe(false)

    await options.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/graph/status')
  })

  it('disables graph search when the trimmed query is empty', async () => {
    const options = useGraphSearch('   ', 15) as {
      queryKey: unknown[]
      queryFn: (context: { signal?: AbortSignal }) => Promise<unknown>
      enabled: boolean
      retry: boolean
      cancel: () => Promise<unknown>
    }

    expect(options.queryKey).toEqual(['graph', 'search', '   ', 15])
    expect(options.enabled).toBe(false)
    expect(options.retry).toBe(false)

    await options.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/graph/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '   ', limit: 15 }),
    })
  })

  it('configures graph search request payload for a populated query', async () => {
    const options = useGraphSearch('auth', 10) as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
    }

    expect(options.queryKey).toEqual(['graph', 'search', 'auth', 10])
    expect(options.enabled).toBe(true)

    await options.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/graph/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'auth', limit: 10 }),
    })
  })

  it('disables graph review analysis when enabled is false and preserves request shape', async () => {
    const options = useGraphReviewAnalysis({
      workflow: 'map',
      changedFiles: ['src/map/topology.ts'],
      base: 'origin/main',
      sessionDir: '.ocr/sessions/session-1',
      maxDepth: 2,
      maxNodes: 30,
      maxFiles: 12,
      maxHints: 4,
      maxModules: 3,
      enabled: false,
    }) as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
      retry: boolean
    }

    expect(options.queryKey).toEqual([
      'graph',
      'review-analysis',
      'map',
      ['src/map/topology.ts'],
      'origin/main',
      '.ocr/sessions/session-1',
      2,
      30,
      12,
      4,
      3,
    ])
    expect(options.enabled).toBe(false)
    expect(options.retry).toBe(false)

    const controller = new AbortController()
    await options.queryFn({ signal: controller.signal })
    expect(fetchApiMock).toHaveBeenCalledWith('/api/graph/review-analysis', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'map',
        changedFiles: ['src/map/topology.ts'],
        base: 'origin/main',
        sessionDir: '.ocr/sessions/session-1',
        maxDepth: 2,
        maxNodes: 30,
        maxFiles: 12,
        maxHints: 4,
        maxModules: 3,
      }),
    })

    await options.cancel()
    expect(cancelQueriesMock).toHaveBeenCalledWith({
      queryKey: [
        'graph',
        'review-analysis',
        'map',
        ['src/map/topology.ts'],
        'origin/main',
        '.ocr/sessions/session-1',
        2,
        30,
        12,
        4,
        3,
      ],
    })
  })

  it('enables artifact queries only when a session id exists', async () => {
    const reviewArtifactOptions = useGraphReviewAnalysisArtifact('session-1') as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
      retry: boolean
    }
    expect(reviewArtifactOptions.queryKey).toEqual(['sessions', 'session-1', 'artifacts', 'graph-review-analysis'])
    expect(reviewArtifactOptions.enabled).toBe(true)
    expect(reviewArtifactOptions.retry).toBe(false)

    reviewArtifactOptions.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/sessions/session-1/artifacts/graph-review-analysis')

    const contextArtifactOptions = useGraphContextArtifact('') as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
      retry: boolean
    }
    expect(contextArtifactOptions.queryKey).toEqual(['sessions', '', 'artifacts', 'graph-context'])
    expect(contextArtifactOptions.enabled).toBe(false)
    expect(contextArtifactOptions.retry).toBe(false)

    contextArtifactOptions.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/sessions//artifacts/graph-context')
  })
})
