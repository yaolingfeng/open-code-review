import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../../db.js'
import { createMapsRouter } from '../maps.js'
import type { Database } from 'sql.js'

let tmpDir: string
let server: Server
let baseUrl: string
let db: Database

async function seedMapData(database: Database, sessionId: string) {
  database.run(
    `INSERT INTO sessions (
      id, branch, status, workflow_type, current_phase, phase_number,
      current_round, current_map_run, started_at, updated_at, session_dir
    ) VALUES (?, 'feature/map', 'active', 'map', 'topology', 1, 0, 1, datetime('now'), datetime('now'), '/tmp/session')`,
    [sessionId],
  )

  database.run(
    `INSERT INTO map_runs (
      id, session_id, run_number, file_count, section_count, map_md_path, parsed_at, source
    ) VALUES (1, ?, 1, 3, 2, 'map.md', datetime('now'), 'artifact')`,
    [sessionId],
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
     VALUES (101, 1, datetime('now'))`
  )

  writeFileSync(
    join(tmpDir, '.ocr', 'map.md'),
    [
      '## Section Dependencies',
      '',
      '| From | To | Relationship |',
      '| --- | --- | --- |',
      '| 1: API | 2: Store | calls |',
      '',
    ].join('\n'),
  )

  database.run(
    `INSERT INTO markdown_artifacts (
      session_id, artifact_type, round_number, file_path, content, parsed_at
    ) VALUES (?, 'map', NULL, ?, ?, datetime('now'))`,
    [
      sessionId,
      join(tmpDir, '.ocr', 'map.md'),
      [
        '## Section Dependencies',
        '',
        '| From | To | Relationship |',
        '| --- | --- | --- |',
        '| 1: API | 2: Store | calls |',
        '',
      ].join('\n'),
    ],
  )
}

async function startServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/sessions', createMapsRouter(db))
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
  tmpDir = mkdtempSync(join(tmpdir(), 'ocr-dashboard-maps-route-test-'))
  const ocrDir = join(tmpDir, '.ocr')
  mkdirSync(ocrDir, { recursive: true })
  db = await openDb(ocrDir)
  await seedMapData(db, 'session-1')
  await startServer()
})

afterEach(async () => {
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

describe('createMapsRouter', () => {
  it('returns summary-first run payloads without section files', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-1/runs/1`)

    expect(response.status).toBe(200)
    const body = await response.json() as {
      sections: Array<{ id: number; reviewed_count: number; files?: unknown[] }>
    }
    expect(body.sections).toHaveLength(2)
    expect(body.sections[0]).toMatchObject({ id: 11, reviewed_count: 1 })
    expect(body.sections[0]).not.toHaveProperty('files')
  })

  it('returns section detail for the requested run and section id', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-1/runs/1/sections/11`)

    expect(response.status).toBe(200)
    const body = await response.json() as {
      id: number
      section_number: number
      reviewed_count: number
      files: Array<{ id: number; is_reviewed: boolean }>
    }
    expect(body.id).toBe(11)
    expect(body.section_number).toBe(1)
    expect(body.reviewed_count).toBe(1)
    expect(body.files.map((file) => file.id)).toEqual([101, 102])
    expect(body.files[0]?.is_reviewed).toBe(true)
  })

  it('rejects section ids that do not belong to the selected run', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-1/runs/1/sections/999`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Section not found for map run' })
  })

  it('returns graph dependencies with stable section ids', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/session-1/runs/1/graph`)

    expect(response.status).toBe(200)
    const body = await response.json() as {
      dependencies: Array<{
        fromSection: number
        fromSectionId: number | null
        toSection: number
        toSectionId: number | null
        relationship: string
      }>
    }
    expect(body.dependencies).toEqual([
      {
        fromSection: 1,
        fromSectionId: 11,
        fromTitle: 'API',
        toSection: 2,
        toSectionId: 12,
        toTitle: 'Store',
        relationship: 'calls',
      },
    ])
  })
})
