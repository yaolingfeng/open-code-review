import { lazy, Suspense, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { useTheme } from '../../../providers/theme-provider'
import { fetchApi } from '../../../lib/utils'
import type { MapSectionSummary, SectionDependency } from '../../../lib/api-types'

const MermaidRenderer = lazy(() => import('./mermaid-renderer'))

type GraphResponse = {
  dependencies: SectionDependency[]
}

type DependencyGraphProps = {
  sessionId: string
  runNumber: number
  sections: MapSectionSummary[]
  onSectionClick?: (sectionId: number) => void
}

export function DependencyGraph({ sessionId, runNumber, sections, onSectionClick }: DependencyGraphProps) {
  const { resolved: theme } = useTheme()

  const { data, isLoading } = useQuery<GraphResponse | null>({
    queryKey: ['sessions', sessionId, 'runs', runNumber, 'graph'],
    queryFn: async () => {
      try {
        return await fetchApi<GraphResponse>(`/api/sessions/${sessionId}/runs/${runNumber}/graph`)
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('404:')) return null
        throw err
      }
    },
    enabled: !!sessionId && runNumber > 0,
    retry: false,
  })

  const sectionIdsByNodeId = useMemo(() => {
    const pairs: Array<[string, number]> = []

    for (const section of sections) {
      pairs.push([getNodeId(section.id), section.id])
    }

    return new Map(pairs)
  }, [sections])

  const graphDefinition = useMemo(() => {
    if (!data?.dependencies) return null
    return buildMermaidGraph(data.dependencies, sections, theme)
  }, [data?.dependencies, sections, theme])

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const sectionId = sectionIdsByNodeId.get(nodeId)
      if (sectionId && onSectionClick) {
        onSectionClick(sectionId)
      }
    },
    [sectionIdsByNodeId, onSectionClick],
  )

  if (isLoading) return null
  // Show if we have sections (even without deps, we show nodes)
  if (!graphDefinition) return null

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <GitBranch className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        <span className="text-sm font-medium">Section Dependencies</span>
      </div>
      <div className="p-4">
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          }
        >
          <MermaidRenderer
            definition={graphDefinition}
            onNodeClick={handleNodeClick}
          />
        </Suspense>
      </div>
    </div>
  )
}

// --- Graph building helpers ---

function buildMermaidGraph(
  dependencies: SectionDependency[],
  sections: MapSectionSummary[],
  theme: string,
): string | null {
  if (sections.length === 0) return null

  const isDark = theme === 'dark'
  const lines = ['graph TD']

  // Add nodes for each section
  for (const section of sections) {
    const id = getNodeId(section.id)
    const reviewed = section.reviewed_count
    const total = section.file_count
    const label = `${section.title}<br/>${reviewed}/${total} files`
    lines.push(`  ${id}["${label}"]`)
  }

  // Add edges with relationship labels
  for (const dep of dependencies) {
    if (dep.fromSectionId == null || dep.toSectionId == null) {
      continue
    }

    const fromId = getNodeId(dep.fromSectionId)
    const toId = getNodeId(dep.toSectionId)
    // Escape quotes in relationship text for Mermaid
    const rel = dep.relationship.replace(/"/g, "'")
    lines.push(`  ${fromId} -->|"${rel}"| ${toId}`)
  }

  // Progress-based styling
  if (isDark) {
    lines.push('')
    lines.push('  classDef notStarted fill:#27272a,stroke:#71717a,color:#d4d4d8')
    lines.push('  classDef inProgress fill:#422006,stroke:#f59e0b,color:#fef3c7')
    lines.push('  classDef complete fill:#052e16,stroke:#22c55e,color:#dcfce7')
  } else {
    lines.push('')
    lines.push('  classDef notStarted fill:#f4f4f5,stroke:#a1a1aa,color:#3f3f46')
    lines.push('  classDef inProgress fill:#fef9c3,stroke:#f59e0b,color:#78350f')
    lines.push('  classDef complete fill:#dcfce7,stroke:#22c55e,color:#166534')
  }

  // Assign classes based on progress
  for (const section of sections) {
    const id = getNodeId(section.id)
    const pct = section.file_count > 0 ? section.reviewed_count / section.file_count : 0
    if (pct >= 1) {
      lines.push(`  class ${id} complete`)
    } else if (pct > 0) {
      lines.push(`  class ${id} inProgress`)
    } else {
      lines.push(`  class ${id} notStarted`)
    }
  }

  return lines.join('\n')
}

function getNodeId(sectionId: number): string {
  return `section_${sectionId}`
}
