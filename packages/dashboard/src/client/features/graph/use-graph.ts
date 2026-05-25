import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../../lib/utils'
import type {
  Artifact,
  GraphMinimalContext,
  GraphReviewAnalysis,
  GraphReviewContext,
  GraphSearchResult,
  GraphStatus,
} from '../../lib/api-types'

export function useGraphStatus() {
  return useQuery<GraphStatus>({
    queryKey: ['graph', 'status'],
    queryFn: () => fetchApi<GraphStatus>('/api/graph/status'),
    staleTime: 10_000,
    retry: false,
  })
}

export function useGraphSearch(query: string, limit = 20) {
  return useQuery<GraphSearchResult>({
    queryKey: ['graph', 'search', query, limit],
    queryFn: () => fetchApi<GraphSearchResult>('/api/graph/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    }),
    enabled: query.trim().length > 0,
    retry: false,
  })
}

export function useGraphReviewAnalysisArtifact(sessionId: string) {
  return useQuery<Artifact>({
    queryKey: ['sessions', sessionId, 'artifacts', 'graph-review-analysis'],
    queryFn: () =>
      fetchApi<Artifact>(`/api/sessions/${sessionId}/artifacts/graph-review-analysis`),
    enabled: !!sessionId,
    retry: false,
  })
}

export function useGraphMinimalContextArtifact(sessionId: string) {
  return useQuery<Artifact>({
    queryKey: ['sessions', sessionId, 'artifacts', 'graph-minimal-context'],
    queryFn: () =>
      fetchApi<Artifact>(`/api/sessions/${sessionId}/artifacts/graph-minimal-context`),
    enabled: !!sessionId,
    retry: false,
  })
}

export function useGraphReviewContextArtifact(sessionId: string) {
  return useQuery<Artifact>({
    queryKey: ['sessions', sessionId, 'artifacts', 'graph-review-context'],
    queryFn: () =>
      fetchApi<Artifact>(`/api/sessions/${sessionId}/artifacts/graph-review-context`),
    enabled: !!sessionId,
    retry: false,
  })
}

export function useGraphMinimalContext(params: {
  workflow: 'review' | 'map'
  changedFiles?: string[]
  base?: string
  maxDepth?: number
  maxFiles?: number
  maxHints?: number
  maxPriorities?: number
  maxWarnings?: number
  maxSuggestions?: number
  enabled?: boolean
}) {
  const {
    workflow,
    changedFiles,
    base,
    maxDepth,
    maxFiles,
    maxHints,
    maxPriorities,
    maxWarnings,
    maxSuggestions,
    enabled = true,
  } = params

  return useQuery<GraphMinimalContext>({
    queryKey: ['graph', 'minimal-context', workflow, changedFiles, base, maxDepth, maxFiles, maxHints, maxPriorities, maxWarnings, maxSuggestions],
    queryFn: ({ signal }) => fetchApi<GraphMinimalContext>('/api/graph/minimal-context', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow,
        changedFiles,
        base,
        maxDepth,
        maxFiles,
        maxHints,
        maxPriorities,
        maxWarnings,
        maxSuggestions,
      }),
    }),
    enabled: enabled && !!workflow,
    retry: false,
  })
}

export function useGraphReviewAnalysis(params: {
  workflow: 'review' | 'map'
  changedFiles?: string[]
  base?: string
  sessionDir?: string
  maxDepth?: number
  maxNodes?: number
  maxFiles?: number
  maxHints?: number
  maxModules?: number
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const {
    workflow,
    changedFiles,
    base,
    sessionDir,
    maxDepth,
    maxNodes,
    maxFiles,
    maxHints,
    maxModules,
    enabled = true,
  } = params

  const queryKey = ['graph', 'review-analysis', workflow, changedFiles, base, sessionDir, maxDepth, maxNodes, maxFiles, maxHints, maxModules]
  const query = useQuery<GraphReviewAnalysis>({
    queryKey,
    queryFn: ({ signal }) => fetchApi<GraphReviewAnalysis>('/api/graph/review-analysis', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow,
        changedFiles,
        base,
        sessionDir,
        maxDepth,
        maxNodes,
        maxFiles,
        maxHints,
        maxModules,
      }),
    }),
    enabled: enabled && !!workflow,
    retry: false,
  })
  return {
    ...query,
    cancel: () => queryClient.cancelQueries({ queryKey }),
  }
}

export function useGraphReviewContext(params: {
  workflow: 'review' | 'map'
  changedFiles?: string[]
  base?: string
  maxDepth?: number
  maxNodes?: number
  maxFiles?: number
  maxSnippets?: number
  maxLinesPerSnippet?: number
  maxChars?: number
  maxSuggestions?: number
  enabled?: boolean
}) {
  const {
    workflow,
    changedFiles,
    base,
    maxDepth,
    maxNodes,
    maxFiles,
    maxSnippets,
    maxLinesPerSnippet,
    maxChars,
    maxSuggestions,
    enabled = true,
  } = params

  return useQuery<GraphReviewContext>({
    queryKey: ['graph', 'review-context', workflow, changedFiles, base, maxDepth, maxNodes, maxFiles, maxSnippets, maxLinesPerSnippet, maxChars, maxSuggestions],
    queryFn: ({ signal }) => fetchApi<GraphReviewContext>('/api/graph/review-context', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow,
        changedFiles,
        base,
        maxDepth,
        maxNodes,
        maxFiles,
        maxSnippets,
        maxLinesPerSnippet,
        maxChars,
        maxSuggestions,
      }),
    }),
    enabled: enabled && !!workflow,
    retry: false,
  })
}

export function useGraphContextArtifact(sessionId: string) {
  return useQuery<Artifact>({
    queryKey: ['sessions', sessionId, 'artifacts', 'graph-context'],
    queryFn: () =>
      fetchApi<Artifact>(`/api/sessions/${sessionId}/artifacts/graph-context`),
    enabled: !!sessionId,
    retry: false,
  })
}
