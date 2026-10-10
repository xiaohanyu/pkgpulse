# Chrome Web Store listing copy

Paste these into the Store listing tab. All three are plain text — the Store does
not render markup, so the fenced blocks below are exactly what to paste.

The name and the summary are not dashboard-only fields: both come from
`manifest.json`, so editing them means re-running `npm run dist` and
re-uploading. Keep the values here identical to the manifest.

## Listing name (must match the manifest)

```
PkgTicker — Package Downloads Table
```

## Summary (132 characters max, from the manifest's description field)

```
Per-day download counts for GitHub package pages and npm pages, in a table, on click.
```

## Detailed description

```
PkgTicker turns the downloads chart on a package page into a per-day table you can
actually read.

Registries show a small sparkline of recent downloads but not the numbers behind
it. You can see the shape of a package's activity and not the values, so "how
many downloads did this get last Tuesday?" has no answer on the page.

Click the PkgTicker toolbar icon on a supported page and a panel appears in the
corner with one row per day:

- the date and that day's download count
- a small bar on each row, scaled to the busiest day, for at-a-glance comparison
- the peak day of the period highlighted
- a footer with the total, the daily average and the peak day

Click the icon again to hide the panel. The close button, the Escape key, and
navigating to another page also dismiss it.

WHERE IT WORKS

GitHub packages
On a page such as github.com/OWNER/REPO/pkgs/TYPE/NAME the counts are read from
the chart the page already draws, so nothing is fetched.

npm
On npmjs.com/package/NAME the counts come from npm's public downloads API, the
same public data behind npm's own chart. Scoped names such as @scope/name work
too. Reopening the panel within five minutes reuses the cached response.

The panel follows GitHub's light and dark themes.

PRIVACY

PkgTicker collects nothing: no analytics, no account, no backend.

- On GitHub pages nothing leaves your browser.
- On npm pages a single request reads npm's public downloads data for the package
  whose page you are on. It carries the package name and nothing about you. The
  response is cached in the tab's own session storage and is gone when the tab
  closes.
- The extension requests two permissions, activeTab and scripting, and no host
  permissions at all. It cannot read or change any page you have not clicked its
  icon on, and it does nothing until you click.

NOTES

- Download counts are inflated by CI and mirror traffic on every registry, so
  read the absolute numbers loosely. The day-to-day shape is the real signal.
- On a page with nothing to tabulate the extension says so rather than showing an
  empty table. On pages it cannot read at all (chrome:// pages, the Web Store) it
  marks the toolbar icon instead.

PkgTicker is free and open source under the MIT license. Source, issues and the
full privacy policy: https://github.com/xiaohanyu/pkgticker
```
