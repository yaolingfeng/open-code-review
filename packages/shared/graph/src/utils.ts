import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function resolveOcrDir(repoRoot: string, ocrDir?: string): string {
  return ocrDir ? resolve(ocrDir) : join(resolve(repoRoot), ".ocr");
}

export function graphDbPath(repoRoot: string, ocrDir?: string): string {
  return join(resolveOcrDir(repoRoot, ocrDir), "data", "graph.db");
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function fileInfo(path: string): { size: number; mtimeMs: number } {
  const stat = statSync(path);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function relativePath(repoRoot: string, path: string): string {
  return toPosixPath(relative(resolve(repoRoot), resolve(path)));
}

export function stableJson(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "{}";
  return JSON.stringify(value);
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function normalizeSignatureTokens(value: string): string {
  return tokenizeForSearch(value).join(" ");
}

export function tokenizeForSearch(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
  return [...new Set(tokens)];
}
