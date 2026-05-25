import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createGraphRouter } from '../graph.js'
import { isGraphReviewAnalysis } from '@open-code-review/graph'
import type { GenerateGraphReviewAnalysisOptions, GraphReviewAnalysis } from '@open-code-review/graph'

let tmpDir: string
let server: Server
let baseUrl: string

async function startServer(
  ocrDir: string,
  options?: Parameters<typeof createGraphRouter>[1],
): Promise<void> {
  const app = express()
  app.use(express.json())
  app.use('/api/graph', createGraphRouter(ocrDir, options))
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
  tmpDir = mkdtempSync(join(tmpdir(), 'ocr-dashboard-graph-route-test-'))
  const ocrDir = join(tmpDir, '.ocr')
  mkdirSync(ocrDir, { recursive: true })
  await startServer(ocrDir)
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

describe('createGraphRouter', () => {
  it('returns graph status without requiring an existing graph database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/status`)

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; warnings: string[] }
    expect(body.status).toBe('missing')
    expect(body.warnings).toContain('Graph database missing. Run `ocr graph build --full`.')
  })

  it('returns a non-blocking missing result for graph queries without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: {
          kind: 'pattern',
          pattern: 'file_summary',
          target: 'src/auth.ts',
        },
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; warnings: string[] }
    expect(body.status).toBe('missing')
    expect(body.warnings).toContain('Graph database missing.')
  })

  it('returns a non-blocking missing result for graph search without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'auth', limit: 15 }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; query: string; limit: number; warnings: string[] }
    expect(body.status).toBe('missing')
    expect(body.query).toBe('auth')
    expect(body.limit).toBe(15)
    expect(body.warnings).toContain('Graph database missing.')
  })

  it('returns missing minimal context without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/minimal-context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'review',
        changedFiles: ['src/auth.ts'],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; counts: { changedFiles: number }; nextToolSuggestions: Array<{ command: string }> }
    expect(body.status).toBe('missing')
    expect(body.counts.changedFiles).toBe(1)
    expect(body.nextToolSuggestions[0]?.command).toBe('ocr graph build --full')
  })

  it('returns missing review context without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/review-context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'review',
        changedFiles: ['src/auth.ts'],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; snippets: unknown[]; nextToolSuggestions: Array<{ command: string }> }
    expect(body.status).toBe('missing')
    expect(body.snippets).toEqual([])
    expect(body.nextToolSuggestions[0]?.command).toBe('ocr graph build --full')
  })


  it('returns a non-blocking missing result for impact-radius graph queries without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'impact',
        changedFiles: ['src/auth.ts'],
        maxDepth: 2,
        maxNodes: 25,
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; warnings: string[]; changedFiles?: string[] }
    expect(body.status).toBe('missing')
    expect(body.warnings).toContain('Graph database missing.')
  })

  it('rejects invalid graph query payloads with a 400 response', async () => {
    const response = await fetch(`${baseUrl}/api/graph/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'unknown' }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; expected: string }
    expect(body.error).toBe('Invalid graph query body')
    expect(body.expected).toBe('GraphQuery or { query: GraphQuery }')
  })

  it('rejects blank graph search requests with a 400 response', async () => {
    const response = await fetch(`${baseUrl}/api/graph/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '   ', limit: 10 }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; expected: string }
    expect(body.error).toBe('Invalid graph search body')
    expect(body.expected).toBe('{ query: string, limit?: number }')
  })

  it('rejects invalid review-analysis workflow payloads with a 400 response', async () => {
    const response = await fetch(`${baseUrl}/api/graph/review-analysis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'invalid-workflow',
        changedFiles: ['src/auth.ts'],
      }),
    })

    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; expected: string }
    expect(body.error).toBe('Invalid graph review analysis body')
    expect(body.expected).toBe('{ workflow: "review" | "map", ... }')
  })

  it('rejects invalid minimal-context and review-context workflow payloads with 400 responses', async () => {
    const minimal = await fetch(`${baseUrl}/api/graph/minimal-context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow: 'invalid-workflow' }),
    })
    expect(minimal.status).toBe(400)
    expect(await minimal.json()).toMatchObject({ error: 'Invalid graph minimal context body' })

    const reviewContext = await fetch(`${baseUrl}/api/graph/review-context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow: 'invalid-workflow' }),
    })
    expect(reviewContext.status).toBe(400)
    expect(await reviewContext.json()).toMatchObject({ error: 'Invalid graph review context body' })
  })

  it('returns missing map graph review analysis without a database', async () => {
    const response = await fetch(`${baseUrl}/api/graph/review-analysis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'map',
        changedFiles: ['src/map/topology.ts'],
        maxDepth: 2,
        maxNodes: 20,
        maxFiles: 10,
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as { status: string; sourceScope: { workflow: string; changedFileCount: number }; warnings: string[] }
    expect(body.status).toBe('missing')
    expect(body.sourceScope.workflow).toBe('map')
    expect(body.sourceScope.changedFileCount).toBe(1)
    expect(body.warnings).toContain('Graph database missing. Run `ocr graph build --full` to enable graph review analysis.')
    expect(isGraphReviewAnalysis(body)).toBe(true)
  })

  it('defaults dashboard review-analysis requests to safe maxModules=0', async () => {
    await restartServer({
      analysisRunner: async (request) => makeReviewAnalysis(request),
    })

    const response = await fetch(`${baseUrl}/api/graph/review-analysis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow: 'review',
        changedFiles: ['src/auth.ts'],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as GraphReviewAnalysis
    expect(body.status).toBe('ready')
    expect(body.modules).toEqual([])
  })

  it('deduplicates concurrent review-analysis requests with single-flight', async () => {
    let calls = 0
    await restartServer({
      analysisRunner: async (request) => {
        calls++
        await delay(30)
        return makeReviewAnalysis(request, { summary: 'single-flight analysis' })
      },
    })

    const payload = {
      workflow: 'review',
      changedFiles: ['src/auth.ts'],
      maxModules: 0,
    }
    const [first, second] = await Promise.all([
      postReviewAnalysis(payload),
      postReviewAnalysis(payload),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.json()).toMatchObject({ summary: 'single-flight analysis' })
    expect(await second.json()).toMatchObject({ summary: 'single-flight analysis' })
    expect(calls).toBe(1)
  })

  it('serves cached review-analysis responses within the short cache window', async () => {
    let calls = 0
    await restartServer({
      analysisRunner: async (request) => {
        calls++
        return makeReviewAnalysis(request, { summary: `cached analysis ${calls}` })
      },
      analysisCacheTtlMs: 1_000,
    })

    const payload = {
      workflow: 'review',
      changedFiles: ['src/auth.ts'],
      maxModules: 0,
    }
    const first = await postReviewAnalysis(payload)
    const second = await postReviewAnalysis(payload)

    expect(await first.json()).toMatchObject({ summary: 'cached analysis 1' })
    expect(await second.json()).toMatchObject({ summary: 'cached analysis 1' })
    expect(calls).toBe(1)
  })

  it('returns 504 when review-analysis exceeds the hard timeout boundary', async () => {
    await restartServer({
      analysisRunner: async () => new Promise(() => undefined),
      analysisTimeoutMs: 10,
    })

    const response = await postReviewAnalysis({
      workflow: 'review',
      changedFiles: ['src/auth.ts'],
    })

    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'Graph review analysis timed out' })
  })

  it('aborts the analysis runner when the client cancels the request', async () => {
    let aborted = false
    let notifyRunnerStarted!: () => void
    const runnerStarted = new Promise<void>((resolve) => {
      notifyRunnerStarted = resolve
    })
    await restartServer({
      analysisRunner: (_request, _timeoutMs, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('graph_review_analysis_cancelled'))
        }, { once: true })
        notifyRunnerStarted()
      }),
      analysisTimeoutMs: 1_000,
    })

    const controller = new AbortController()
    const request = postReviewAnalysis({
      workflow: 'review',
      changedFiles: ['src/auth.ts'],
    }, controller.signal).catch((error: unknown) => error)
    await runnerStarted
    controller.abort()
    await request
    await waitFor(() => aborted)

    expect(aborted).toBe(true)
  })
})

async function restartServer(options?: Parameters<typeof createGraphRouter>[1]): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
  await startServer(join(tmpDir, '.ocr'), options)
}

function postReviewAnalysis(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch(`${baseUrl}/api/graph/review-analysis`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function makeReviewAnalysis(
  request: GenerateGraphReviewAnalysisOptions,
  overrides: Partial<GraphReviewAnalysis> = {},
): GraphReviewAnalysis {
  const modules = request.maxModules && request.maxModules > 0
    ? [{
        name: 'src',
        changedFiles: request.changedFiles ?? [],
        impactedFiles: request.changedFiles ?? [],
        changedSymbolCount: 0,
        impactedSymbolCount: 0,
        crossModuleEdgeCount: 0,
        bridgeFiles: [],
        bridgeQualifiedNames: [],
        summary: 'src has changed files.',
      }]
    : []

  return {
    status: 'ready',
    summary: 'graph review analysis',
    changedSymbols: [],
    priorities: [],
    hints: [],
    modules,
    drilldown: {
      impactedFiles: request.changedFiles ?? [],
      impactedNodes: [],
      flows: [],
      testGaps: [],
      unsupportedChangedFiles: [],
    },
    warnings: [],
    truncated: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sourceScope: {
      workflow: request.workflow,
      changedFileCount: request.changedFiles?.length ?? 0,
      changedSymbolPrecision: 'file',
    },
    ...overrides,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await delay(5)
  }
}
