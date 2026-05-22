import { builtinModules } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectLanguage } from "../language.js";
import type { GraphEdgeInput, SupportedLanguage } from "../types.js";
import { relativePath, toPosixPath } from "../utils.js";

type PackageJson = {
  name?: unknown;
  main?: unknown;
  exports?: unknown;
  imports?: unknown;
};

const NODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"];
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const packageCache = new Map<string, { dir: string; json: PackageJson } | null>();

export function addNodeResolvedDependencyEdges(
  repoRoot: string,
  importerRelPath: string,
  language: SupportedLanguage,
  edges: GraphEdgeInput[],
): GraphEdgeInput[] {
  if (!isNodeEcosystemLanguage(language)) return edges;
  const additions: GraphEdgeInput[] = [];

  for (const edge of edges) {
    if (edge.kind !== "IMPORTS_FROM") continue;
    if (edge.sourceQualified !== importerRelPath) continue;
    const specifier = edge.targetQualified;
    if (BUILTINS.has(specifier)) continue;

    const resolved = resolveNodeSpecifier(repoRoot, importerRelPath, specifier);
    if (!resolved || resolved === specifier) continue;
    additions.push({
      kind: "DEPENDS_ON",
      sourceQualified: importerRelPath,
      targetQualified: resolved,
      filePath: importerRelPath,
      line: edge.line,
      confidence: 0.9,
      confidenceTier: "RESOLVED",
      metadata: {
        resolver: "nodejs",
        specifier,
      },
    });
  }

  return additions.length > 0 ? [...edges, ...additions] : edges;
}

function resolveNodeSpecifier(repoRoot: string, importerRelPath: string, specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = specifier.startsWith("/")
      ? resolve(repoRoot, `.${specifier}`)
      : resolve(repoRoot, dirname(importerRelPath), specifier);
    return resolveAsFileOrDirectory(repoRoot, base);
  }

  const packageInfo = findNearestPackage(repoRoot, resolve(repoRoot, dirname(importerRelPath)));
  if (!packageInfo) return null;

  if (specifier.startsWith("#")) {
    return resolvePackageMap(repoRoot, packageInfo.dir, packageInfo.json.imports, specifier);
  }

  const parsed = parsePackageSpecifier(specifier);
  if (!parsed) return null;
  if (packageInfo.json.name !== parsed.packageName) return null;

  if (parsed.subpath) {
    return resolvePackageMap(repoRoot, packageInfo.dir, packageInfo.json.exports, `./${parsed.subpath}`) ??
      resolveAsFileOrDirectory(repoRoot, resolve(packageInfo.dir, parsed.subpath));
  }

  return resolvePackageMap(repoRoot, packageInfo.dir, packageInfo.json.exports, ".") ??
    resolveStringTarget(repoRoot, packageInfo.dir, packageInfo.json.main) ??
    resolveAsFileOrDirectory(repoRoot, resolve(packageInfo.dir, "index"));
}

function findNearestPackage(repoRoot: string, startDir: string): { dir: string; json: PackageJson } | null {
  let current = startDir;
  const root = resolve(repoRoot);
  while (current.startsWith(root)) {
    const cached = packageCache.get(current);
    if (cached !== undefined) return cached;
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const found = { dir: current, json: JSON.parse(readFileSync(packagePath, "utf-8")) as PackageJson };
        packageCache.set(startDir, found);
        packageCache.set(current, found);
        return found;
      } catch {
        packageCache.set(current, null);
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  packageCache.set(startDir, null);
  return null;
}

function parsePackageSpecifier(specifier: string): { packageName: string; subpath: string | null } | null {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@")
    ? parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
    : parts[0] ?? null;
  if (!packageName) return null;
  const subpath = parts.slice(packageName.startsWith("@") ? 2 : 1).join("/");
  return { packageName, subpath: subpath.length > 0 ? subpath : null };
}

function resolvePackageMap(
  repoRoot: string,
  packageDir: string,
  mapField: unknown,
  subpath: string,
): string | null {
  if (typeof mapField === "string" || Array.isArray(mapField)) {
    return subpath === "." ? resolvePackageTarget(repoRoot, packageDir, mapField) : null;
  }
  if (!isRecord(mapField)) return null;

  const exact = mapField[subpath];
  if (exact !== undefined) {
    return resolvePackageTarget(repoRoot, packageDir, exact);
  }

  for (const [key, value] of Object.entries(mapField)) {
    if (!key.includes("*")) continue;
    const [prefix = "", suffix = ""] = key.split("*");
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const matched = subpath.slice(prefix.length, subpath.length - suffix.length);
    return resolvePackageTarget(repoRoot, packageDir, value, matched);
  }

  if (subpath === "." && !Object.keys(mapField).some((key) => key.startsWith("."))) {
    return resolvePackageTarget(repoRoot, packageDir, mapField);
  }

  return null;
}

function resolvePackageTarget(
  repoRoot: string,
  packageDir: string,
  target: unknown,
  patternMatch = "",
): string | null {
  if (typeof target === "string") {
    return resolveStringTarget(repoRoot, packageDir, target.replace("*", patternMatch));
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolvePackageTarget(repoRoot, packageDir, item, patternMatch);
      if (resolved) return resolved;
    }
    return null;
  }

  if (isRecord(target)) {
    for (const condition of ["import", "default", "require", "node"]) {
      if (target[condition] === undefined) continue;
      const resolved = resolvePackageTarget(repoRoot, packageDir, target[condition], patternMatch);
      if (resolved) return resolved;
    }
  }

  return null;
}

function resolveStringTarget(repoRoot: string, packageDir: string, target: unknown): string | null {
  if (typeof target !== "string" || !target.startsWith(".")) return null;
  return resolveAsFileOrDirectory(repoRoot, resolve(packageDir, target));
}

function resolveAsFileOrDirectory(repoRoot: string, absPath: string): string | null {
  const file = resolveAsFile(repoRoot, absPath);
  if (file) return file;

  if (!isDirectory(absPath)) return null;
  const packagePath = join(absPath, "package.json");
  if (existsSync(packagePath)) {
    try {
      const json = JSON.parse(readFileSync(packagePath, "utf-8")) as PackageJson;
      const packageEntry = resolvePackageMap(repoRoot, absPath, json.exports, ".") ??
        resolveStringTarget(repoRoot, absPath, json.main);
      if (packageEntry) return packageEntry;
    } catch {
      return null;
    }
  }

  return resolveAsFile(repoRoot, join(absPath, "index"));
}

function resolveAsFile(repoRoot: string, absPath: string): string | null {
  for (const candidate of fileCandidates(absPath)) {
    if (!isFile(candidate)) continue;
    const rel = toPosixPath(relativePath(repoRoot, candidate));
    return detectLanguage(rel) ? rel : null;
  }
  return null;
}

function fileCandidates(absPath: string): string[] {
  if (detectLanguage(absPath)) return [absPath];
  return NODE_EXTENSIONS.map((extension) => `${absPath}${extension}`);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeEcosystemLanguage(language: SupportedLanguage): boolean {
  return language === "javascript" || language === "typescript" || language === "vue";
}
