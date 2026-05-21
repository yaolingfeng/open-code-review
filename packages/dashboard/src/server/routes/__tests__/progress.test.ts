import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../../db.js'
import { createProgressRouter, flushSave } from '../progress.js'
import type { Database } from 'sql.js'

let tmpDir: string
let server: Server
let baseUrl: string
let db: Database

async function seedMapData(database: Database) {
  database.run(
    `INSERT INTO sessions (
      id, branch, status, workflow_type, current_phase, phase_number,
      current_round, current_map_run, started_at, updated_at, session_dir
    ) VALUES ('session-1', 'feature/map', 'active', 'map', 'topology', 1, 0, 1, datetime('now'), datetime('now'), '/tmp/session')`
  )

  database.run(
    `INSERT INTO map_runs (
      id, session_id, run_number, file_count, section_count, map_md_path, parsed_at, source
    ) VALUES (1, 'session-1', 1, 3, 2, 'map.md', datetime('now'), 'artifact')`
  )

  database.run(
    `INSERT INTO map_sections (
      id, map_run_id, section_number, title, description, file_count, display_order
    ) VALUES
      (11, 1, 1, 'API', 'Request handling', 2, 0),
      (12, 1, 2, 'Store', 'State management', 1, 1)`
  )

  database.run(
    `INSERT INTO map_files (
      id, section_id, file_path, role, lines_added, lines_deleted, display_order
    ) VALUES
      (101, 11, 'src/api.ts', 'entry', 10, 2, 0),
      (102, 11, 'src/router.ts', 'routing', 4, 1, 1),
      (103, 12, 'src/store.ts', 'state', 7, 0, 0)`
  )

  database.run(
    `INSERT INTO user_file_progress (map_file_id, is_reviewed, reviewed_at)
     VALUES (101, 1, datetime('now')), (102, 1, datetime('now')), (103, 1, datetime('now'))`
  )
}

async function startServer() {
  const app = express()
  app.use(express.json())
  app.use('/api', createProgressRouter(db, join(tmpDir, '.ocr')))
  server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected HTTP server address')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ocr-dashboard-progress-route-test-'))
  const ocrDir = join(tmpDir, '.ocr')
  mkdirSync(ocrDir, { recursive: true })
  db = await openDb(ocrDir)
  await seedMapData(db)
  await startServer()
})

afterEach(async () => {
  flushSave()
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('createProgressRouter', () => {
  it('clears reviewed state across every file in a map run', async () => {
    const response = await fetch(`${baseUrl}/api/map-runs/1/progress`, {
      method: 'DELETE',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })

    const remaining = db.exec('SELECT map_file_id FROM user_file_progress ORDER BY map_file_id ASC')
    expect(remaining[0]?.values ?? []).toEqual([])
  })

  it('returns 404 for unknown map runs when clearing progress', async () => {
    const response = await fetch(`${baseUrl}/api/map-runs/999/progress`, {
      method: 'DELETE',
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Map run not found' })
  })
})
