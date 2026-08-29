import { useEffect, useRef, useState } from "react";
import { getSession } from "../api";
import { useApp, type View } from "../state";

type NavView = Exclude<View, "editor" | "result" | "tracing">;

const PRIMARY: { view: NavView; label: string }[] = [
  { view: "upload", label: "Capture" },
  { view: "batch", label: "Batch ZIP" },
  { view: "library", label: "Library" },
  { view: "bins", label: "Bin Library" },
  { view: "binProfiles", label: "Bin Profiles" },
  { view: "calibration", label: "Calibration" },
  { view: "reference", label: "Mat Reference" },
];

/** Persistent navigation for the stable application screens. Tool editing and
 * result state stay in Zustand, so leaving them does not lose the active tool. */
export function AppNavigation() {
  const view = useApp((state) => state.view);
  const session = useApp((state) => state.session);
  const params = useApp((state) => state.params);
  const result = useApp((state) => state.result);
  const currentToolView = useApp((state) => state.currentToolView);
  const navigate = useApp((state) => state.navigate);
  const navigateCurrentTool = useApp((state) => state.navigateCurrentTool);
  const setEditor = useApp((state) => state.setEditor);
  const [restoringTool, setRestoringTool] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Publishes the nav's own rendered height (it wraps to two lines on narrow
  // viewports, so it isn't a constant) as a CSS var — full-height page
  // layouts below it (e.g. the combine editor's sidebars) size against this
  // instead of guessing a fixed offset.
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => document.documentElement.style.setProperty("--app-nav-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (view === "tracing") return null;

  const onCurrentToolPage = view === "editor" || view === "result";
  const hasCurrentTool = Boolean(currentToolView && (session || result));

  async function openCurrentTool() {
    if (currentToolView !== "editor" || !session || !params) {
      navigateCurrentTool();
      return;
    }
    setRestoringTool(true);
    try {
      setEditor(await getSession(session.session), params);
    } catch {
      navigateCurrentTool();
    } finally {
      setRestoringTool(false);
    }
  }

  return (
    <nav ref={navRef} className="app-nav" aria-label="Primary">
      <div className="app-nav-inner">
        <button
          type="button"
          className="app-nav-brand"
          onClick={() => navigate("upload")}
          aria-label="GridShot capture"
        >
          <span>GRID</span><span>•</span><span>SHOT</span>
        </button>
        <div className="app-nav-links">
          {PRIMARY.map((item) => (
            <button
              type="button"
              key={item.view}
              className="app-nav-link"
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => navigate(item.view)}
            >
              {item.label}
            </button>
          ))}
          {hasCurrentTool && (
            <button
              type="button"
              className="app-nav-link"
              aria-current={onCurrentToolPage ? "page" : undefined}
              disabled={restoringTool}
              onClick={openCurrentTool}
            >
              {restoringTool ? "Restoring tool…" : "Current tool"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
