import { useCallback, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Map, MessageSquare, X, FolderOpen } from 'lucide-react'
import { ProgressBar } from '../../components/ui/progress-bar'
import { ClearProgressDialog } from './components/clear-progress-dialog'
import { RawMapView } from './components/raw-map-view'
import { DependencyGraph } from './components/dependency-graph'
import { FileRow } from './components/file-row'
import { useMapRun, useMapSectionDetail, useToggleFileReview, useClearMapProgress } from './hooks/use-map-run'
import { ChatPanel } from '../chat/components/chat-panel'
import { GraphContextCard } from '../graph/graph-context-card'
import { useGraphContextArtifact } from '../graph/use-graph'

export function MapRunPage() {
  const { id: sessionId, run } = useParams<{ id: string; run: string }>()
  const runNumber = parseInt(run ?? '0', 10)

  const { data: mapRun, isLoading } = useMapRun(sessionId ?? '', runNumber)
  const { data: graphContextArtifact } = useGraphContextArtifact(sessionId ?? '')
  const toggleFile = useToggleFileReview(sessionId ?? '', runNumber)
  const clearProgress = useClearMapProgress(sessionId ?? '', runNumber)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null)
  const {
    data: selectedSection,
    isLoading: isSectionLoading,
    error: sectionError,
  } = useMapSectionDetail(sessionId ?? '', runNumber, selectedSectionId)

  const handleSectionClick = useCallback((sectionId: number) => {
    setSelectedSectionId(sectionId)
  }, [])

  if (isLoading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading map run...</p>
  }

  if (!mapRun) {
    return (
      <div>
        <Link
          to={`/sessions/${sessionId}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to session
        </Link>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Map run not found.</p>
      </div>
    )
  }

  const totalFiles = mapRun.sections.reduce((sum, s) => sum + s.file_count, 0)
  const reviewedFiles = mapRun.sections.reduce((sum, s) => sum + s.reviewed_count, 0)

  return (
    <div className="space-y-6">
      <Link
        to={`/sessions/${sessionId}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to session
      </Link>

      {/* Header */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Map className="h-5 w-5 text-zinc-400" />
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Map Run {mapRun.run_number}
              </h1>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {reviewedFiles} / {totalFiles} files reviewed
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Ask the Team
            </button>
            <RawMapView sessionId={sessionId ?? ''} />
            <ClearProgressDialog
              onConfirm={() => clearProgress.mutate(mapRun.id)}
              isPending={clearProgress.isPending}
            />
          </div>
        </div>

        <div className="mt-4">
          <ProgressBar value={reviewedFiles} max={totalFiles} showLabel />
        </div>
      </div>

      {/* Dependency Graph — hidden if no flow-analysis data */}
      <DependencyGraph
        sessionId={sessionId ?? ''}
        runNumber={runNumber}
        sections={mapRun.sections}
        onSectionClick={handleSectionClick}
      />

      {graphContextArtifact?.content && (
        <GraphContextCard content={graphContextArtifact.content} />
      )}

      {/* Section Cards */}
      {mapRun.sections.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No sections found in this map run.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {mapRun.sections.map((section) => (
            <div
              key={section.id}
              id={`section-${section.id}`}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {section.section_number}. {section.title}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {section.file_count} {section.file_count === 1 ? 'file' : 'files'}
                  </span>
                </div>
                {section.description && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {section.description}
                  </p>
                )}
                <ProgressBar
                  value={section.reviewed_count}
                  max={section.file_count}
                  showLabel
                  size="sm"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {chatOpen && (
        <ChatPanel
          sessionId={sessionId ?? ''}
          targetType="map_run"
          targetId={mapRun.run_number}
          onClose={() => setChatOpen(false)}
        />
      )}

      {selectedSectionId != null && (
        <div className="fixed right-0 top-0 z-50 flex h-full w-[420px] flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Section detail
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSectionId(null)}
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {isSectionLoading && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading section detail...</p>
            )}

            {sectionError instanceof Error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {sectionError.message}
              </div>
            )}

            {selectedSection && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {selectedSection.section_number}. {selectedSection.title}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {selectedSection.file_count} {selectedSection.file_count === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                  {selectedSection.description && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {selectedSection.description}
                    </p>
                  )}
                  <ProgressBar
                    value={selectedSection.reviewed_count}
                    max={selectedSection.file_count}
                    showLabel
                    size="sm"
                  />
                </div>

                <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {selectedSection.files.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                      No files in this section.
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {selectedSection.files.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          onToggle={(isReviewed) => toggleFile.mutate({ fileId: file.id, isReviewed })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
