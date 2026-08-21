# Deep-link URLs

Every page, and the multi-tool combine editor modal, has a URL that reopens the same
content — reload the tab, or send someone the link, and you land back where you were
instead of the upload screen.

Identifiers live in the path, not the query string — `/library`, not `/?view=library` —
so they survive a full reload in every browser. (An earlier version of this used query
params for routes; those got dropped on reload in most browsers, since neither the Vite
dev server nor the FastAPI static mount serving the built SPA rewrites an arbitrary path
back to `index.html` unless told to. Both are configured to do that now — see
[Implementation](#implementation) below.)

## URL scheme

- `/library` / `/bins` / `/batch` / `/calibration` / `/reference` — the corresponding
  top-level page. The bare root `/` is the upload screen.
- `/editor/<id>` — the single-tool editor for that session.
- `/result/<id>` — a generated result.
- `/library/combine/<id1>,<id2>,...` — the multi-tool combine editor, open with that
  fresh tool selection.
- `/bins/<id>/combine` — the multi-tool combine editor, reopened from that Bin Library
  entry.

The URL updates as you navigate (clicking a nav link, opening or closing the combine
editor), so the browser's back/forward buttons work across pages the same way they do on
any other site.

## Implementation

Routing is hand-rolled, not a full router library: `web/src/urlState.ts` has the
pure encode/decode functions (`decodeUrlState`, `pathForView`, `pathForCombine`,
`pathForBinReopen`), and `App.tsx` uses [wouter](https://github.com/molefrog/wouter) —
a ~1.5KB hook-based library — only for its `useLocation()`/`navigate()` browser-history
plumbing (pushState/popstate, and same-tab broadcast so multiple components stay in sync
when one of them navigates). The Zustand store (`view`/`session`/`result`) stays the
single source of truth for which page is showing; the URL is synced to it in both
directions rather than driving rendering itself.

A path-based deep link also needs the server to answer a full reload of e.g. `/library`
with the SPA shell instead of a 404:

- The Vite dev server does this automatically (its default `appType: "spa"` behavior)
  — no config needed.
- In production, `gridshot/server/app.py`'s `spa_fallback` route serves `index.html`
  (no-cache, so a new build doesn't hide behind a stale cached one) for any GET that
  didn't match an API route or a real file under `web/dist`; hashed files under
  `/assets/*` get an immutable long-lived cache instead. This replaces the previous
  `StaticFiles(html=True)` mount at `/`, which only serves `index.html` for the root
  path — not for arbitrary unmatched paths, which is exactly why a path-based deep link
  used to 404 on reload.

## What isn't deep-linked

Reopening the combine editor from a URL restores which tools are selected (or which saved
bin), not an in-progress unsaved arrangement — a reload re-runs auto-pack on that
selection, the same as refreshing mid-edit today. The Arrange-2D/Preview-3D toggle inside
the editor, and its save/export dialogs, are transient UI state and aren't part of the
URL either.

The "working" screen shown while a trace/generate is in flight has nothing to resume after
a reload, so it's deliberately never written to the URL.
