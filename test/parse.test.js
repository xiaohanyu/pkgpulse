const test = require('node:test')
const assert = require('node:assert/strict')
const {
  npmPackageName,
  githubPackageName,
  githubDaysFromRects,
  npmDaysFromResponse,
} = require('../inject.js')

/** Stand-in for a chart <rect>, exposing only the attributes we read. */
const rect = (attrs) => ({ getAttribute: (name) => attrs[name] ?? null })

test('npmPackageName: plain and versioned paths', () => {
  assert.equal(npmPackageName('/package/react'), 'react')
  assert.equal(npmPackageName('/package/react/v/18.2.0'), 'react')
  assert.equal(npmPackageName('/package/react/'), 'react')
})

test('npmPackageName: scoped packages', () => {
  assert.equal(npmPackageName('/package/@scope/name'), '@scope/name')
  assert.equal(npmPackageName('/package/@scope/name/v/1.2.3'), '@scope/name')
  assert.equal(npmPackageName('/package/%40scope%2Fname'), '@scope/name')
})

test('npmPackageName: non-package paths', () => {
  assert.equal(npmPackageName('/'), null)
  assert.equal(npmPackageName('/package'), null)
  assert.equal(npmPackageName('/package/'), null)
  assert.equal(npmPackageName('/settings/tokens'), null)
})

test('githubPackageName: container and other registry types', () => {
  assert.equal(
    githubPackageName('/yamlresume/yamlresume/pkgs/container/yamlresume'),
    'yamlresume'
  )
  assert.equal(githubPackageName('/a/b/pkgs/container/name/'), 'name')
  assert.equal(
    githubPackageName('/a/b/pkgs/npm/%40scope%2Fname'),
    '@scope/name'
  )
  assert.equal(githubPackageName('/a/b/pkgs/npm/@scope/name'), '@scope/name')
})

test('githubPackageName: non-package paths', () => {
  assert.equal(githubPackageName('/yamlresume/yamlresume'), null)
  assert.equal(githubPackageName('/'), null)
})

test('githubDaysFromRects: maps and sorts ascending by date', () => {
  const days = githubDaysFromRects([
    rect({ 'data-date': '2026-10-09', 'data-merge-count': '2' }),
    rect({ 'data-date': '2026-10-07', 'data-merge-count': '4' }),
  ])
  assert.deepEqual(days, [
    { date: '2026-10-07', count: 4 },
    { date: '2026-10-09', count: 2 },
  ])
})

test('githubDaysFromRects: unparseable counts become 0', () => {
  assert.deepEqual(
    githubDaysFromRects([
      rect({ 'data-date': '2026-10-09', 'data-merge-count': '' }),
    ]),
    [{ date: '2026-10-09', count: 0 }]
  )
  assert.deepEqual(githubDaysFromRects([rect({ 'data-date': '2026-10-09' })]), [
    { date: '2026-10-09', count: 0 },
  ])
})

test('npmDaysFromResponse: maps and sorts ascending by date', () => {
  assert.deepEqual(
    npmDaysFromResponse([
      { day: '2026-10-02', downloads: 5 },
      { day: '2026-10-01', downloads: 0 },
    ]),
    [
      { date: '2026-10-01', count: 0 },
      { date: '2026-10-02', count: 5 },
    ]
  )
})
