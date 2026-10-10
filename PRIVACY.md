# Privacy policy

PkgTicker shows a per-day downloads table on package pages it supports. It has
no server, no account system, and no analytics.

## What it does with data

- **Nothing is collected, stored remotely, or shared.** There is no backend,
  no telemetry, no tracking, and no advertising.
- **GitHub pages** — the numbers are read from the page you already have open
  (the chart's SVG). No network request is made.
- **npm pages** — the extension requests the package's public download counts
  from `https://api.npmjs.org/downloads/range/last-month/<package>`. That
  request contains only the package name taken from the URL you are viewing.
  Nothing about you, your browser, or your identity is sent.
- **Local cache** — the npm response is cached for 5 minutes in the page's own
  `sessionStorage` so repeated toggles don't re-fetch. It stays on your
  machine, is never transmitted, and is discarded when the tab closes.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Grants access to the current tab only after you click the toolbar icon, which is when the table is built. |
| `scripting` | Injects the panel-building script into that tab on that click. |

The extension has **no** host permissions: it cannot read or modify any page
you have not explicitly activated it on, and it never runs in the background
on its own.

## Remote code

All code is packaged inside the extension. Nothing is downloaded and executed
at runtime.

## Contact

Questions or concerns: open an issue at
<https://github.com/xiaohanyu/pkgticker/issues>.
