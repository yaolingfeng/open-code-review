import { Router } from 'express'
import type { Database } from 'sql.js'
import { getSession } from '../db.js'
import {
  compareWorkflowUsage,
  listTokenUsageForWorkflow,
  summarizeTokenUsageForWorkflow,
} from '@open-code-review/cli/db'

export function createUsageRouter(db: Database, ocrDir?: string): Router {
  const router = Router()

  router.get('/:id/usage', (req, res) => {
    try {
      const sessionId = req.params['id'] as string
      const session = getSession(db, sessionId)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      res.json({
        summary: summarizeTokenUsageForWorkflow(db, sessionId),
        rows: listTokenUsageForWorkflow(db, sessionId),
      })
    } catch (err) {
      console.error('Failed to fetch token usage:', err)
      res.status(500).json({ error: 'Failed to fetch token usage' })
    }
  })

  router.get('/:id/usage/compare', (req, res) => {
    try {
      if (!ocrDir) {
        res.status(500).json({ error: 'OCR directory is required for usage comparison' })
        return
      }
      const candidateId = req.params['id'] as string
      const baselineId = typeof req.query['baseline'] === 'string'
        ? req.query['baseline']
        : ''
      if (!baselineId.trim()) {
        res.status(400).json({
          error: 'Baseline workflow is required',
          expected: '?baseline=<workflow-id>',
        })
        return
      }

      const candidate = getSession(db, candidateId)
      const baseline = getSession(db, baselineId)
      if (!candidate) {
        res.status(404).json({ error: 'Candidate session not found' })
        return
      }
      if (!baseline) {
        res.status(404).json({ error: 'Baseline session not found' })
        return
      }

      res.json(compareWorkflowUsage(db, ocrDir, baselineId, candidateId))
    } catch (err) {
      console.error('Failed to compare token usage:', err)
      res.status(500).json({ error: 'Failed to compare token usage' })
    }
  })

  return router
}
