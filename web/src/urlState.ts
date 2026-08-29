import type { View } from "./state";

/** Views addressed by a plain `/view` path segment. `editor` and `result` use
 *  their own `/editor/:id` / `/result/:id` paths instead (pre-dating this
 *  module, and worth keeping so existing bookmarks/shares stay valid).
 *  `combine`/`compose` are selection-scoped the same way — they only make
 *  sense with a tool-id list (or, for combine, a saved-bin id to reopen), so
 *  they get their own path shapes below rather than a bare `/combine`.
 *  `tracing` is a transient in-flight step with nothing to resume after a
 *  reload, so it's never written to the URL and isn't accepted back out of
 *  one either. */
type LinkableView = Exclude<View, "tracing" | "editor" | "result" | "combine" | "compose">;

const LINKABLE_VIEWS: LinkableView[] = [
  "upload", "library", "bins", "binProfiles", "batch", "calibration", "reference",
];

/** Every view decodeUrlState can actually produce — every LinkableView, plus
 *  "combine"/"compose" (which get their own path shapes, not a bare
 *  `/combine`). Excludes "editor"/"result" (their own branches set `session`/
 *  `project` instead, never `view`) and "tracing" (never linkable), so this
 *  stays a safe argument to `navigate`, which rejects "tracing". */
type DecodedView = LinkableView | "combine" | "compose";

export interface DecodedUrlState {
  view: DecodedView | null;
  session: string | null;
  project: string | null;
  /** Tool ids for a fresh combine-editor selection, from `/combine/:ids`. */
  combineIds: string[] | null;
  /** Saved-bin id to reopen the combine editor from, from `/combine/reopen/:id`. */
  reopenBinId: string | null;
  /** Tool ids for a fresh compose-drawer selection, from `/compose/:ids`. */
  composeIds: string[] | null;
  /** Bin profile id to open the editor for, from `/bin-profiles/:id`. */
  editBinProfileId: string | null;
}

const NOTHING_DECODED: DecodedUrlState = {
  view: null, session: null, project: null, combineIds: null, reopenBinId: null, composeIds: null,
  editBinProfileId: null,
};

/** Parse a location.pathname into whichever deep-link identifiers it carries.
 *  Each path shape is structurally distinct (unlike the old `?view=&session=&
 *  project=` query params, which could technically collide), so there's no
 *  precedence to resolve between them. */
export function decodeUrlState(pathname: string): DecodedUrlState {
  const segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segs.length === 0) return NOTHING_DECODED;

  const [head, ...rest] = segs;
  if (head === "editor" && rest[0]) return { ...NOTHING_DECODED, session: rest[0] };
  if (head === "result" && rest[0]) return { ...NOTHING_DECODED, project: rest[0] };
  if (head === "compose" && rest[0]) {
    return { ...NOTHING_DECODED, view: "compose", composeIds: rest[0].split(",").filter(Boolean) };
  }
  if (head === "combine" && rest[0] === "reopen" && rest[1]) {
    return { ...NOTHING_DECODED, view: "combine", reopenBinId: rest[1] };
  }
  if (head === "combine" && rest[0]) {
    return { ...NOTHING_DECODED, view: "combine", combineIds: rest[0].split(",").filter(Boolean) };
  }
  // "binProfiles" is kebab-cased in the URL (matching the REST API's
  // /api/bin-profiles) but camelCased as a View, so it needs its own branch
  // rather than the generic same-name-as-the-view-id check below. A second
  // segment addresses that profile's editor, same shape as /combine/reopen/:id.
  if (head === "bin-profiles") {
    return rest[0]
      ? { ...NOTHING_DECODED, view: "binProfiles", editBinProfileId: rest[0] }
      : { ...NOTHING_DECODED, view: "binProfiles" };
  }
  if ((LINKABLE_VIEWS as string[]).includes(head)) return { ...NOTHING_DECODED, view: head as LinkableView };
  return NOTHING_DECODED;
}

/** Path for the given view (and, for editor/result, the id that addresses it).
 *  Returns "" for a view with nothing to encode (tracing; editor/result
 *  missing their id; combine/compose, which are always addressed via
 *  pathForCombine/pathForCompose/pathForBinReopen instead since a bare
 *  `/combine` or `/compose` has no selection to show) — callers should leave
 *  the URL alone rather than navigate to an empty path in that case. */
export function pathForView(
  view: View,
  ids: { session?: string | null; project?: string | null } = {},
): string {
  if (view === "editor") return ids.session ? `/editor/${encodeURIComponent(ids.session)}` : "";
  if (view === "result") return ids.project ? `/result/${encodeURIComponent(ids.project)}` : "";
  if (view === "combine" || view === "compose") return "";
  if (view === "tracing") return "";
  if (view === "upload") return "/";
  if (view === "binProfiles") return "/bin-profiles";
  return `/${view}`;
}

/** Path for opening the combine editor on a fresh tool selection — its own
 *  page, not nested under Library (which just starts the selection). */
export function pathForCombine(ids: string[]): string {
  return `/combine/${ids.map(encodeURIComponent).join(",")}`;
}

/** Path for reopening the combine editor from a saved Bin Library entry —
 *  its own page, not nested under Bin Library (which just lists entries). */
export function pathForBinReopen(binId: string): string {
  return `/combine/reopen/${encodeURIComponent(binId)}`;
}

/** Path for opening the compose-drawer page on a fresh tool selection — its
 *  own page, not nested under Library (which just starts the selection). */
export function pathForCompose(ids: string[]): string {
  return `/compose/${ids.map(encodeURIComponent).join(",")}`;
}

/** Path for opening a bin profile's editor, nested under the Bin Profiles
 *  page that hosts it. */
export function pathForBinProfileEdit(profileId: string): string {
  return `/bin-profiles/${encodeURIComponent(profileId)}`;
}
