import type { View } from "./state";

/** Views addressed by a plain `/view` path segment. `editor` and `result` use
 *  their own `/editor/:id` / `/result/:id` paths instead (pre-dating this
 *  module, and worth keeping so existing bookmarks/shares stay valid). `tracing`
 *  is a transient in-flight step with nothing to resume after a reload, so it's
 *  never written to the URL and isn't accepted back out of one either. */
type LinkableView = Exclude<View, "tracing" | "editor" | "result">;

const LINKABLE_VIEWS: LinkableView[] = [
  "upload", "library", "bins", "batch", "calibration", "reference",
];

export interface DecodedUrlState {
  view: LinkableView | null;
  session: string | null;
  project: string | null;
  /** Tool ids for a fresh combine-editor selection, from `/library/combine/:ids`. */
  combineIds: string[] | null;
  /** Saved-bin id to reopen the combine editor from, from `/bins/:id/combine`. */
  reopenBinId: string | null;
}

const NOTHING_DECODED: DecodedUrlState = {
  view: null, session: null, project: null, combineIds: null, reopenBinId: null,
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
  if (head === "library" && rest[0] === "combine" && rest[1]) {
    return { ...NOTHING_DECODED, view: "library", combineIds: rest[1].split(",").filter(Boolean) };
  }
  if (head === "bins" && rest[0] && rest[1] === "combine") {
    return { ...NOTHING_DECODED, view: "bins", reopenBinId: rest[0] };
  }
  if ((LINKABLE_VIEWS as string[]).includes(head)) return { ...NOTHING_DECODED, view: head as LinkableView };
  return NOTHING_DECODED;
}

/** Path for the given view (and, for editor/result, the id that addresses it).
 *  Returns "" for a view with nothing to encode (tracing, or editor/result
 *  missing their id) — callers should leave the URL alone rather than
 *  navigate to an empty path in that case. */
export function pathForView(
  view: View,
  ids: { session?: string | null; project?: string | null } = {},
): string {
  if (view === "editor") return ids.session ? `/editor/${encodeURIComponent(ids.session)}` : "";
  if (view === "result") return ids.project ? `/result/${encodeURIComponent(ids.project)}` : "";
  if (view === "tracing") return "";
  if (view === "upload") return "/";
  return `/${view}`;
}

/** Path for opening the combine editor on a fresh tool selection, nested
 *  under the Library page that hosts it. */
export function pathForCombine(ids: string[]): string {
  return `/library/combine/${ids.map(encodeURIComponent).join(",")}`;
}

/** Path for reopening the combine editor from a saved Bin Library entry,
 *  nested under the Bin Library page that hosts it. */
export function pathForBinReopen(binId: string): string {
  return `/bins/${encodeURIComponent(binId)}/combine`;
}
