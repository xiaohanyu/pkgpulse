# Testing the extension locally

Run `npm test` first — it covers the pure parsing helpers (URL → package name,
API payload → day series) without a browser. The steps below are for the parts
that need a real page.

## 1. Load the extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top left) and select the repo directory
   (the one with `manifest.json` in it). The extension card should appear.
4. (Recommended) Click the puzzle-piece icon in the toolbar and **pin**
   "PkgTicker — Package Downloads Table" so its icon is always one click away.

If the card shows an **Errors** button, click it — a broken `manifest.json` or
a syntax error in a JS file will be listed there.

## 2. Test on a real package page

1. Open a package page, e.g.
   <https://github.com/yamlresume/yamlresume/pkgs/container/yamlresume>.
2. Click the extension's toolbar icon. A floating panel should appear **pinned
   to the top-right corner of the page**, below GitHub's header, with:
   - 30 rows, newest first, one per day, each with its download count;
   - a mini green bar per row (relative to the peak day);
   - the peak day highlighted in green;
   - a footer with **Total / Avg / Peak**.
3. Scroll the page — the panel should stay pinned to the top-right corner
   (`position: fixed`), and it must not be squeezed into a narrow column.
4. Sanity checks:
   - the footer **Total** equals the sum of the 30 rows;
   - the peak row matches the tallest bar in the SVG;
   - a day with `0` downloads shows `0` (the first days in the sample data).
5. Click the toolbar icon again — the panel should disappear.
6. Click it once more — the panel should reappear. (Toggle both ways.)
7. With the panel open, click the **✕** button in its header — it should close.
8. Open it again and press **Esc** — it should also close.

## 3. Test npm

1. Open an npm package page, e.g.
   <https://www.npmjs.com/package/yamlresume> (scoped names too:
   `npmjs.com/package/@scope/name`).
2. Click the toolbar icon — the same floating panel appears top-right, with
   the package name in its title, e.g. `yamlresume — last 30 days`. It shows
   "Loading downloads…" first, then the table. The data is fetched live from
   `api.npmjs.org` (CORS-open, no extra permissions).
3. Check a scoped package (e.g. `@yamlresume/core`) — the panel title should
   show the full name and the numbers should match npm's chart.
4. Toggle the panel off and on again within 5 minutes — the second open should
   be instant (the response is cached in `sessionStorage`).
5. A nonexistent package page (npm shows "Not found") — the panel itself should
   say `Couldn't load downloads: …` rather than showing an empty table.

## 4. Test edge cases

| Scenario | Expected behaviour |
| --- | --- |
| A page with no data, e.g. <https://github.com/home> | Small dark toast bottom-right: "No supported downloads page detected here." |
| Clicking the icon again while the toast is up | Toast is dismissed (toggle, no double-toast) |
| GitHub dark mode (Settings → Appearance, or OS dark theme) | Panel follows the page theme (GitHub's own CSS variables) |
| Non-package page (e.g. any random site) | Toast. Nothing breaks. |
| `chrome://settings` or the Web Store | A brief red `!` badge flashes on the toolbar icon (these pages can't be scripted, so nothing can be shown on the page itself) |

## 5. Test offline with the fixtures

- `test/fixture-github.html` — a minimal GitHub-style page with the exact chart SVG
  from a real package page.
- `test/fixture-npm.html` — an npm-style page with a sticky header. It also
  loads the real `inject.js` through a `<script src="/inject.js">` tag, so it
  renders on its own in the headless recipe in §8; the GitHub fixture does not.
  Testing it *with* the extension loaded therefore starts with the panel
  already open, and your first icon click hides it rather than showing it.

For the GitHub fixture (a plain `file://` page):

1. Open `chrome://extensions` → **Details** on this extension → enable
   **Allow access to file URLs** (needed once, just for `file://` pages).
2. Open `test/fixture-github.html` in Chrome (double-click it, or
   `open test/fixture-github.html`).
3. Click the toolbar icon — the same table should appear top-right, showing
   the sample data (54 on Sep 28, 42 on Oct 8, zeros before Sep 16…).

The npm fixture needs its hostname to match (`npmjs.com`), so it is served by
`tools/test-server.js` instead — see the next section.

## 6. After changing code

1. Go to `chrome://extensions` and click the **reload (↻)** icon on the
   extension's card. Errors from the new code appear on the card.
2. Go back to the package page and click the icon again — injection happens
   per click, so **no page reload is needed**. A panel left open by the old
   code is replaced automatically on the next click.

## 7. Debugging

- **`inject.js` problems** — on the page, open DevTools (`Cmd+Opt+I`) →
  *Console*. Errors thrown by the injected script show up there. You can also
  type `document.getElementById('pkgticker-panel')` in the console to check the
  panel's state.
- **`background.js` problems** — `chrome://extensions` → on the extension's
  card click **service worker** (or "Inspect views: service worker") to open a
  DevTools window attached to the background script.
- **Verify what the script sees** — in the page console:
  ```js
  document.querySelectorAll('rect[data-merge-count][data-date]').length
  // should be 30 on a package page
  ```
  If this returns `0`, GitHub changed its markup and the selector in
  `inject.js` needs updating.

## 8. Visual check without clicking (headless Chrome)

Note that headless Chrome needs an ordinary `--user-agent`, or Cloudflare
serves `npmjs.com` a challenge page instead of the package page.

You can render the panel without loading the extension at all: `inject.js`
only touches the DOM (plus one fetch for npm), so a page that includes it via
a `<script>` tag behaves the same. Because the adapters gate on the site's
hostname, `file://` pages won't match — `tools/test-server.js` stands in for
the real site instead:

```sh
# one-time: self-signed cert
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout /tmp/pkgticker-key.pem -out /tmp/pkgticker-cert.pem -subj "/CN=www.npmjs.com"

# serve the npm fixture as https://www.npmjs.com (real inject.js included)
node tools/test-server.js /tmp/pkgticker-cert.pem /tmp/pkgticker-key.pem 8443 test/fixture-npm.html

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-first-run --ignore-certificate-errors \
  --user-data-dir=/tmp/pkgticker-test/profile --hide-scrollbars \
  --host-resolver-rules="MAP www.npmjs.com 127.0.0.1:8443" \
  --window-size=1440,900 --virtual-time-budget=15000 \
  --screenshot=/tmp/pkgticker-test/npm-e2e.png \
  "https://www.npmjs.com/package/yamlresume"
```

The same recipe works for GitHub — serve `test/fixture-github.html` (or a saved
real package page: `curl -sL <package-url> -o page.html`, the chart is
server-rendered) on another port with `MAP github.com`, and load the package
URL. One flag differs:

- **npm** needs `--virtual-time-budget=15000` (above): the adapter's `fetch`
  must settle before the capture. With `--timeout` instead, Chrome screenshots
  before the response lands and you get a page with no panel.
- **GitHub** needs `--timeout=12000` instead: GitHub's long-lived websockets
  keep virtual time from ever completing, so a virtual-time run hangs.

The GitHub recipe also exercises the Turbo navigation hook, since GitHub's own
JS fires `turbo:load` on page load and the panel must survive it (it's kept
alive by an `isConnected` check against its chart).
