import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  composeLibrary,
  drawerPreviewGlb,
  exportDrawer,
  type ComposeResult,
} from "../api";
import { DrawerViewer } from "../components/DrawerViewer";
import { decodeUrlState, pathForView } from "../urlState";

const PAL = ["#d65a54", "#5ab478", "#548cd6", "#e6be46", "#c85ac8", "#50c8c8", "#e69646", "#a050d6"];

/** The compose-drawer flow's own page — reached from the Tool Library
 *  (`/compose/:ids`) after picking tools to nest into one drawer. A real page
 *  rather than an inline panel on the Library page, so it gets its own URL,
 *  survives a reload, and Back leaves it the normal way. Doesn't validate
 *  `ids` against the library — composeLibrary reports a missing tool itself. */
export function ComposeDrawer() {
  const [path, navigate] = useLocation();
  const decoded = decodeUrlState(path);
  const ids = useMemo(() => decoded.composeIds ?? [], [decoded.composeIds]);

  const [cols, setCols] = useState(8);
  const [rows, setRows] = useState(6);
  const [overallHeight, setOverallHeight] = useState<number | "">("");
  const [composed, setComposed] = useState<ComposeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawerPreviewUrl, setDrawerPreviewUrl] = useState<string | null>(null);
  const [drawerPreviewBusy, setDrawerPreviewBusy] = useState(false);
  const [drawerPreviewError, setDrawerPreviewError] = useState<string | null>(null);
  const drawerPreviewUrlRef = useRef<string | null>(null);
  const drawerPreviewSequence = useRef(0);

  useEffect(() => () => {
    if (drawerPreviewUrlRef.current) URL.revokeObjectURL(drawerPreviewUrlRef.current);
  }, []);

  function clearDrawerPreview() {
    drawerPreviewSequence.current += 1;
    if (drawerPreviewUrlRef.current) {
      URL.revokeObjectURL(drawerPreviewUrlRef.current);
      drawerPreviewUrlRef.current = null;
    }
    setDrawerPreviewUrl(null);
    setDrawerPreviewError(null);
    setDrawerPreviewBusy(false);
  }

  function invalidateComposition() {
    clearDrawerPreview();
    setComposed(null);
  }

  async function compose() {
    if (!ids.length) return;
    setBusy(true);
    try {
      clearDrawerPreview();
      setComposed(null);
      setComposed(await composeLibrary(ids, cols, rows, overallHeight === "" ? null : overallHeight));
    } finally {
      setBusy(false);
    }
  }

  async function generateDrawerPreview() {
    if (!composed) return;
    const sequence = ++drawerPreviewSequence.current;
    setDrawerPreviewBusy(true);
    setDrawerPreviewError(null);
    try {
      const blob = await drawerPreviewGlb(ids, cols, rows, overallHeight === "" ? null : overallHeight);
      if (sequence !== drawerPreviewSequence.current) return;
      const nextUrl = URL.createObjectURL(blob);
      if (drawerPreviewUrlRef.current) URL.revokeObjectURL(drawerPreviewUrlRef.current);
      drawerPreviewUrlRef.current = nextUrl;
      setDrawerPreviewUrl(nextUrl);
    } catch (reason) {
      if (sequence === drawerPreviewSequence.current) {
        setDrawerPreviewError((reason as Error).message);
      }
    } finally {
      if (sequence === drawerPreviewSequence.current) setDrawerPreviewBusy(false);
    }
  }

  function close() {
    navigate(pathForView("library"));
  }

  const idColor = (id: string) => PAL[ids.indexOf(id) % PAL.length] || "#888";
  const drawerColors = useMemo(
    () => Object.fromEntries(
      (composed?.layout.placed ?? []).map((placement) => [
        placement.bin_id,
        idColor(placement.bin_id),
      ]),
    ),
    [composed, ids],
  );

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="grp-label mb-2">{ids.length} tool{ids.length === 1 ? "" : "s"} selected</div>
          <h1 className="titledev text-3xl">
            <span className="text-teal">COMPOSE</span> <span className="text-muted">DRAWER</span>
          </h1>
        </div>
        <button className="btn btn-ghost" onClick={close}>
          ← Back to library
        </button>
      </header>

      {ids.length === 0 ? (
        <div className="panel">
          <p className="font-body">
            No tools selected. Pick some from the <strong>Tool Library</strong> and use{" "}
            <strong>Compose drawer</strong>.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="panel h-fit min-w-0 p-4 sm:p-6">
            <div className="grp-label mb-4">Drawer settings</div>
            <div className="space-y-4">
              <label className="block">
                <span className="font-mono text-xs text-muted">Width (cells)</span>
                <input className="mono-input w-full" type="number" min={1} value={cols}
                  onChange={(e) => {
                    const next = Math.max(1, Math.round(Number(e.target.value)));
                    if (next !== cols) invalidateComposition();
                    setCols(next);
                  }} />
              </label>
              <label className="block">
                <span className="font-mono text-xs text-muted">Depth (cells)</span>
                <input className="mono-input w-full" type="number" min={1} value={rows}
                  onChange={(e) => {
                    const next = Math.max(1, Math.round(Number(e.target.value)));
                    if (next !== rows) invalidateComposition();
                    setRows(next);
                  }} />
              </label>
              <label className="block">
                <span className="font-mono text-xs text-muted">Overall height (mm)</span>
                <input className="mono-input w-full" type="number" min={0} step={1} value={overallHeight}
                  placeholder="auto (per bin)"
                  onChange={(e) => {
                    clearDrawerPreview();
                    setOverallHeight(e.target.value === "" ? "" : Number(e.target.value));
                  }} />
                <span className="font-mono text-[10px] text-muted">blank = each bin its own height; set for level tops</span>
              </label>
              <button className="btn btn-primary w-full" disabled={busy} onClick={compose}>
                {busy ? "…" : composed ? "Recompose" : `Compose ${ids.length} tool${ids.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div className="panel min-w-0 p-4 sm:p-6">
            {composed ? (
              <>
                <div className="grp-label mb-2">
                  Layout · uses {composed.layout.used_cols}×{composed.layout.used_rows}u
                </div>
                <div className="border border-line bg-field p-2" style={{ borderRadius: 2 }}>
                  <svg viewBox={`-0.2 -0.2 ${cols + 0.4} ${rows + 0.4}`} className="w-full">
                    {Array.from({ length: cols + 1 }, (_, c) => (
                      <line key={"c" + c} x1={c} y1={0} x2={c} y2={rows} stroke="#3a4046" strokeWidth={0.03} />
                    ))}
                    {Array.from({ length: rows + 1 }, (_, r) => (
                      <line key={"r" + r} x1={0} y1={r} x2={cols} y2={r} stroke="#3a4046" strokeWidth={0.03} />
                    ))}
                    {composed.layout.placed.map((p) => (
                      <rect key={p.bin_id} x={p.col + 0.04} y={p.row + 0.04}
                        width={p.grid_x - 0.08} height={p.grid_y - 0.08}
                        fill={idColor(p.bin_id) + "55"} stroke={idColor(p.bin_id)} strokeWidth={0.05} rx={0.08} />
                    ))}
                  </svg>
                </div>
                {composed.layout.overflow.length > 0 && (
                  <p className="font-mono text-xs text-muted mt-2">
                    {composed.layout.overflow.length} didn't fit — enlarge the drawer.
                  </p>
                )}
                <button
                  className="btn w-full mt-4"
                  disabled={drawerPreviewBusy || composed.layout.placed.length === 0}
                  onClick={generateDrawerPreview}
                >
                  {drawerPreviewBusy
                    ? "Generating 3D…"
                    : drawerPreviewUrl
                      ? "Regenerate 3D preview"
                      : "Generate 3D preview"}
                </button>
                {drawerPreviewError && (
                  <p className="mt-2 font-mono text-xs text-orange" role="alert">
                    {drawerPreviewError}
                  </p>
                )}
                {drawerPreviewUrl && (
                  <div className="mt-3">
                    <div
                      className="aspect-square w-full overflow-hidden border border-line bg-field"
                      style={{ borderRadius: 2 }}
                    >
                      <DrawerViewer url={drawerPreviewUrl} binColors={drawerColors} />
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-muted">
                      Exact bins seated in the full {cols}×{rows} Gridfinity socket grid · drag to orbit · scroll to zoom
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {composed.layout.placed.map((placement) => {
                        const tool = composed.tools.find((item) => item.id === placement.bin_id);
                        return (
                          <span key={placement.bin_id} className="inline-flex items-center gap-1 font-mono text-[10px] text-muted">
                            <span className="h-2 w-2" style={{ background: drawerColors[placement.bin_id] }} />
                            {tool?.label || placement.bin_id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button
                  className="btn btn-primary w-full mt-4"
                  onClick={() => exportDrawer(ids, cols, rows, overallHeight === "" ? null : overallHeight).catch(() => {})}
                >
                  ↓ Export drawer (3MF + layout)
                </button>
              </>
            ) : (
              <p className="font-body text-muted">Set the drawer dimensions and click Compose.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
