# PkgTicker

**PkgTicker — Package Downloads Table** — a Chrome extension (Manifest V3) that
turns the downloads chart on a package page into a table of per-day counts.
Supports:

- **GitHub packages** — `github.com/<owner>/<repo>/pkgs/<type>/<name>`
- **npm** — `npmjs.com/package/<name>` (including scoped `@scope/name`)

On a GitHub package page like
[`github.com/yamlresume/yamlresume/pkgs/container/yamlresume`](https://github.com/yamlresume/yamlresume/pkgs/container/yamlresume),
GitHub shows a total download count plus a small SVG sparkline of the last 30
days — but no way to see the actual numbers. This extension reads the chart's
underlying data and shows it as a table. On npm package pages it fetches the
same kind of per-day series from npm's public downloads API.

## Usage

1. Open any supported package page (GitHub packages or npm).
2. Click the extension's toolbar icon — a floating table panel appears pinned
   below the site's header, at the top-right corner of the page. It stays
   there while you scroll.
3. Click the icon again to hide it. The `✕` button also closes it, `Esc`
   closes it, and it disappears on its own when you navigate to another page.

The table lists each day newest-first with its download count, a mini bar for
at-a-glance comparison, and a footer with total / daily average / peak day.
The peak day is highlighted in green. On a page with nothing to tabulate (or
when the npm API can't be reached) the panel says so instead of a table.

## How it works

`inject.js` holds one adapter per supported site. An adapter matches the
current page and extracts a `{ title, days: [{date, count}] }` series; the
floating panel renderer is shared by all of them.

- **GitHub** — the chart is an SVG of one `<rect>` per day, where each rect
  carries `data-date` (e.g. `2026-10-09`) and `data-merge-count` (the number
  of downloads that day). The extension simply reads those attributes — no
  network requests.
- **npm** — npm renders its chart client-side, so the adapter fetches the
  public [`api.npmjs.org`](https://api.npmjs.org) downloads API
  (`/downloads/range/last-month/<name>`, CORS-open, scoped names have their
  slash percent-encoded). The request is aborted after 8s and the response is
  cached in `sessionStorage` for 5 minutes, so re-opening the panel is
  instant.

- `background.js` — listens for toolbar-icon clicks and injects `inject.js`
  into the active tab (requires only `activeTab` + `scripting` permissions).
  If a page can't be scripted at all (`chrome://` pages, the Web Store), it
  flashes a `!` badge on the icon.
- `inject.js` — matches the site, extracts the series, toggles the panel.
  The panel is `position: fixed`, 48px below the top of the viewport and 16px
  from its right edge, so it stays readable while scrolling; that clearance is
  hard-coded rather than measured per site. Styled with GitHub's Primer CSS
  variables, so it matches the page in light and dark mode.
  The whole file is an IIFE because injection re-runs it in the same isolated
  world on every click, where a top-level `const` would throw on the second
  click.

The pure helpers at the top of `inject.js` (URL → package name, API payload →
day series) are exported for Node when the file is `require`d, which is how
they are unit-tested without a browser.

## Adding a site

Add an adapter to the adapter list in `inject.js`: a `match()`
(hostname/path test) and an `extract()` returning `{ title, days }`. Anything
that can produce a per-day series works — an in-page chart, an embedded JSON
blob, or a public API.

## Development

```sh
npm test        # unit tests for the pure parsing helpers (node --test)
npm run lint    # biome check (npm run lint:fix to apply fixes)
npm run dist    # build pkgticker.zip with only the runtime files
```

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.

See [TESTING.md](TESTING.md) for the full local test guide — including offline
fixture pages and headless-browser recipes.

## Regenerating the icons

```sh
npm run icons
```

Writes the manifest icons to `icons/`, plus the store icon and promotional
tile to `store/` — see [Store listing assets](#store-listing-assets).

## Store listing assets

`store/` holds what the Chrome Web Store dashboard asks for. None of it is part
of the extension package (`npm run dist` does not include it).

| File | Dashboard field | Spec |
| --- | --- | --- |
| `icon128.png` | Store icon | 128x128, artwork at 96x96 with 16px transparent padding |
| `promo-440x280.png` | Small promo tile | 440x280 |
| `screenshots/*.png` | Screenshots | 1280x800, upload in filename order |

`npm run icons` regenerates the icon and the promo tile. The screenshots are
captures of the panel on live GitHub and npm pages, so they are taken by hand
rather than generated.

## Notes

- If GitHub changes its package-page markup, the selectors in `inject.js`
  (`rect[data-merge-count][data-date]`) may need updating.
- The panel lives at the top level of the page; a navigation hook (`turbo:load`
  / `pjax:end`, plus a URL watcher) removes it once its chart is no longer in
  the document, so it doesn't linger as you move around a site.
- Download counts on every registry are inflated by CI and mirror traffic, so
  treat the absolute numbers loosely — the day-to-day shape is the real
  signal.

## License & privacy

MIT — see [LICENSE](LICENSE). No data is collected or transmitted except the
package-name lookup against `api.npmjs.org`; see [PRIVACY.md](PRIVACY.md).
