import { Router } from 'express'
import type { Database } from 'sql.js'
import { getSession } from '../db.js'
import {
  listTokenUsageForWorkflow,
  summarizeTokenUsageForWorkflow,
} from '@open-code-review/cli/db'

export function createUsageRouter(db: Database): Router {
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

  return router
}
