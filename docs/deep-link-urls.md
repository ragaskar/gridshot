# Deep-link URLs

Every page, and the multi-tool combine editor modal, has a URL that reopens the same
content — reload the tab, or send someone the link, and you land back where you were
instead of the upload screen.

## URL scheme

- `?view=library` / `?view=bins` / `?view=batch` / `?view=calibration` / `?view=reference`
  — the corresponding top-level page. No `view=` param (a bare `/`) is the upload screen.
- `?session=<id>` — the single-tool editor for that session.
- `?project=<id>` — a generated result.
- `?combine=<id1>,<id2>,...` (alongside `?view=library`) — the multi-tool combine editor,
  open with that fresh tool selection.
- `?bin=<id>` (alongside `?view=bins`) — the multi-tool combine editor, reopened from that
  Bin Library entry.

The URL updates as you navigate (clicking a nav link, opening or closing the combine
editor), so the browser's back/forward buttons work across pages the same way they do on
any other site.

## What isn't deep-linked

Reopening the combine editor from a URL restores which tools are selected (or which saved
bin), not an in-progress unsaved arrangement — a reload re-runs auto-pack on that
selection, the same as refreshing mid-edit today. The Arrange-2D/Preview-3D toggle inside
the editor, and its save/export dialogs, are transient UI state and aren't part of the
URL either.

The "working" screen shown while a trace/generate is in flight has nothing to resume after
a reload, so it's deliberately never written to the URL.
