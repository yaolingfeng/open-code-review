import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../../lib/utils'
import type { TokenUsageResponse } from '../../lib/api-types'

export function useTokenUsage(sessionId: string) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'usage'],
    queryFn: () => fetchApi<TokenUsageResponse>(`/api/sessions/${sessionId}/usage`),
    enabled: !!sessionId,
  })
}
