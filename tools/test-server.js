#!/usr/bin/env node
/**
 * Local HTTPS server for testing adapters end-to-end in headless Chrome.
 *
 * Cloudflare serves headless Chrome a challenge instead of the real npm site
 * (an ordinary --user-agent gets past it, but a fixture is deterministic and
 * needs no network), so this server stands in for a registry site: it serves a
 * fixture page for every path and
 * the real inject.js at /inject.js. Combined with Chrome's
 * --host-resolver-rules, the browser loads e.g.
 * https://www.npmjs.com/package/yamlresume from here — the same hostname as
 * production, so the adapter's match() runs against a real URL and the npm
 * adapter fetches live data from api.npmjs.org.
 *
 * Usage:
 *   # one-time self-signed certificates (stay in /tmp, never committed)
 *   openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
 *     -keyout /tmp/pkgticker-key.pem -out /tmp/pkgticker-cert.pem -subj "/CN=www.npmjs.com"
 *
 *   node tools/test-server.js /tmp/pkgticker-cert.pem /tmp/pkgticker-key.pem test/fixture-npm.html
 *
 *   # headless run
 *   chrome --headless=new --ignore-certificate-errors \
 *     --host-resolver-rules="MAP www.npmjs.com 127.0.0.1:8443" \
 *     --screenshot=panel.png "https://www.npmjs.com/package/yamlresume"
 *
 * For the GitHub adapter, serve test/fixture-github.html (or a saved real
 * package page) on another port with MAP github.com instead.
 */

const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const USAGE = 'usage: test-server.js <cert> <key> [fixture.html] [port]'

const args = process.argv.slice(2)
if (args.length < 3) {
  console.error(USAGE)
  process.exit(1)
}

const [certPath, keyPath, ...rest] = args
let port = 8443
let fixturePath = null
for (const arg of rest) {
  // Remaining args in either order: a port, a fixture
  if (/^\d+$/.test(arg)) port = Number.parseInt(arg, 10)
  else fixturePath = arg
}
if (!fixturePath) {
  console.error(USAGE)
  process.exit(1)
}

const fixture = fs.readFileSync(fixturePath)
const inject = fs.readFileSync(path.join(ROOT, 'inject.js'))

const server = https.createServer(
  { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
  (req, res) => {
    const isInject = req.url.endsWith('/inject.js')
    const body = isInject ? inject : fixture
    res.writeHead(200, {
      'Content-Type': isInject
        ? 'application/javascript; charset=utf-8'
        : 'text/html; charset=utf-8',
      'Content-Length': body.length,
    })
    res.end(body)
  }
)

server.listen(port, '127.0.0.1', () => {
  console.log(
    `serving ${path.basename(fixturePath)} on https://127.0.0.1:${port} — Ctrl-C to stop`
  )
})
