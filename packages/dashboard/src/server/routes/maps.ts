/**
 * Map runs, sections, and file endpoints.
 */

import { Router } from 'express'
import type { Database } from 'sql.js'
import {
  getSession,
  getMapRunsForSession,
  getMapRun,
  getSectionsForRun,
  getFilesForSection,
  getFileProgress,
  getArtifact,
  type MapSectionRow,
} from '../db.js'
import { parseMapMd } from '../services/parsers/map-parser.js'

function enrichSection(db: Database, section: MapSectionRow) {
  const files = getFilesForSection(db, section.id).map((f) => {
    const progress = getFileProgress(db, f.id)
    return {
      ...f,
      is_reviewed: progress ? !!progress.is_reviewed : false,
      reviewed_at: progress?.reviewed_at ?? null,
    }
  })
  return {
    ...section,
    files,
    reviewed_count: files.filter((f) => f.is_reviewed).length,
  }
}

function summarizeSection(db: Database, section: MapSectionRow) {
  return {
    ...section,
    reviewed_count: getFilesForSection(db, section.id).filter((file) => {
      const progress = getFileProgress(db, file.id)
      return !!progress?.is_reviewed
    }).length,
  }
}

function resolveSectionIdentity(sectionRef: number, sections: MapSectionRow[]) {
  const byNumber = sections.find((section) => section.section_number === sectionRef)
  if (byNumber) {
    return byNumber.id
  }

  const byOrder = sections.find((section) => section.display_order === sectionRef - 1)
  if (byOrder) {
    return byOrder.id
  }

  return null
}

export function createMapsRouter(db: Database): Router {
  const router = Router()

  // GET /api/sessions/:id/runs — List map runs for session
  router.get('/:id/runs', (req, res) => {
    try {
      const session = getSession(db, req.params['id'] as string)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const runs = getMapRunsForSession(db, req.params['id'] as string)
      res.json(runs)
    } catch (err) {
      console.error('Failed to fetch map runs:', err)
      res.status(500).json({ error: 'Failed to fetch map runs' })
    }
  })

  // GET /api/sessions/:id/runs/:run — Get run detail with sections
  router.get('/:id/runs/:run', (req, res) => {
    try {
      const runNumber = parseInt(req.params['run'] as string, 10)
      if (isNaN(runNumber)) {
        res.status(400).json({ error: 'Invalid run number' })
        return
      }
      const run = getMapRun(db, req.params['id'] as string, runNumber)
      if (!run) {
        res.status(404).json({ error: 'Map run not found' })
        return
      }
      const sections = getSectionsForRun(db, run.id).map((s) => summarizeSection(db, s))
      res.json({ ...run, sections })
    } catch (err) {
      console.error('Failed to fetch map run:', err)
      res.status(500).json({ error: 'Failed to fetch map run' })
    }
  })

  // GET /api/sessions/:id/runs/:run/sections — Get sections with files
  router.get('/:id/runs/:run/sections', (req, res) => {
    try {
      const runNumber = parseInt(req.params['run'] as string, 10)
      if (isNaN(runNumber)) {
        res.status(400).json({ error: 'Invalid run number' })
        return
      }
      const run = getMapRun(db, req.params['id'] as string, runNumber)
      if (!run) {
        res.status(404).json({ error: 'Map run not found' })
        return
      }
      const sections = getSectionsForRun(db, run.id).map((s) => enrichSection(db, s))
      res.json(sections)
    } catch (err) {
      console.error('Failed to fetch sections:', err)
      res.status(500).json({ error: 'Failed to fetch sections' })
    }
  })

  // GET /api/sessions/:id/runs/:run/sections/:sectionId — Get section detail with files
  router.get('/:id/runs/:run/sections/:sectionId', (req, res) => {
    try {
      const runNumber = parseInt(req.params['run'] as string, 10)
      const sectionId = parseInt(req.params['sectionId'] as string, 10)
      if (isNaN(runNumber)) {
        res.status(400).json({ error: 'Invalid run number' })
        return
      }
      if (isNaN(sectionId)) {
        res.status(400).json({ error: 'Invalid section id' })
        return
      }

      const run = getMapRun(db, req.params['id'] as string, runNumber)
      if (!run) {
        res.status(404).json({ error: 'Map run not found' })
        return
      }

      const section = getSectionsForRun(db, run.id).find((candidate) => candidate.id === sectionId)
      if (!section) {
        res.status(404).json({ error: 'Section not found for map run' })
        return
      }

      res.json(enrichSection(db, section))
    } catch (err) {
      console.error('Failed to fetch section detail:', err)
      res.status(500).json({ error: 'Failed to fetch section detail' })
    }
  })

  router.get('/:id/runs/:run/graph', (req, res) => {
    try {
      const sessionId = req.params['id'] as string
      const runNumber = parseInt(req.params['run'] as string, 10)
      if (isNaN(runNumber)) {
        res.status(400).json({ error: 'Invalid run number' })
        return
      }

      const run = getMapRun(db, sessionId, runNumber)
      if (!run) {
        res.status(404).json({ error: 'Map run not found' })
        return
      }

      const artifact = getArtifact(db, sessionId, 'map')
      if (!artifact) {
        res.status(404).json({ error: 'Map artifact not found' })
        return
      }

      const sections = getSectionsForRun(db, run.id)
      const parsed = parseMapMd(artifact.content)
      res.json({
        dependencies: parsed.dependencies.map((dependency) => ({
          ...dependency,
          fromSectionId: resolveSectionIdentity(dependency.fromSection, sections),
          toSectionId: resolveSectionIdentity(dependency.toSection, sections),
        })),
      })
    } catch (err) {
      console.error('Failed to fetch graph data:', err)
      res.status(500).json({ error: 'Failed to fetch graph data' })
    }
  })

  return router
}
