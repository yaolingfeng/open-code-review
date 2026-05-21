import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { Router } from 'express'
import {
  getGraphStatus,
  getImpactRadius,
  isGraphReviewAnalysis,
  isGraphWorkflow,
  queryGraph,
  searchGraph,
  type GraphQuery,
  type GraphReviewAnalysis,
  type GenerateGraphReviewAnalysisOptions,
  type GraphWorkflow,
} from '@open-code-review/graph'

type GraphQueryBody =
  | GraphQuery
  | {
      query?: GraphQuery
      kind?: string
      changedFiles?: string[]
      maxDepth?: number
      maxNodes?: number
    }

type GraphSearchBody = {
  query?: string
  limit?: number
}

type GraphReviewAnalysisBody = {
  workflow?: GraphWorkflow
  base?: string
  changedFiles?: string[]
  maxDepth?: number
  maxNodes?: number
  maxFiles?: number
  maxHints?: number
  maxModules?: number
  sessionDir?: string
  writeArtifacts?: boolean
}

const REVIEW_ANALYSIS_CACHE_TTL_MS = 30_000
const REVIEW_ANALYSIS_TIMEOUT_MS = 15_000

type GraphReviewAnalysisRequest = GenerateGraphReviewAnalysisOptions

type GraphReviewAnalysisRunner = (
  request: GraphReviewAnalysisRequest,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<unknown>

type GraphRouterOptions = {
  analysisRunner?: GraphReviewAnalysisRunner
  analysisTimeoutMs?: number
  analysisCacheTtlMs?: number
}

type CachedAnalysis = {
  expiresAt: number
  value: unknown
}

function isGraphQuery(value: unknown): value is GraphQuery {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { kind?: unknown }
  return candidate.kind === 'pattern' || candidate.kind === 'impact'
}

export function createGraphRouter(ocrDir: string, options: GraphRouterOptions = {}): Router {
  const router = Router()
  const repoRoot = dirname(ocrDir)
  const analysisRunner = options.analysisRunner ?? runGraphReviewAnalysisInWorker
  const analysisTimeoutMs = options.analysisTimeoutMs ?? readPositiveIntegerEnv(
    'OCR_GRAPH_REVIEW_ANALYSIS_TIMEOUT_MS',
    REVIEW_ANALYSIS_TIMEOUT_MS,
  )
  const analysisCacheTtlMs = options.analysisCacheTtlMs ?? REVIEW_ANALYSIS_CACHE_TTL_MS
  const reviewAnalysisCache = new Map<string, CachedAnalysis>()
  const reviewAnalysisInflight = new Map<string, Promise<unknown>>()

  router.get('/status', async (_req, res) => {
    try {
      res.json(await getGraphStatus({ repoRoot, ocrDir }))
    } catch (err) {
      console.error('Failed to fetch graph status:', err)
      res.status(500).json({ error: 'Failed to fetch graph status' })
    }
  })

  router.post('/query', async (req, res) => {
    try {
      const body = req.body as GraphQueryBody
      const query = isGraphQuery(body) ? body : body.query

      if (query && isGraphQuery(query)) {
        res.json(await queryGraph({ repoRoot, ocrDir, query }))
        return
      }

      if (body.kind === 'impact' && Array.isArray(body.changedFiles)) {
        res.json(await getImpactRadius({
          repoRoot,
          ocrDir,
          changedFiles: body.changedFiles,
          maxDepth: body.maxDepth,
          maxNodes: body.maxNodes,
        }))
        return
      }

      res.status(400).json({
        error: 'Invalid graph query body',
        expected: 'GraphQuery or { query: GraphQuery }',
      })
    } catch (err) {
      console.error('Failed to query graph:', err)
      res.status(500).json({ error: 'Failed to query graph' })
    }
  })

  router.post('/search', async (req, res) => {
    try {
      const body = req.body as GraphSearchBody
      if (typeof body.query !== 'string' || body.query.trim().length === 0) {
        res.status(400).json({
          error: 'Invalid graph search body',
          expected: '{ query: string, limit?: number }',
        })
        return
      }

      res.json(await searchGraph({
        repoRoot,
        ocrDir,
        query: body.query,
        limit: body.limit,
      }))
    } catch (err) {
      console.error('Failed to search graph:', err)
      res.status(500).json({ error: 'Failed to search graph' })
    }
  })

  router.post('/review-analysis', async (req, res) => {
    try {
      const body = req.body as GraphReviewAnalysisBody
      if (!isGraphWorkflow(body.workflow)) {
        res.status(400).json({
          error: 'Invalid graph review analysis body',
          expected: '{ workflow: "review" | "map", ... }',
        })
        return
      }

      const request = {
        repoRoot,
        ocrDir,
        workflow: body.workflow,
        base: body.base,
        changedFiles: body.changedFiles,
        maxDepth: body.maxDepth,
        maxNodes: body.maxNodes,
        maxFiles: body.maxFiles,
        maxHints: body.maxHints,
        maxModules: body.maxModules ?? 0,
        sessionDir: body.sessionDir,
        writeArtifacts: body.writeArtifacts,
      }
      const cacheKey = stableKey(request)
      const cached = reviewAnalysisCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.value)
        return
      }

      let inflight = reviewAnalysisInflight.get(cacheKey)
      if (!inflight) {
        const abortController = new AbortController()
        const abortOnClose = (): void => abortController.abort()
        const abortOnResponseClose = (): void => {
          if (!res.writableEnded) abortOnClose()
        }
        req.once('aborted', abortOnClose)
        res.once('close', abortOnResponseClose)
        inflight = withTimeout(
          analysisRunner(request, analysisTimeoutMs, abortController.signal),
          analysisTimeoutMs,
        ).finally(() => {
          req.off('aborted', abortOnClose)
          res.off('close', abortOnResponseClose)
          reviewAnalysisInflight.delete(cacheKey)
        })
        reviewAnalysisInflight.set(cacheKey, inflight)
      }

      const analysis = await inflight

      if (!isGraphReviewAnalysis(analysis)) {
        console.error('Generated invalid graph review analysis payload')
        res.status(500).json({ error: 'Invalid graph review analysis response' })
        return
      }

      reviewAnalysisCache.set(cacheKey, {
        expiresAt: Date.now() + analysisCacheTtlMs,
        value: analysis,
      })
      res.json(analysis)
    } catch (err) {
      if (err instanceof Error && err.message === 'graph_review_analysis_timeout') {
        res.status(504).json({ error: 'Graph review analysis timed out' })
        return
      }
      if (err instanceof Error && err.message === 'graph_review_analysis_cancelled') {
        if (!res.headersSent) {
          res.status(499).json({ error: 'Graph review analysis cancelled' })
        }
        return
      }
      console.error('Failed to generate graph review analysis:', err)
      res.status(500).json({ error: 'Failed to generate graph review analysis' })
    }
  })

  return router
}

async function runGraphReviewAnalysisInWorker(
  request: GraphReviewAnalysisRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GraphReviewAnalysis> {
  const workerPath = await resolveGraphReviewAnalysisWorkerPath()
  return new Promise<GraphReviewAnalysis>((resolvePromise, rejectPromise) => {
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: request,
    })
    let settled = false
    const timeout = setTimeout(() => {
      worker.terminate().catch(() => undefined)
      finish(rejectPromise, new Error('graph_review_analysis_timeout'))
    }, timeoutMs)
    const abort = (): void => {
      worker.terminate().catch(() => undefined)
      finish(rejectPromise, new Error('graph_review_analysis_cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.once('message', (message: unknown) => {
      const response = message as {
        ok?: boolean
        value?: unknown
        error?: { message?: string; stack?: string }
      }
      if (response.ok) {
        if (isGraphReviewAnalysis(response.value)) {
          finish(resolvePromise, response.value)
        } else {
          finish(rejectPromise, new Error('Invalid graph review analysis response'))
        }
        return
      }
      const error = new Error(response.error?.message ?? 'Graph review analysis worker failed')
      if (response.error?.stack) error.stack = response.error.stack
      finish(rejectPromise, error)
    })

    worker.once('error', (error) => {
      finish(rejectPromise, error)
    })

    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(rejectPromise, new Error(`Graph review analysis worker exited with code ${code}`))
      }
    })

    function finish<T>(callback: (value: T) => void, value: T): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
  })
}

async function resolveGraphReviewAnalysisWorkerPath(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolveDashboardPackageRoot(here)
  const candidates = [
    resolve(here, 'graph-review-analysis-worker.js'),
    resolve(here, '../workers/graph-review-analysis-worker.js'),
    resolve(packageRoot, 'dist/graph-review-analysis-worker.js'),
  ]
  const builtWorkerPath = candidates.find((candidate) => existsSync(candidate))
  if (builtWorkerPath) {
    return builtWorkerPath
  }

  const sourceWorkerPath = resolve(packageRoot, 'src/server/workers/graph-review-analysis-worker.ts')
  if (!existsSync(sourceWorkerPath)) {
    throw new Error('Unable to locate graph review analysis worker')
  }

  const devWorkerPath = resolve(packageRoot, 'dist/graph-review-analysis-worker.js')
  mkdirSync(dirname(devWorkerPath), { recursive: true })
  const { build } = await import('esbuild')
  await build({
    entryPoints: [sourceWorkerPath],
    outfile: devWorkerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    conditions: ['source'],
    external: [
      'sql.js',
      'better-sqlite3',
      '@vscode/tree-sitter-wasm',
    ],
  })
  return devWorkerPath
}

function resolveDashboardPackageRoot(startPath: string): string {
  let dir = existsSync(startPath) ? dirname(startPath) : startPath
  while (dirname(dir) !== dir) {
    if (existsSync(resolve(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

function stableKey(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('graph_review_analysis_timeout')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}
