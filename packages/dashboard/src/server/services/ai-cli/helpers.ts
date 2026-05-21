/**
 * Shared helpers for AI CLI adapters.
 *
 * Consolidates utility functions that were previously duplicated across
 * command-runner.ts, chat-handler.ts, and post-handler.ts.
 */

import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { NormalizedEvent } from './types.js'

// ── Tool Detail Formatting ──
// Converts tool_use blocks into human-readable terminal lines.

export function formatToolDetail(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${input['file_path'] ?? 'file'}`
    case 'Write':
      return `Writing ${input['file_path'] ?? 'file'}`
    case 'Edit':
      return `Editing ${input['file_path'] ?? 'file'}`
    case 'Grep':
      return `Searching for "${input['pattern'] ?? '...'}"`
    case 'Glob':
      return `Finding files matching ${input['pattern'] ?? '...'}`
    case 'Bash': {
      let cmd = (input['command'] as string) ?? '...'
      // Strip "cd /long/path && " prefix — the cwd is already known
      cmd = cmd.replace(/^cd\s+\S+\s*&&\s*/, '')
      return `Running: ${cmd.slice(0, 120)}`
    }
    case 'Agent':
      return `Spawning agent: ${input['description'] ?? '...'}`
    default:
      return `Using ${tool}`
  }
}

// ── Assistant Text Extraction ──
// Extracts concatenated text from a complete Claude Code assistant message.

export function extractAssistantText(parsed: Record<string, unknown>): string {
  const msg = parsed['message'] as Record<string, unknown> | undefined
  const content = msg?.['content'] as Array<Record<string, unknown>> | undefined
  if (!content) return ''

  let text = ''
  for (const block of content) {
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      text += block['text']
    }
  }
  return text
}

// ── Temp File Management ──
// Writes prompts to secure temp files and provides cleanup.

const TEMP_BASE = join(tmpdir(), 'ocr-ai-prompts')

export function writeTempPrompt(prompt: string): string {
  try { mkdirSync(TEMP_BASE, { recursive: true, mode: 0o700 }) } catch { /* exists */ }
  const tmpFile = join(TEMP_BASE, `${randomUUID()}.txt`)
  writeFileSync(tmpFile, prompt, { mode: 0o600 })
  return tmpFile
}

export function cleanupTempFile(path: string): void {
  try { unlinkSync(path) } catch { /* ignore */ }
}

// ── Token Usage Extraction ──

type UsageEvent = Extract<NormalizedEvent, { type: 'usage' }>

function numberFrom(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value)
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.trunc(parsed)
      }
    }
  }
  return undefined
}

function costFrom(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
  }
  return undefined
}

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Best-effort extraction of vendor token usage from structured CLI JSON.
 *
 * Vendor schemas move over time, so this intentionally accepts common
 * snake_case/camelCase names used by Claude Code, Anthropic-style usage
 * payloads, OpenCode provider payloads, and completion-style summaries.
 */
export function extractUsageEvent(parsed: Record<string, unknown>): UsageEvent | null {
  const part = objectFrom(parsed['part'])
  const partTokens = part ? objectFrom(part['tokens']) : null
  const partTokenCache = partTokens ? objectFrom(partTokens['cache']) : null
  const candidates = [
    objectFrom(parsed['usage']),
    objectFrom(parsed['tokens']),
    objectFrom(parsed['tokenUsage']),
    objectFrom(parsed['metadata']),
    part,
    partTokens,
    partTokenCache,
    parsed,
  ].filter((candidate): candidate is Record<string, unknown> => candidate !== null)

  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let cacheReadTokens: number | undefined
  let cacheWriteTokens: number | undefined
  let reasoningTokens: number | undefined
  let totalTokens: number | undefined
  let costUsd: number | undefined

  for (const candidate of candidates) {
    inputTokens ??= numberFrom(candidate, [
      'input_tokens',
      'inputTokens',
      'prompt_tokens',
      'promptTokens',
      'input',
    ])
    outputTokens ??= numberFrom(candidate, [
      'output_tokens',
      'outputTokens',
      'completion_tokens',
      'completionTokens',
      'output',
    ])
    cacheReadTokens ??= numberFrom(candidate, [
      'cache_read_input_tokens',
      'cache_read_tokens',
      'cacheReadInputTokens',
      'cacheReadTokens',
      'read',
    ])
    cacheWriteTokens ??= numberFrom(candidate, [
      'cache_creation_input_tokens',
      'cache_write_tokens',
      'cacheCreationInputTokens',
      'cacheWriteTokens',
      'write',
    ])
    reasoningTokens ??= numberFrom(candidate, [
      'reasoning_tokens',
      'reasoningTokens',
      'thinking_tokens',
      'thinkingTokens',
      'reasoning',
    ])
    totalTokens ??= numberFrom(candidate, [
      'total_tokens',
      'totalTokens',
      'tokens',
      'total',
    ])
    costUsd ??= costFrom(candidate, [
      'cost_usd',
      'costUsd',
      'total_cost_usd',
      'totalCostUsd',
      'cost',
    ])
  }

  const hasUsage =
    inputTokens !== undefined ||
    outputTokens !== undefined ||
    cacheReadTokens !== undefined ||
    cacheWriteTokens !== undefined ||
    reasoningTokens !== undefined ||
    totalTokens !== undefined ||
    costUsd !== undefined

  if (!hasUsage) return null

  return {
    type: 'usage',
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    raw: parsed,
  }
}
