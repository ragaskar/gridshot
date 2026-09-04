import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  binProfilePreviewUrl,
  createBinProfile,
  deleteBinProfile,
  listBinProfiles,
  previewBinProfileGlb,
  updateBinProfile,
  uploadBinProfilePreview,
  type BinProfile,
  type BinProfileFields,
  type MagnetEasyRelease,
} from "../api";
import { BinViewer } from "../components/BinViewer";
import { decodeUrlState, pathForBinProfileEdit, pathForView } from "../urlState";

/** "Bin Profile YYYY-MM-DD" using the browser's local date (not UTC) — same
 *  convention as the combine editor's default Bin Library name. */
function defaultProfileName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `Bin Profile ${y}-${m}-${day}`;
}

const DEFAULT_DRAFT: BinProfileFields = {
  name: "",
  fill_height_pct: 100,
  live_grid: false,
  lip: true,
  allow_custom_shape: true,
  magnet_holes_default: false,
  magnet_hole_diameter_mm_default: 6.5,
  magnet_hole_depth_mm_default: 2.0,
  magnet_corners_only_default: false,
  magnet_easy_release_default: "off",
  lip_height_mm: null,
  lip_chamfer_top_mm: null,
  lip_straight_mm: null,
  lip_chamfer_bottom_mm: null,
  min_wall_mm: null,
  min_floor_mm: null,
  floor_thickness_mm: null,
  tool_wall_mm: null,
  tool_wall_flare_mm: null,
  tool_wall_reinforcement_h_mm: null,
  edge_margin_mm: null,
  magnet_hole_inset_from_edge_mm: null,
};

function profileToFields(p: BinProfile): BinProfileFields {
  const { id: _id, created_ts: _created_ts, has_preview_image: _has_preview_image, ...fields } = p;
  return fields;
}

type StructuralKey = Exclude<
  keyof BinProfileFields,
  "name" | "fill_height_pct" | "live_grid" | "lip" | "allow_custom_shape" | "magnet_holes_default"
  | "magnet_hole_diameter_mm_default" | "magnet_hole_depth_mm_default" | "magnet_corners_only_default"
  | "magnet_easy_release_default"
>;

/** Only meaningful while `lip` is on — rendered in the Stacking Lip section,
 *  disabled (not hidden) when it's off, so the layout doesn't jump around. */
const LIP_FIELDS: { key: StructuralKey; label: string; placeholder: string }[] = [
  { key: "lip_height_mm", label: "Lip height", placeholder: "4.4" },
  { key: "lip_chamfer_top_mm", label: "Lip top chamfer", placeholder: "1.9" },
  { key: "lip_straight_mm", label: "Lip straight section", placeholder: "1.8" },
  { key: "lip_chamfer_bottom_mm", label: "Lip bottom chamfer", placeholder: "0.7" },
];

/** Wall/floor thickness fields — apply regardless of fill height (min_wall_mm/
 *  min_floor_mm to a fully-filled bin, the rest to the general floor area's
 *  deck and tool walls below 100% fill). */
const WALL_FIELDS: { key: StructuralKey; label: string; placeholder: string }[] = [
  { key: "min_wall_mm", label: "Pocket wall thickness", placeholder: "2.0" },
  { key: "min_floor_mm", label: "Floor thickness under a pocket", placeholder: "1.2" },
  { key: "floor_thickness_mm", label: "General floor deck thickness", placeholder: "1.2" },
  { key: "tool_wall_mm", label: "Tool wall thickness", placeholder: "2.0" },
  { key: "tool_wall_flare_mm", label: "Tool wall base flare", placeholder: "0.8" },
  { key: "tool_wall_reinforcement_h_mm", label: "Tool wall base reinforcement height", placeholder: "1.0" },
  { key: "edge_margin_mm", label: "Edge margin", placeholder: "1.0" },
];

/** Named, saved presets of bin *style* parameters — lip, base geometry mode,
 *  magnet-hole defaults, whether custom bin shape is offered, and advanced
 *  structural constants. Replaces the old hardcoded Pocket/Corral/Live Grid
 *  buttons wherever a bin style is picked (once those pickers are converted). */
export function BinProfiles() {
  const [path, navigate] = useLocation();
  const [profiles, setProfiles] = useState<BinProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null | "new">(null);
  const [draft, setDraft] = useState<BinProfileFields>(DEFAULT_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glbUrlRef = useRef<string | null>(null);
  const previewSequence = useRef(0);

  const refresh = () => listBinProfiles().then((p) => { setProfiles(p); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { refresh(); }, []);

  // Deep-link: /bin-profiles/:id opens that profile's editor — reactively,
  // so it tracks the URL both ways (opens when a link lands here, closes
  // again on browser Back).
  useEffect(() => {
    if (!loaded) return;
    const id = decodeUrlState(path).editBinProfileId;
    if (!id) {
      setEditingId(null);
      return;
    }
    const found = profiles.find((p) => p.id === id);
    if (found) {
      setEditingId(id);
      setDraft(profileToFields(found));
    }
  }, [path, profiles, loaded]);

  function openNew() {
    setEditingId("new");
    setDraft({ ...DEFAULT_DRAFT, name: defaultProfileName() });
    setSaveErr(null);
  }

  function openEdit(p: BinProfile) {
    navigate(pathForBinProfileEdit(p.id));
  }

  function closeEditor() {
    if (editingId === "new") {
      setEditingId(null);
    } else {
      navigate(pathForView("binProfiles"));
    }
    setSaveErr(null);
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteBinProfile(id);
      setProfiles((current) => current.filter((p) => p.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function save() {
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const saved = editingId === "new"
        ? await createBinProfile(draft)
        : await updateBinProfile(editingId!, draft);
      if (canvasRef.current) {
        try {
          const blob: Blob | null = await new Promise((resolve) => canvasRef.current!.toBlob(resolve, "image/png"));
          if (blob) await uploadBinProfilePreview(saved.id, blob);
        } catch {
          // Thumbnail capture is a nice-to-have — a failed upload shouldn't
          // block the profile itself from saving.
        }
      }
      await refresh();
      navigate(pathForView("binProfiles"));
      setEditingId(null);
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  }

  // Live preview: re-render the synthetic 4x4-unit bin every time a style
  // field changes, debounced the same way the combine editor's own GLB
  // preview is.
  useEffect(() => {
    if (editingId === null) return;
    const sequence = ++previewSequence.current;
    setPreviewErr(null);
    const timer = window.setTimeout(() => {
      previewBinProfileGlb(draft)
        .then((blob) => {
          if (sequence !== previewSequence.current) return;
          const nextUrl = URL.createObjectURL(blob);
          if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
          glbUrlRef.current = nextUrl;
          setGlbUrl(nextUrl);
        })
        .catch((reason) => {
          if (sequence === previewSequence.current) setPreviewErr((reason as Error).message);
        });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, draft]);

  useEffect(() => () => {
    if (glbUrlRef.current) URL.revokeObjectURL(glbUrlRef.current);
  }, []);

  function set<K extends keyof BinProfileFields>(key: K, value: BinProfileFields[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function structuralValue(key: StructuralKey): string {
    const v = draft[key];
    return v === null || v === undefined ? "" : String(v);
  }

  function setStructural(key: StructuralKey, raw: string) {
    set(key, (raw.trim() === "" ? null : Number(raw)) as BinProfileFields[StructuralKey]);
  }

  if (editingId !== null) {
    const showCustomShapeWarning = draft.allow_custom_shape && (draft.fill_height_pct !== 100 || draft.live_grid);
    return (
      <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="grp-label mb-2">{editingId === "new" ? "New profile" : "Edit profile"}</div>
            <h1 className="titledev text-3xl">
              <span className="text-teal">BIN</span> <span className="text-muted">PROFILE</span>
            </h1>
          </div>
        </header>

        <div className="panel min-w-0 p-4 sm:p-6">
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-1">
              <div className="border border-line bg-field" style={{ borderRadius: 2 }}>
                <div className="relative h-[clamp(320px,50vh,520px)] w-full">
                  {glbUrl && <BinViewer url={glbUrl} onCanvasReady={(c) => { canvasRef.current = c; }} />}
                  {!glbUrl && !previewErr && (
                    <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted">
                      Building preview…
                    </div>
                  )}
                  {previewErr && (
                    <div className="absolute inset-0 grid place-items-center p-6 text-center font-mono text-xs text-orange">
                      {previewErr}
                    </div>
                  )}
                </div>
              </div>
              <p className="font-mono text-[10px] text-muted">
                Preview shows a 4×4 gridfinity-unit bin with a default 2×2 square pocket, so you can
                see the style without a real tool. Drag to orbit.
              </p>
            </div>

            <div className="space-y-3 min-w-0">
              <label className="block">
                <span className="font-mono text-[10px] uppercase text-muted">Name</span>
                <input
                  className="mono-input mt-1 w-full !px-2 !py-1 !text-sm"
                  aria-label="Bin profile name"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>

              <div>
                <label className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase text-muted">Fill height</span>
                  <span className="font-mono text-[10px] text-ink">{draft.fill_height_pct}%</span>
                </label>
                <input
                  aria-label="Fill height percent"
                  type="range" min={0} max={100} step={5}
                  className="mt-1 w-full"
                  value={draft.fill_height_pct}
                  onChange={(e) => set("fill_height_pct", Number(e.target.value))}
                />
                <p className="font-mono text-[9px] text-muted">
                  How far up the general floor area (outside every tool's own wall) solid material
                  rises — 0% is a fully hollow shell, 100% is fully solid.
                </p>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.live_grid}
                  onChange={(e) => set("live_grid", e.target.checked)}
                />
                <span className="font-mono text-[10px] uppercase text-muted">Live grid</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.allow_custom_shape}
                  onChange={(e) => set("allow_custom_shape", e.target.checked)}
                />
                <span className="font-mono text-[10px] uppercase text-muted">Allow custom grid shape</span>
              </label>
              {showCustomShapeWarning && (
                <p className="font-mono text-[9px] text-orange">
                  Custom bin shape only works at 100% fill height with live grid off — this
                  profile's checkbox has no effect until that's built for other fill levels.
                </p>
              )}

              <div className="border-t border-line pt-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.lip} onChange={(e) => set("lip", e.target.checked)} />
                  <span className="font-mono text-[10px] uppercase text-muted">Stacking Lip</span>
                </label>
                <div className="mt-2 space-y-2">
                  {LIP_FIELDS.map(({ key, label, placeholder }) => (
                    <label key={key} className="block">
                      <span className="block font-mono text-[9px] uppercase text-muted">{label} (mm)</span>
                      <input
                        aria-label={label}
                        className="mono-input mt-0.5 w-full !px-2 !py-1 !text-sm"
                        type="number" step={0.1}
                        placeholder={placeholder}
                        disabled={!draft.lip}
                        value={structuralValue(key)}
                        onChange={(e) => setStructural(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="border-t border-line pt-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.magnet_holes_default}
                    onChange={(e) => set("magnet_holes_default", e.target.checked)}
                  />
                  <span className="font-mono text-[10px] uppercase text-muted">Magnet Holes (default)</span>
                </label>
                {draft.magnet_holes_default && (
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <label className="min-w-0">
                      <span className="block font-mono text-[9px] uppercase text-muted">Diameter (mm)</span>
                      <input
                        aria-label="Default magnet hole diameter"
                        className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                        type="number" step={0.1} min={0.1}
                        value={draft.magnet_hole_diameter_mm_default}
                        onChange={(e) => set("magnet_hole_diameter_mm_default", Number(e.target.value))}
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="block font-mono text-[9px] uppercase text-muted">Depth (mm)</span>
                      <input
                        aria-label="Default magnet hole depth"
                        className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                        type="number" step={0.1} min={0.1} max={4.7}
                        value={draft.magnet_hole_depth_mm_default}
                        onChange={(e) => set("magnet_hole_depth_mm_default", Number(e.target.value))}
                      />
                    </label>
                    <label className="col-span-2 min-w-0">
                      <span className="block font-mono text-[9px] uppercase text-muted">Inset from edge (mm)</span>
                      <input
                        aria-label="Magnet hole inset from edge"
                        className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                        type="number" step={0.1}
                        placeholder="4.8"
                        value={structuralValue("magnet_hole_inset_from_edge_mm")}
                        onChange={(e) => setStructural("magnet_hole_inset_from_edge_mm", e.target.value)}
                      />
                    </label>
                    <label className="col-span-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.magnet_corners_only_default}
                        onChange={(e) => set("magnet_corners_only_default", e.target.checked)}
                      />
                      <span
                        className="font-mono text-[9px] uppercase text-muted"
                        title="Only at the bin's own outer corners — far fewer holes, faster to print"
                      >
                        Corners only (default)
                      </span>
                    </label>
                    <label className="col-span-2 min-w-0">
                      <span className="block font-mono text-[9px] uppercase text-muted">
                        Easy release (default)
                      </span>
                      <select
                        aria-label="Default magnet easy release"
                        className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                        value={draft.magnet_easy_release_default}
                        onChange={(e) =>
                          set("magnet_easy_release_default", e.target.value as MagnetEasyRelease)
                        }
                      >
                        <option value="off">Off</option>
                        <option value="auto">Auto</option>
                        <option value="inner">Inner</option>
                        <option value="outer">Outer</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-3">
                <span className="font-mono text-[10px] uppercase text-muted">Wall &amp; Floor Thickness</span>
                <div className="mt-2 space-y-2">
                  {WALL_FIELDS.map(({ key, label, placeholder }) => (
                    <label key={key} className="block">
                      <span className="block font-mono text-[9px] uppercase text-muted">{label} (mm)</span>
                      <input
                        aria-label={label}
                        className="mono-input mt-0.5 w-full !px-2 !py-1 !text-sm"
                        type="number" step={0.1}
                        placeholder={placeholder}
                        value={structuralValue(key)}
                        onChange={(e) => setStructural(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {saveErr && <p className="font-mono text-[10px] text-orange">{saveErr}</p>}

              <div className="grid grid-cols-2 gap-1 border-t border-line pt-3">
                <button className="btn btn-ghost text-xs" onClick={closeEditor} disabled={saveBusy}>
                  Cancel
                </button>
                <button className="btn text-xs" onClick={() => void save()} disabled={saveBusy || !draft.name.trim()}>
                  {saveBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="grp-label mb-2">{profiles.length} profiles</div>
          <h1 className="titledev text-3xl">
            <span className="text-teal">BIN</span> <span className="text-muted">PROFILES</span>
          </h1>
        </div>
      </header>

      <div className="panel min-w-0 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          <button
            type="button"
            className="btn btn-ghost flex min-h-[200px] flex-col items-center justify-center gap-2 border border-dashed border-line text-sm"
            style={{ borderRadius: 2 }}
            onClick={openNew}
          >
            <span className="text-2xl">+</span>
            <span>New bin profile</span>
          </button>
          {profiles.map((p) => (
            <div
              key={p.id}
              className="cursor-pointer border border-line bg-paper-2 overflow-hidden text-left"
              style={{ borderRadius: 2 }}
              onClick={() => openEdit(p)}
            >
              <div className="flex h-[120px] items-center justify-center bg-field">
                {p.has_preview_image ? (
                  <img
                    src={binProfilePreviewUrl(p.id)}
                    alt={`${p.name} preview`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="font-mono text-[10px] text-muted">No preview yet</span>
                )}
              </div>
              <div className="p-3 space-y-2 text-ink">
                <div className="font-mono text-sm text-ink">{p.name}</div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
                  <dt>Fill height</dt>
                  <dd className="text-right text-ink">{p.fill_height_pct}%{p.live_grid ? " + live grid" : ""}</dd>
                  <dt>Lip</dt>
                  <dd className="text-right text-ink">{p.lip ? "on" : "off"}</dd>
                </dl>
                <button
                  type="button"
                  className="btn btn-ghost w-full text-[10px] !px-2 !py-2"
                  disabled={busyId === p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${p.name}"? This can't be undone.`)) {
                      void remove(p.id);
                    }
                  }}
                >
                  × Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
