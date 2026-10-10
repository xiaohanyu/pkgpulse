#!/usr/bin/env node
/**
 * Guard the release zip. `npm run dist` pipes `unzip -Z1` into this script,
 * which fails the build unless the archive is exactly what the Chrome Web
 * Store upload should contain.
 *
 * The file list in package.json's `dist` script is an allowlist, so the only
 * ways this can go wrong are someone editing that list, or a glob picking up a
 * file it should not. Both are silent otherwise — the store accepts a zip with
 * the wrong contents, and the first sign of trouble is a review query or an
 * install that downloads art and fixtures. Cheap to check, so check.
 */

const fs = require('node:fs')

// Everything the uploaded package may contain: the runtime files plus the
// manifest's icons. `icons/` is the directory entry `zip -r` adds.
const ALLOWED = new Set([
  'manifest.json',
  'background.js',
  'inject.js',
  'icons/',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
])

// Never part of the extension: store art, fixtures, tooling, dependencies.
const FORBIDDEN = ['store/', 'test/', 'tools/', 'node_modules/']

const entries = fs
  .readFileSync(0, 'utf8') // `unzip -Z1`, one path per line
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const problems = []

if (!entries.includes('manifest.json')) {
  const nested = entries.find((entry) => entry.endsWith('manifest.json'))
  problems.push(
    nested
      ? `manifest.json is at "${nested}" — the store requires it at the archive root`
      : 'the archive contains no manifest.json'
  )
}

for (const entry of entries) {
  const dir = FORBIDDEN.find((prefix) => entry.startsWith(prefix))
  if (dir) {
    problems.push(`${entry} is from ${dir}, which is not part of the extension`)
  } else if (!ALLOWED.has(entry)) {
    problems.push(`unexpected entry: ${entry}`)
  }
}

// The manifest is the file that was just zipped, so reading the working-tree
// copy is enough to cross-check that its icon paths actually shipped.
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  if (!entries.includes(path)) {
    problems.push(
      `manifest icons[${size}] points at ${path}, absent from the zip`
    )
  }
}

if (problems.length > 0) {
  console.error('release zip check FAILED:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `release zip ok: ${entries.length} entries, manifest.json at the root, no store/test/tools`
)
