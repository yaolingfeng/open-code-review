import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../../lib/utils'
import type { TokenUsageResponse, UsageComparison } from '../../lib/api-types'

export function useTokenUsage(sessionId: string) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'usage'],
    queryFn: () => fetchApi<TokenUsageResponse>(`/api/sessions/${sessionId}/usage`),
    enabled: !!sessionId,
  })
}

export function useUsageComparison(sessionId: string, baselineId: string) {
  return useQuery<UsageComparison>({
    queryKey: ['sessions', sessionId, 'usage', 'compare', baselineId],
    queryFn: () => fetchApi<UsageComparison>(
      `/api/sessions/${sessionId}/usage/compare?baseline=${encodeURIComponent(baselineId)}`,
    ),
    enabled: !!sessionId && baselineId.trim().length > 0,
    retry: false,
  })
}
