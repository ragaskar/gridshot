import type { View } from "./state";

/** Views addressed by a plain `view=` query param. `editor` and `result` use
 *  their own `session=`/`project=` params instead (pre-dating this module,
 *  and worth keeping so existing bookmarks/shares stay valid). `tracing` is
 *  a transient in-flight step with nothing to resume after a reload, so it's
 *  never written to the URL and isn't accepted back out of one either. */
type LinkableView = Exclude<View, "tracing" | "editor" | "result">;

const LINKABLE_VIEWS: LinkableView[] = [
  "upload", "library", "bins", "batch", "calibration", "reference",
];

export interface DecodedUrlState {
  view: LinkableView | null;
  session: string | null;
  project: string | null;
}

/** Parse a location.search string into whichever deep-link identifiers it
 *  carries. Precedence when more than one is present: project > session >
 *  view, matching the app's existing "a specific result/session always wins"
 *  mount behaviour. */
export function decodeUrlState(search: string): DecodedUrlState {
  const q = new URLSearchParams(search);
  const project = q.get("project");
  const session = q.get("session");
  const view = q.get("view");
  return {
    view: (LINKABLE_VIEWS as string[]).includes(view ?? "") ? (view as LinkableView) : null,
    session,
    project,
  };
}

/** Query string for the given view (and, for editor/result, the id that
 *  addresses it). Returns "" for a view with nothing to encode (tracing, or
 *  editor/result missing their id) — callers should leave the URL alone
 *  rather than write an empty query in that case. */
export function encodeViewParams(
  view: View,
  ids: { session?: string | null; project?: string | null } = {},
): string {
  if (view === "editor") return ids.session ? `session=${encodeURIComponent(ids.session)}` : "";
  if (view === "result") return ids.project ? `project=${encodeURIComponent(ids.project)}` : "";
  if (view === "tracing") return "";
  const q = new URLSearchParams();
  q.set("view", view);
  return q.toString();
}

/** Current value of one query param, independent of the view/session/project
 *  params a page's own URL sync manages — for page-local deep-link state
 *  like Library's `combine=` or BinLibrary's `bin=`. */
export function getUrlParam(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

/** Set (or, with value null, remove) one query param without disturbing the
 *  others already on the URL. */
export function setUrlParam(name: string, value: string | null, opts: { push?: boolean } = {}) {
  const q = new URLSearchParams(location.search);
  if (value === null) q.delete(name);
  else q.set(name, value);
  const qs = q.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
  if (opts.push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}
