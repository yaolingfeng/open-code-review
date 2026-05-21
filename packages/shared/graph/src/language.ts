import { extname } from "node:path";
import type { SupportedLanguage } from "./types.js";

const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".go": "go",
  ".java": "java",
  ".vue": "vue",
  ".sql": "sql",
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  "python",
  "javascript",
  "typescript",
  "go",
  "java",
  "vue",
  "sql",
];

export function detectLanguage(path: string): SupportedLanguage | null {
  return EXTENSION_TO_LANGUAGE[extname(path).toLowerCase()] ?? null;
}

export function isSupportedLanguage(path: string): boolean {
  return detectLanguage(path) !== null;
}
