import { parentPort, workerData } from 'node:worker_threads'
import { generateGraphReviewAnalysis } from '@open-code-review/graph'
import type { GenerateGraphReviewAnalysisOptions } from '@open-code-review/graph'

async function main(): Promise<void> {
  if (!parentPort) return
  try {
    const value = await generateGraphReviewAnalysis(workerData as GenerateGraphReviewAnalysisOptions)
    parentPort.postMessage({ ok: true, value })
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    })
  }
}

void main()
