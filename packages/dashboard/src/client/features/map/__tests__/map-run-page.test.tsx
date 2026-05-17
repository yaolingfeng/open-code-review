import * as React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const selectedSectionStateMock = vi.hoisted(() => ({ current: null as number | null }))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')

  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const initialValue = typeof initial === 'function' ? (initial as () => T)() : initial

      if (typeof initialValue === 'boolean') {
        return actual.useState(initial)
      }

      if (initialValue === null && selectedSectionStateMock.current != null) {
        return [selectedSectionStateMock.current as T, vi.fn()] as [T, React.Dispatch<React.SetStateAction<T>>]
      }

      return actual.useState(initial)
    },
  }
})

import { MapRunPage } from '../map-run-page'
import {
  useMapRun,
  useMapSectionDetail,
  useToggleFileReview,
  useClearMapProgress,
} from '../hooks/use-map-run'

const useParamsMock = vi.hoisted(() => vi.fn())
const useGraphContextArtifactMock = vi.hoisted(() => vi.fn())
const useMapRunMock = vi.hoisted(() => vi.fn())
const useMapSectionDetailMock = vi.hoisted(() => vi.fn())
const useToggleFileReviewMock = vi.hoisted(() => vi.fn())
const useClearMapProgressMock = vi.hoisted(() => vi.fn())
const useMapArtifactMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: string | string[]; to: string }) => <a href={to}>{children}</a>,
  useParams: useParamsMock,
}))

vi.mock('../hooks/use-map-run', () => ({
  useMapRun: useMapRunMock,
  useMapSectionDetail: useMapSectionDetailMock,
  useToggleFileReview: useToggleFileReviewMock,
  useClearMapProgress: useClearMapProgressMock,
  useMapArtifact: useMapArtifactMock,
}))

vi.mock('../../graph/use-graph', () => ({
  useGraphContextArtifact: useGraphContextArtifactMock,
}))

vi.mock('../components/dependency-graph', () => ({
  DependencyGraph: () => <div>DependencyGraph</div>,
}))

vi.mock('../components/section-card', () => ({
  SectionCard: ({ section }: { section: { id: number; title: string } }) => <div>SectionCard:{section.id}:{section.title}</div>,
}))

vi.mock('../components/file-row', () => ({
  FileRow: ({ file }: { file: { id: number; file_path: string } }) => <div>FileRow:{file.id}:{file.file_path}</div>,
}))

vi.mock('../components/clear-progress-dialog', () => ({
  ClearProgressDialog: () => <div>ClearProgressDialog</div>,
}))

vi.mock('../components/raw-map-view', () => ({
  RawMapView: () => <div>RawMapView</div>,
}))

vi.mock('../chat/components/chat-panel', () => ({
  ChatPanel: () => <div>ChatPanel</div>,
}))

vi.mock('../graph/graph-context-card', () => ({
  GraphContextCard: ({ content }: { content: string }) => <div>GraphContextCard:{content}</div>,
}))

vi.mock('../../components/ui/progress-bar', () => ({
  ProgressBar: ({ value, max }: { value: number; max: number }) => <div>ProgressBar:{value}/{max}</div>,
}))

function mockSelectedSection(sectionId: number | null) {
  selectedSectionStateMock.current = sectionId
}

describe('MapRunPage', () => {
  beforeEach(() => {
    selectedSectionStateMock.current = null
    useParamsMock.mockReset()
    useGraphContextArtifactMock.mockReset()
    useMapRunMock.mockReset()
    useMapSectionDetailMock.mockReset()
    useToggleFileReviewMock.mockReset()
    useMapArtifactMock.mockReset()

    useParamsMock.mockReturnValue({ id: 'session-1', run: '1' })
    useGraphContextArtifactMock.mockReturnValue({ data: { content: null } })
    useToggleFileReviewMock.mockReturnValue({ mutate: vi.fn() })
    useClearMapProgressMock.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useMapArtifactMock.mockReturnValue({ data: undefined, isLoading: false })
    useMapRunMock.mockReturnValue({
      isLoading: false,
      data: {
        id: 1,
        session_id: 'session-1',
        run_number: 1,
        map_md_path: 'map.md',
        parsed_at: '2026-01-01T00:00:00.000Z',
        sections: [
          {
            id: 11,
            map_run_id: 1,
            section_number: 1,
            title: 'API',
            description: 'Request handling',
            file_count: 2,
            reviewed_count: 1,
          },
        ],
      },
    })
    useMapSectionDetailMock.mockImplementation((_sessionId: string, _runNumber: number, sectionId: number | null) => ({
      data: sectionId == null ? undefined : {
        id: 11,
        map_run_id: 1,
        section_number: 1,
        title: 'API',
        description: 'Request handling',
        file_count: 2,
        reviewed_count: 1,
        files: [
          {
            id: 101,
            section_id: 11,
            file_path: 'src/api.ts',
            role: 'entry',
            lines_added: 10,
            lines_deleted: 2,
            display_order: 0,
            is_reviewed: true,
            reviewed_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    }))
  })

  afterEach(() => {
    selectedSectionStateMock.current = null
  })

  it('renders the map run from summary data without requiring section detail up front', () => {
    const html = renderToStaticMarkup(<MapRunPage />)

    expect(html).toContain('Map Run 1')
    expect(html).toContain('DependencyGraph')
    expect(html).toContain('1. API')
    expect(html).not.toContain('Section detail')
    expect(useMapSectionDetailMock).toHaveBeenCalledWith('session-1', 1, null)
  })

  it('renders populated section detail when a section has been selected', () => {
    mockSelectedSection(11)

    const html = renderToStaticMarkup(<MapRunPage />)

    expect(html).toContain('Section detail')
    expect(html).toContain('FileRow:101:src/api.ts')
    expect(useMapSectionDetailMock).toHaveBeenCalledWith('session-1', 1, 11)
  })

  it('renders loading state for section detail requests inside the side panel', () => {
    mockSelectedSection(11)
    useMapSectionDetailMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    const html = renderToStaticMarkup(<MapRunPage />)

    expect(html).toContain('Section detail')
    expect(html).toContain('Loading section detail...')
    expect(useMapSectionDetailMock).toHaveBeenCalledWith('session-1', 1, 11)
  })

  it('renders drilldown errors without breaking the main map page', () => {
    mockSelectedSection(11)
    useMapSectionDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('404: Section not found'),
    })

    const html = renderToStaticMarkup(<MapRunPage />)

    expect(html).toContain('404: Section not found')
    expect(html).toContain('1. API')
    expect(useMapSectionDetailMock).toHaveBeenCalledWith('session-1', 1, 11)
  })
})

describe('useMapSectionDetail', () => {
  it('is exported for lazy section drilldown queries', () => {
    expect(useMapSectionDetail).toBeDefined()
    expect(useMapRun).toBeDefined()
    expect(useToggleFileReview).toBeDefined()
    expect(useClearMapProgress).toBeDefined()
  })
})
