import { Network } from 'lucide-react'
import { MarkdownRenderer } from '../../components/markdown'

type GraphContextCardProps = {
  content: string
}

type GraphContextSummary = {
  risk: string | null
  changedRanges: string[]
  changedSymbols: string[]
  impactedFiles: string[]
  affectedFlows: string[]
  testGaps: string[]
  unsupportedChangedFiles: string[]
  warnings: string[]
}

function extractSection(content: string, heading: string): string[] {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start === -1) return []
  const values: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''
    if (line.startsWith('## ')) break
    if (line.startsWith('- ') && line !== '- None') {
      values.push(line.slice(2))
    }
  }
  return values
}

function summarize(content: string): GraphContextSummary {
  const risk = content.match(/^Risk:\s*(.+)$/m)?.[1] ?? null
  return {
    risk,
    changedRanges: extractSection(content, 'Changed Ranges'),
    changedSymbols: extractSection(content, 'Changed Symbols'),
    impactedFiles: extractSection(content, 'Impacted Files'),
    affectedFlows: extractSection(content, 'Affected Flows'),
    testGaps: extractSection(content, 'Test Gaps'),
    unsupportedChangedFiles: extractSection(content, 'Unsupported Changed Files'),
    warnings: extractSection(content, 'Warnings'),
  }
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {items.slice(0, 6).map((item) => (
          <li key={item} className="truncate">- {item}</li>
        ))}
      </ul>
      {items.length > 6 && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          +{items.length - 6} more
        </p>
      )}
    </div>
  )
}

export function GraphContextCard({ content }: GraphContextCardProps) {
  const summary = summarize(content)

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Graph Context
          </h2>
        </div>
        {summary.risk && (
          <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            {summary.risk}
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryList title="Changed ranges" items={summary.changedRanges} />
        <SummaryList title="Changed symbols" items={summary.changedSymbols} />
        <SummaryList title="Impacted files" items={summary.impactedFiles} />
        <SummaryList title="Affected flows" items={summary.affectedFlows} />
        <SummaryList title="Test gaps" items={summary.testGaps} />
        <SummaryList title="Unsupported changed files" items={summary.unsupportedChangedFiles} />
        <SummaryList title="Warnings" items={summary.warnings} />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
          Raw graph-context.md
        </summary>
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <MarkdownRenderer content={content} />
        </div>
      </details>
    </div>
  )
}
