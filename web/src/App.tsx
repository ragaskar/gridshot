import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { navigate as pushPath } from "wouter/use-browser-location";
import { forgetActiveSession, loadActiveSession, useApp, type View } from "./state";
import { Upload } from "./pages/Upload";
import { Editor } from "./pages/SharedEditorPage";
import { Result } from "./pages/Result";
import { Library } from "./pages/Library";
import { BinLibrary } from "./pages/BinLibrary";
import { BinProfiles } from "./pages/BinProfiles";
import { Batch } from "./pages/Batch";
import { Calibration } from "./pages/Calibration";
import { MatReference } from "./pages/MatReference";
import { AppNavigation } from "./components/AppNavigation";
import { getSession, type GenerateParams, type Session, type TraceResult } from "./api";
import { decodeUrlState, pathForView } from "./urlState";

const DEFAULT_PARAMS = {
  thickness: 4,
  full_height: null,
  clearance: 1.0,
  bin_style: "pocket" as const,
  depth: null,
  overall_height: null,
  finger_hole: true,
  lip: true,
};

/** The URL-addressable identity of the current view — used to tell "the
 *  store just changed" from "the store just changed to match the URL we're
 *  already on" (e.g. after a popstate), so pushUrl below never double-pushes. */
function urlKeyFor(state: { view: View; session: Session | null; result: TraceResult | null }): string {
  if (state.view === "editor") return `editor:${state.session?.session ?? ""}`;
  if (state.view === "result") return `result:${state.result?.project ?? ""}`;
  return `view:${state.view}`;
}

function urlKeyFromPath(pathname: string): string {
  const d = decodeUrlState(pathname);
  if (d.session) return `editor:${d.session}`;
  if (d.project) return `result:${d.project}`;
  return `view:${d.view ?? "upload"}`;
}

export function hydrateFromUrl(
  setResult: (r: TraceResult) => void,
  setEditor: (s: Session, p: GenerateParams) => void,
  navigate: (v: Exclude<View, "tracing">) => void,
) {
  const decoded = decodeUrlState(location.pathname);
  const stored = loadActiveSession();
  if (decoded.project) {
    fetch(`/api/result/${decoded.project}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r: TraceResult) => setResult(r))
      .catch(() => {});
  } else if (decoded.session) {
    getSession(decoded.session)
      .then((s: Session) => setEditor(
        s,
        stored?.session === decoded.session ? stored.params : DEFAULT_PARAMS,
      ))
      .catch(() => forgetActiveSession());
  } else if (decoded.view) {
    // An explicit view path (e.g. a bookmark) wins even with a stored
    // session — only the bare root falls through to restoring it below.
    navigate(decoded.view);
  } else if (stored?.session) {
    // Bare root with a previously active session: restore it quietly (so
    // the "Current tool" nav button works) but land on the Tool Library
    // rather than jumping straight back into the editor.
    getSession(stored.session)
      .then((s: Session) => {
        setEditor(s, stored.params);
        navigate("library");
      })
      .catch(() => forgetActiveSession());
  }
}

export function App() {
  const [path] = useLocation();
  const view = useApp((s) => s.view);
  const setResult = useApp((s) => s.setResult);
  const setEditor = useApp((s) => s.setEditor);
  const navigate = useApp((s) => s.navigate);

  // Deep-links: /result/<id> reopens a stored result, /editor/<id> the
  // editor, /<view> everything else. Hydrate once on mount, then keep the
  // URL and the store in sync in both directions.
  useEffect(() => {
    hydrateFromUrl(setResult, setEditor, navigate);
  }, []); // eslint-disable-line

  useEffect(() => {
    const unsubscribe = useApp.subscribe((state) => {
      const key = urlKeyFor(state);
      if (key === urlKeyFromPath(location.pathname)) return; // already reflects this state
      const next = pathForView(state.view, {
        session: state.session?.session,
        project: state.result?.project,
      });
      if (!next) return; // tracing, or editor/result without an id yet — leave the URL alone
      pushPath(next);
    });
    return unsubscribe;
  }, []);

  // Reacts to path changes not caused by the push above — back/forward, or a
  // page pushing its own nested sub-path (combine editor). The mount-time
  // hydrate above already handled the initial path, so skip this effect's
  // own first run.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const key = urlKeyFor(useApp.getState());
    if (key === urlKeyFromPath(path)) return; // our own push, or a page-local sub-path change
    const decoded = decodeUrlState(path);
    if (decoded.project) {
      fetch(`/api/result/${decoded.project}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((r: TraceResult) => setResult(r))
        .catch(() => {});
    } else if (decoded.session) {
      getSession(decoded.session)
        .then((s: Session) => setEditor(s, DEFAULT_PARAMS))
        .catch(() => forgetActiveSession());
    } else {
      navigate(decoded.view ?? "upload");
    }
  }, [path, setResult, setEditor, navigate]);

  let page;
  if (view === "result") page = <Result />;
  else if (view === "library") page = <Library />;
  else if (view === "bins") page = <BinLibrary />;
  else if (view === "binProfiles") page = <BinProfiles />;
  else if (view === "batch") page = <Batch />;
  else if (view === "calibration") page = <Calibration />;
  else if (view === "reference") page = <MatReference />;
  else if (view === "editor") page = <Editor />;
  else if (view === "tracing") page = <Tracing />;
  else page = <Upload />;

  return (
    <>
      <AppNavigation />
      {page}
    </>
  );
}

function Tracing() {
  return (
    <div className="mx-auto max-w-container px-6 py-24 text-center">
      <div className="grp-label mb-4">Working</div>
      <h1 className="titledev text-2xl justify-center">
        <span className="text-teal">SEGMENT</span>
        <span className="text-muted">•</span>
        <span>CALIBRATE</span>
        <span className="text-muted">•</span>
        <span>GENERATE</span>
      </h1>
      <p className="font-mono text-xs text-muted mt-6" style={{ letterSpacing: "0.18em" }}>
        RECOVERING 1:1 OUTLINE · CORRECTING PARALLAX · BUILDING BIN
      </p>
    </div>
  );
}
