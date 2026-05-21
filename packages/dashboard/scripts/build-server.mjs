import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  conditions: ['source'],
  external: [
    'sql.js',
    'better-sqlite3',
    '@vscode/tree-sitter-wasm',
    'esbuild',
    'chokidar',
    'socket.io',
  ],
}

await build({
  ...common,
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  banner: {
    js: 'import { createRequire as _cjsReq } from "module"; const require = _cjsReq(import.meta.url);',
  },
})

await build({
  ...common,
  entryPoints: ['src/server/workers/graph-review-analysis-worker.ts'],
  outfile: 'dist/graph-review-analysis-worker.js',
})
