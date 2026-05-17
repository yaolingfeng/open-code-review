import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSocketEvent } from '../../../providers/socket-provider'
import { fetchApi } from '../../../lib/utils'
import type { MapRun, MapSectionDetail, Artifact } from '../../../lib/api-types'

function findSectionIdForFile(
  detailQueries: Array<[readonly unknown[], MapSectionDetail | undefined]>,
  fileId: number,
): number | null {
  for (const [, detail] of detailQueries) {
    if (detail?.files.some((file) => file.id === fileId)) {
      return detail.id
    }
  }

  return null
}

export function useMapRun(sessionId: string, runNumber: number) {
  const queryClient = useQueryClient()
  const queryKey = ['sessions', sessionId, 'runs', runNumber]

  const query = useQuery<MapRun>({
    queryKey,
    queryFn: () =>
      fetchApi<MapRun>(`/api/sessions/${sessionId}/runs/${runNumber}`),
    enabled: !!sessionId && runNumber > 0,
  })

  useSocketEvent('artifact:updated', () => {
    queryClient.invalidateQueries({ queryKey })
  })

  return query
}

export function useMapSectionDetail(sessionId: string, runNumber: number, sectionId: number | null) {
  const queryClient = useQueryClient()
  const queryKey = ['sessions', sessionId, 'runs', runNumber, 'sections', sectionId]

  const query = useQuery<MapSectionDetail>({
    queryKey,
    queryFn: () =>
      fetchApi<MapSectionDetail>(`/api/sessions/${sessionId}/runs/${runNumber}/sections/${sectionId}`),
    enabled: !!sessionId && runNumber > 0 && sectionId != null,
    retry: false,
  })

  useSocketEvent('artifact:updated', () => {
    queryClient.invalidateQueries({
      queryKey: ['sessions', sessionId, 'runs', runNumber, 'sections'],
    })
  })

  return query
}

export function useMapArtifact(sessionId: string) {
  return useQuery<Artifact>({
    queryKey: ['sessions', sessionId, 'artifacts', 'map'],
    queryFn: () =>
      fetchApi<Artifact>(`/api/sessions/${sessionId}/artifacts/map`),
    enabled: !!sessionId,
  })
}

export function useToggleFileReview(sessionId: string, runNumber: number) {
  const queryClient = useQueryClient()
  const queryKey = ['sessions', sessionId, 'runs', runNumber]

  return useMutation({
    mutationFn: async ({
      fileId,
      isReviewed,
    }: {
      fileId: number
      isReviewed: boolean
    }) => {
      return fetchApi(`/api/map-files/${fileId}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_reviewed: isReviewed }),
      })
    },
    onMutate: async ({ fileId, isReviewed }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({
          queryKey: ['sessions', sessionId, 'runs', runNumber, 'sections'],
        }),
      ])
      const previous = queryClient.getQueryData<MapRun>(queryKey)
      const detailQueries = queryClient.getQueriesData<MapSectionDetail>({
        queryKey: ['sessions', sessionId, 'runs', runNumber, 'sections'],
      })
      const sectionId = findSectionIdForFile(detailQueries, fileId)
      if (previous && sectionId != null) {
        queryClient.setQueryData<MapRun>(queryKey, {
          ...previous,
          sections: previous.sections.map((section) => ({
            ...section,
            reviewed_count: section.reviewed_count + (section.id === sectionId ? (isReviewed ? 1 : -1) : 0),
          })),
        })
      }

      for (const [detailKey, detail] of detailQueries) {
        if (!detail) continue
        queryClient.setQueryData<MapSectionDetail>(detailKey, {
          ...detail,
          reviewed_count: detail.files.some((f) => f.id === fileId)
            ? detail.reviewed_count + (isReviewed ? 1 : -1)
            : detail.reviewed_count,
          files: detail.files.map((f) =>
            f.id === fileId
              ? { ...f, is_reviewed: isReviewed, reviewed_at: isReviewed ? new Date().toISOString() : null }
              : f,
          ),
        })
      }

      return { previous, detailQueries }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      if (context?.detailQueries) {
        for (const [detailKey, detail] of context.detailQueries) {
          queryClient.setQueryData(detailKey, detail)
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({
        queryKey: ['sessions', sessionId, 'runs', runNumber, 'sections'],
      })
    },
  })
}

export function useClearMapProgress(sessionId: string, runNumber: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (runId: number) => {
      return fetchApi(`/api/map-runs/${runId}/progress`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['sessions', sessionId, 'runs', runNumber],
      })
    },
  })
}
