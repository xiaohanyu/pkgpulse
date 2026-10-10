/**
 * PkgTicker — content script.
 *
 * Adds a per-day downloads table to supported package pages:
 *
 *   - GitHub packages (github.com/<owner>/<repo>/pkgs/<type>/<name>):
 *     reads the server-rendered SVG chart, one <rect> per day carrying
 *     data-date / data-merge-count.
 *   - npm (npmjs.com/package/<name>, scoped names included): fetches the
 *     public, CORS-open api.npmjs.org downloads API.
 *
 * background.js injects this file into the active tab on every toolbar-icon
 * click. Each run removes anything the previous run added, which is what gives
 * the icon its show/hide toggle behaviour.
 *
 * The whole file is wrapped in an IIFE: every click re-runs it in the *same*
 * isolated world, where a second `const` declaration at the top level is a
 * SyntaxError — one that executeScript still reports as success, so the click
 * would silently do nothing. Nothing here needs to outlive a run except the
 * `window` flags noted below.
 *
 * The pure helpers at the top are also require()-able from Node so they can be
 * unit-tested (test/parse.test.js) — the UI boots only in a browser.
 */

// IIFE — see the note at the top of this file.
;(() => {
  const PANEL_ID = 'pkgticker-panel'
  const TOAST_ID = 'pkgticker-toast'
  const NPM_API_TIMEOUT_MS = 8000
  const CACHE_TTL_MS = 5 * 60 * 1000

  // --- pure helpers -----------------------------------------------------------

  /** npm page pathname -> package name, or null. "/package/@s/n/v/1" -> "@s/n". */
  function npmPackageName(pathname) {
    if (!pathname.startsWith('/package/')) return null
    const segs = pathname
      .slice('/package/'.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent)
    if (segs.length === 0) return null
    return segs[0].startsWith('@') && segs.length > 1
      ? `${segs[0]}/${segs[1]}`
      : segs[0]
  }

  /**
   * GitHub package pathname -> package name, or null.
   * "/<owner>/<repo>/pkgs/<type>/<name>" -> "<name>". Scoped npm names arrive
   * as a single percent-encoded segment and are decoded; an unencoded
   * "@scope/name" tail is kept as two segments.
   */
  function githubPackageName(pathname) {
    const tail = pathname.split('/pkgs/')[1]
    const segs = tail ? tail.split('/').filter(Boolean) : []
    if (segs.length === 0) return null
    const last = segs.pop()
    const name = segs[segs.length - 1]?.startsWith('@')
      ? `${segs[segs.length - 1]}/${last}`
      : last
    try {
      return decodeURIComponent(name) || null
    } catch {
      return name
    }
  }

  /** Chart <rect> elements -> [{date, count}], ascending by date. */
  function githubDaysFromRects(rects) {
    return [...rects]
      .map((rect) => ({
        date: rect.getAttribute('data-date'),
        count: Number.parseInt(rect.getAttribute('data-merge-count'), 10) || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /** api.npmjs.org range payload -> [{date, count}], ascending by date. */
  function npmDaysFromResponse(downloads) {
    return downloads
      .map((entry) => ({ date: entry.day, count: entry.downloads }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  // --- small utilities --------------------------------------------------------

  /** Read a cached day-series, or null when absent or expired. */
  function cacheRead(key) {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return null
      const { at, days } = JSON.parse(raw)
      if (!Array.isArray(days) || Date.now() - at > CACHE_TTL_MS) return null
      return days
    } catch {
      return null
    }
  }

  /** Cache a day-series for CACHE_TTL_MS. */
  function cacheWrite(key, days) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), days }))
    } catch {
      /* storage unavailable (blocked cookies etc.) — just skip the cache */
    }
  }

  function describeError(err) {
    if (err?.name === 'AbortError') return 'request timed out'
    return err?.message ?? 'unknown error'
  }

  let dateFormatter = null

  function formatDate(iso) {
    const date = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(date.getTime())) return iso
    dateFormatter ??= new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    return dateFormatter.format(date)
  }

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  /** Small self-dismissing notice, for pages with nothing to tabulate. */
  function toast(message) {
    const node = el('div', null, message)
    node.id = TOAST_ID
    node.setAttribute(
      'style',
      [
        'position:fixed',
        'right:20px',
        'bottom:20px',
        'z-index:2147483647',
        'background:#24292f',
        'color:#ffffff',
        'padding:10px 14px',
        'border-radius:6px',
        'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif !important',
        'box-shadow:0 8px 24px rgba(0,0,0,.2)',
        'opacity:0',
        'transition:opacity .15s ease',
      ].join(';')
    )
    document.body.append(node)
    requestAnimationFrame(() => {
      node.style.opacity = '1'
    })
    setTimeout(() => {
      node.style.opacity = '0'
      setTimeout(() => node.remove(), 200)
    }, 2600)
  }

  // --- UI ---------------------------------------------------------------------

  async function main() {
    // Toggle off: a click always clears the previous panel/toast, and if there
    // was one, that click meant "hide" — so stop here instead of redrawing.
    const existingPanel = document.getElementById(PANEL_ID)
    const existingToast = document.getElementById(TOAST_ID)
    existingPanel?.remove()
    existingToast?.remove()
    if (existingPanel || existingToast) return

    // Each adapter matches one supported page and extracts its download series:
    // { title, days: [{date, count}] }, looked up once per run.
    let githubChart = null

    /** GitHub: the chart SVG holds one <rect> per day. */
    const githubPackages = {
      match: () => {
        if (!/(^|\.)github\.com$/.test(location.hostname)) return false
        githubChart = findGithubChart()
        return githubChart !== null
      },
      extract: async () => {
        if (!githubChart) return null
        const days = githubDaysFromRects(
          githubChart.querySelectorAll('rect[data-merge-count][data-date]')
        )
        return {
          // Same "<name> — last N days" title format as the npm adapter.
          title: `${githubPackageName(location.pathname) ?? 'Downloads'} — last ${days.length} days`,
          days,
        }
      },
    }

    /** npm: per-day downloads from the public, CORS-open downloads API. */
    const npm = {
      match: () =>
        /(^|\.)npmjs\.com$/.test(location.hostname) &&
        location.pathname.startsWith('/package/'),
      extract: async () => {
        const name = npmPackageName(location.pathname)
        if (!name) return null

        const cacheKey = `pkgticker:npm:${name}`
        const cached = cacheRead(cacheKey)
        if (cached)
          return { title: `${name} — last ${cached.length} days`, days: cached }

        // Scoped names need their slash encoded for the downloads API.
        const url = `https://api.npmjs.org/downloads/range/last-month/${name.replace('/', '%2F')}`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), NPM_API_TIMEOUT_MS)
        let res
        try {
          res = await fetch(url, { signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !Array.isArray(data.downloads)) {
          throw new Error(
            data.error ?? `npm downloads API returned ${res.status}`
          )
        }
        const days = npmDaysFromResponse(data.downloads)
        cacheWrite(cacheKey, days)
        return { title: `${name} — last ${days.length} days`, days }
      },
    }

    const site = [githubPackages, npm].find((adapter) => adapter.match())
    if (!site) {
      toast('No supported downloads page detected here.')
      return
    }

    // Show the panel straight away with a loading state, then fill it in — the
    // npm path takes a network round-trip.
    const panel = buildPanel()
    panel.__pkgtickerChart = githubChart // used to detect stale panels (GitHub)
    ;(document.body ?? document.documentElement).append(panel)
    hookDismissal()

    let series = null
    try {
      series = await site.extract()
    } catch (err) {
      renderPanelMessage(
        panel,
        `Couldn't load downloads: ${describeError(err)}.`
      )
      return
    }
    if (!series || series.days.length === 0) {
      renderPanelMessage(panel, 'No downloads data found on this page.')
      return
    }
    renderSeries(panel, series)
  }

  /** Escape closes the panel; SPA navigation dismisses it (wired once). */
  function hookDismissal() {
    if (!window.__pkgtickerHooked) {
      window.__pkgtickerHooked = true

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.getElementById(PANEL_ID)?.remove()
      })

      // GitHub is an SPA that swaps content without a reload (Turbo), so drop
      // the panel once its chart is no longer in the document. Turbo fires
      // turbo:load on the initial load too — the isConnected check keeps the
      // panel alive through that.
      // npm panels carry no chart (null), so the check must be guarded — an
      // absent chart is not a stale one.
      const dropIfStale = () => {
        document.getElementById(TOAST_ID)?.remove()
        const current = document.getElementById(PANEL_ID)
        if (
          current?.__pkgtickerChart &&
          !current.__pkgtickerChart.isConnected
        ) {
          current.remove()
        }
      }
      for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) {
        document.addEventListener(event, dropIfStale)
      }
    }

    // npm (Next.js) fires no Turbo events, so also watch the URL directly. The
    // handle lives on `window` rather than in a local: each injection gets a
    // fresh scope, so a local could not clear the previous run's timer, and
    // toggling off and on within a second would leave it running.
    clearInterval(window.__pkgtickerDismissTimer)
    const hrefAtBuild = location.href
    window.__pkgtickerDismissTimer = setInterval(() => {
      const live = document.getElementById(PANEL_ID)
      if (!live) {
        clearInterval(window.__pkgtickerDismissTimer)
      } else if (location.href !== hrefAtBuild) {
        live.remove()
        document.getElementById(TOAST_ID)?.remove()
        clearInterval(window.__pkgtickerDismissTimer)
      }
    }, 1000)
  }

  /** The chart SVG holding the most per-day rects (package pages have one). */
  function findGithubChart() {
    const counts = new Map()
    for (const rect of document.querySelectorAll(
      'rect[data-merge-count][data-date]'
    )) {
      const svg = rect.closest('svg')
      if (svg) counts.set(svg, (counts.get(svg) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }

  /** The panel shell: header, an empty scroll area, an empty stats footer. */
  function buildPanel() {
    const close = el('button', 'pkgticker-close', '✕')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close downloads table')
    close.addEventListener('click', () =>
      document.getElementById(PANEL_ID)?.remove()
    )

    const head = el('div', 'pkgticker-head')
    head.append(el('span', 'pkgticker-title', 'PkgTicker'), close)

    const scroll = el('div', 'pkgticker-scroll')
    scroll.append(el('div', 'pkgticker-msg', 'Loading downloads…'))

    const panel = el('div')
    panel.id = PANEL_ID
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', 'Package downloads')
    panel.append(buildStyle(), head, scroll, el('div', 'pkgticker-stats'))
    return panel
  }

  /** Fill a panel with a loaded series: title, table, footer. */
  function renderSeries(panel, series) {
    const { days, title } = series
    const total = days.reduce((sum, day) => sum + day.count, 0)
    const max = days.reduce((top, day) => Math.max(top, day.count), 0)
    const peakDay = days.find((day) => day.count === max)

    panel.querySelector('.pkgticker-title').textContent = title
    panel.setAttribute('aria-label', title)
    panel
      .querySelector('.pkgticker-scroll')
      .replaceChildren(buildTable(days, max))
    panel
      .querySelector('.pkgticker-stats')
      .replaceChildren(
        el('span', null, `Total: ${total.toLocaleString()}`),
        el('span', null, `Avg: ${(total / days.length).toFixed(1)}/day`),
        el(
          'span',
          null,
          `Peak: ${max.toLocaleString()} on ${formatDate(peakDay.date)}`
        )
      )
  }

  /** Replace the panel body with a single message (error / no data). */
  function renderPanelMessage(panel, message) {
    panel
      .querySelector('.pkgticker-scroll')
      .replaceChildren(el('div', 'pkgticker-msg', message))
    panel.querySelector('.pkgticker-stats').replaceChildren()
  }

  /** The day-by-day table, newest first, with a bar per row. */
  function buildTable(days, max) {
    const table = el('table')

    const dateHead = el('th', null, 'Date')
    dateHead.setAttribute('scope', 'col')
    const countHead = el('th', 'pkgticker-num', 'Downloads')
    countHead.setAttribute('scope', 'col')
    const barHead = el('th', 'pkgticker-barhead')
    // The bars only restate the counts in the previous column, so they are
    // decoration: hide them from assistive tech rather than announcing a blank
    // column header.
    barHead.setAttribute('aria-hidden', 'true')

    const headRow = el('tr')
    headRow.append(dateHead, countHead, barHead)
    const thead = el('thead')
    thead.append(headRow)

    const tbody = el('tbody')
    for (const day of [...days].reverse()) {
      const row = el('tr')
      if (max > 0 && day.count === max) row.classList.add('pkgticker-peak')
      row.append(
        el('td', null, formatDate(day.date)),
        el('td', 'pkgticker-num', day.count.toLocaleString())
      )
      const barCell = el('td', 'pkgticker-barcell')
      barCell.setAttribute('aria-hidden', 'true')
      const bar = el('div', 'pkgticker-bar')
      bar.style.width = `${max > 0 ? Math.max((day.count / max) * 100, day.count > 0 ? 3 : 0) : 0}%`
      barCell.append(bar)
      row.append(barCell)
      tbody.append(row)
    }

    table.append(thead, tbody)
    return table
  }

  function buildStyle() {
    const style = el('style')
    // Uses GitHub's own Primer CSS variables (with light-mode fallbacks), so
    // the panel matches the page in both light and dark mode.
    style.textContent = `
      #pkgticker-panel {
        position: fixed;
        top: 48px;
        right: 16px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        width: 340px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 96px);
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 8px;
        background: var(--bgColor-default, #ffffff);
        color: var(--fgColor-default, #1f2328);
        /* Pin the system sans stack rather than inheriting the host page's
           typography, which may be serif. !important because the panel is
           our own UI — it should look the same whatever CSS the page sets. */
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji",
          "Segoe UI Emoji" !important;
        font-size: 12px;
        line-height: 1.6;
        box-shadow: 0 8px 24px rgba(31, 35, 40, 0.16), 0 2px 8px rgba(31, 35, 40, 0.08);
        overflow: hidden;
      }
      #pkgticker-panel .pkgticker-head {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--borderColor-muted, #d1d9e0);
        font-weight: 600;
      }
      #pkgticker-panel .pkgticker-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #pkgticker-panel .pkgticker-close {
        all: unset;
        cursor: pointer;
        color: var(--fgColor-muted, #59636e);
        font-size: 14px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 4px;
      }
      #pkgticker-panel .pkgticker-close:hover {
        color: var(--fgColor-default, #1f2328);
        background: var(--bgColor-muted, #f6f8fa);
      }
      #pkgticker-panel .pkgticker-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }
      #pkgticker-panel .pkgticker-msg {
        padding: 16px 12px;
        color: var(--fgColor-muted, #59636e);
      }
      #pkgticker-panel table {
        width: 100%;
        border-collapse: collapse;
      }
      #pkgticker-panel th,
      #pkgticker-panel td {
        padding: 3px 12px;
        text-align: left;
        white-space: nowrap;
        font-family: inherit !important; /* defeat page rules on table cells */
      }
      #pkgticker-panel th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--bgColor-muted, #f6f8fa);
        border-bottom: 1px solid var(--borderColor-muted, #d1d9e0);
        color: var(--fgColor-muted, #59636e);
        font-weight: 500;
      }
      #pkgticker-panel tbody td {
        border-bottom: 1px solid var(--borderColor-muted, #d1d9e0);
      }
      #pkgticker-panel tbody tr:last-child td {
        border-bottom: none;
      }
      #pkgticker-panel .pkgticker-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #pkgticker-panel .pkgticker-barhead {
        width: 42%;
      }
      #pkgticker-panel .pkgticker-barcell {
        min-width: 100px;
      }
      #pkgticker-panel .pkgticker-bar {
        height: 8px;
        border-radius: 4px;
        background: var(--fgColor-success, #1a7f37);
        opacity: 0.3;
      }
      #pkgticker-panel tr.pkgticker-peak .pkgticker-num {
        color: var(--fgColor-success, #1a7f37);
        font-weight: 600;
      }
      #pkgticker-panel tr.pkgticker-peak .pkgticker-bar {
        opacity: 0.85;
      }
      #pkgticker-panel .pkgticker-stats {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        padding: 8px 12px;
        border-top: 1px solid var(--borderColor-muted, #d1d9e0);
        color: var(--fgColor-muted, #59636e);
      }
    `
    return style
  }

  // --- bootstrap --------------------------------------------------------------
  // Deliberately last: in a content script this call runs the UI, so every
  // top-level binding main() touches must already be initialized. (Calling it
  // higher up would leave any `const` declared below in its temporal dead
  // zone.) Under Node, hand the pure helpers to the unit tests instead.

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      npmPackageName,
      githubPackageName,
      githubDaysFromRects,
      npmDaysFromResponse,
    }
  } else {
    main()
  }
})()
