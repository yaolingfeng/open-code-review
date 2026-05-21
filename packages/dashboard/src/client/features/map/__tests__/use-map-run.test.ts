import { beforeEach, describe, expect, it, vi } from 'vitest'

const useQueryMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.hoisted(() => vi.fn())
const useQueryClientMock = vi.hoisted(() => vi.fn())
const useSocketEventMock = vi.hoisted(() => vi.fn())
const fetchApiMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}))

vi.mock('../../../providers/socket-provider', () => ({
  useSocketEvent: useSocketEventMock,
}))

vi.mock('../../../lib/utils', () => ({
  fetchApi: fetchApiMock,
}))

import { useMapRun, useMapSectionDetail, useClearMapProgress } from '../hooks/use-map-run'

describe('use-map-run hook contracts', () => {
  beforeEach(() => {
    useQueryMock.mockReset()
    useMutationMock.mockReset()
    useQueryClientMock.mockReset()
    useSocketEventMock.mockReset()
    fetchApiMock.mockReset()

    useQueryMock.mockImplementation((options: unknown) => options)
    useMutationMock.mockImplementation((options: unknown) => options)
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      getQueriesData: vi.fn().mockReturnValue([]),
      setQueryData: vi.fn(),
    })
  })

  it('configures the summary run query without preloading section detail files', async () => {
    const options = useMapRun('session-1', 2) as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
    }

    expect(options.queryKey).toEqual(['sessions', 'session-1', 'runs', 2])
    expect(options.enabled).toBe(true)

    await options.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/sessions/session-1/runs/2')
  })

  it('configures lazy section detail queries keyed by selected section id', async () => {
    const options = useMapSectionDetail('session-1', 2, 11) as {
      queryKey: unknown[]
      queryFn: () => Promise<unknown>
      enabled: boolean
      retry: boolean
    }

    expect(options.queryKey).toEqual(['sessions', 'session-1', 'runs', 2, 'sections', 11])
    expect(options.enabled).toBe(true)
    expect(options.retry).toBe(false)

    await options.queryFn()
    expect(fetchApiMock).toHaveBeenCalledWith('/api/sessions/session-1/runs/2/sections/11')
  })

  it('keeps section detail queries disabled until a section is selected', () => {
    const options = useMapSectionDetail('session-1', 2, null) as {
      queryKey: unknown[]
      enabled: boolean
    }

    expect(options.queryKey).toEqual(['sessions', 'session-1', 'runs', 2, 'sections', null])
    expect(options.enabled).toBe(false)
  })

  it('clears map progress and invalidates both summary and section detail queries', async () => {
    const invalidateQueries = vi.fn()
    useQueryClientMock.mockReturnValue({
      invalidateQueries,
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      getQueriesData: vi.fn().mockReturnValue([]),
      setQueryData: vi.fn(),
    })

    const mutation = useClearMapProgress('session-1', 2) as {
      mutationFn: (runId: number) => Promise<unknown>
      onSuccess: () => void
    }

    await mutation.mutationFn(7)
    expect(fetchApiMock).toHaveBeenCalledWith('/api/map-runs/7/progress', {
      method: 'DELETE',
    })

    mutation.onSuccess()
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['sessions', 'session-1', 'runs', 2],
    })
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['sessions', 'session-1', 'runs', 2, 'sections'],
    })
  })
})
