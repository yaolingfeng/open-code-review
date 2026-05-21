import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync, cpSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const cliRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(cliRoot, '..', '..')
const dashboardRoot = resolve(cliRoot, '..', 'dashboard')

const { version } = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf-8'))
const require = createRequire(import.meta.url)
const graphRequire = createRequire(resolve(cliRoot, '..', 'shared', 'graph', 'package.json'))

const cjsBanner = 'import { createRequire as _cjsReq } from "module"; const require = _cjsReq(import.meta.url);'

function resolvePackageDir(packageName, requireCandidates = [require]) {
  for (const candidateRequire of requireCandidates) {
    try {
      return dirname(candidateRequire.resolve(packageName))
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`Unable to resolve ${packageName} from CLI or graph workspace dependencies`)
}

function newestMtime(paths) {
  let newest = 0
  for (const path of paths) {
    if (!existsSync(path)) continue
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry === 'dist' || entry === 'node_modules') continue
        newest = Math.max(newest, newestMtime([resolve(path, entry)]))
      }
    } else {
      newest = Math.max(newest, stat.mtimeMs)
    }
  }
  return newest
}

function ensureDashboardDistFresh() {
  const requiredOutputs = [
    resolve(dashboardRoot, 'dist', 'server.js'),
    resolve(dashboardRoot, 'dist', 'graph-review-analysis-worker.js'),
    resolve(dashboardRoot, 'dist', 'index.html'),
  ]
  const oldestOutput = Math.min(
    ...requiredOutputs.map((path) => existsSync(path) ? statSync(path).mtimeMs : 0),
  )
  const newestSource = newestMtime([
    resolve(dashboardRoot, 'src'),
    resolve(dashboardRoot, 'scripts'),
    resolve(dashboardRoot, 'package.json'),
    resolve(dashboardRoot, 'vite.config.ts'),
  ])
  if (oldestOutput >= newestSource) return

  execFileSync('pnpm', ['--dir', dashboardRoot, 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

ensureDashboardDistFresh()

// Main CLI entry point
await build({
  entryPoints: ['src/index.ts'],
  absWorkingDir: cliRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  minify: false,
  external: ['sql.js', 'better-sqlite3'],
  banner: {
    js: ['#!/usr/bin/env node', cjsBanner].join('\n'),
  },
  define: { __CLI_VERSION__: JSON.stringify(version) },
  tsconfig: 'tsconfig.json',
})

// Shared library subpath exports.
//
// Each of these is consumed by @open-code-review/dashboard via its
// own esbuild bundling. Library bundles must NOT carry the `cjsBanner`
// — the dashboard bundle adds its own banner once at the top, and
// duplicating the `_cjsReq` declaration via repeated banners across
// inlined subpath bundles produces a `SyntaxError: Identifier
// '_cjsReq' has already been declared` at runtime. The library code
// constructs its own `createRequire` inline (e.g. `db/index.ts`
// `locateWasm`), so no module-scope `require` is needed here.
const libraryBundle = (entryPoint, outfile, externals = []) => ({
  entryPoints: [entryPoint],
  absWorkingDir: cliRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  minify: false,
  external: externals,
  tsconfig: 'tsconfig.json',
})

await build(libraryBundle('src/lib/db/index.ts', 'dist/lib/db/index.js', ['sql.js']))
await build(libraryBundle('src/lib/runtime-config.ts', 'dist/lib/runtime-config.js'))
// `yaml` is CommonJS-published, and inlining it via esbuild emits a
// `require()` call that fails when the consuming dashboard server is
// loaded in dev mode (tsx watch, no `createRequire` banner). Keeping it
// external means node's ESM resolver picks the package's own entry point
// at runtime — works in both dev mode and production-bundled mode.
await build(libraryBundle('src/lib/team-config.ts', 'dist/lib/team-config.js', ['yaml']))
await build(libraryBundle('src/lib/models.ts', 'dist/lib/models.js'))
await build(libraryBundle('src/lib/vendor-resume.ts', 'dist/lib/vendor-resume.js'))

// Copy dashboard dist into CLI dist (cross-platform, replaces Unix-only cp -r)
const dashboardSrc = resolve(cliRoot, '..', 'dashboard', 'dist')
const dashboardDest = resolve(cliRoot, 'dist', 'dashboard')
rmSync(dashboardDest, { recursive: true, force: true })
cpSync(dashboardSrc, dashboardDest, { recursive: true })

// Copy Tree-sitter WASM assets into the published CLI dist. The graph engine is
// bundled into dist/index.js, but @vscode/tree-sitter-wasm resolves grammar
// binaries from disk at runtime.
const treeSitterWasmSrc = resolvePackageDir('@vscode/tree-sitter-wasm', [require, graphRequire])
const treeSitterWasmDest = resolve(cliRoot, 'dist', 'vendor', 'tree-sitter-wasm')
rmSync(treeSitterWasmDest, { recursive: true, force: true })
cpSync(treeSitterWasmSrc, treeSitterWasmDest, { recursive: true })
