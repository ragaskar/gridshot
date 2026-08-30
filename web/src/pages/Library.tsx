import { useEffect, useRef, useState } from "react";
import {
  cloneLibraryTool,
  createLibraryBackup,
  deleteLibraryTool,
  downloadLibraryArchive,
  getLibraryOutline,
  getLibraryPhotoOutline,
  getResult,
  libraryEditClick,
  libraryEditHistory,
  libraryEditSave,
  libraryEditStart,
  listLibrary,
  updateLibraryTool,
  type LibraryEditResult,
  type LibraryTool,
  type OutlineVariant,
  type PhotoOutline,
  type Poly,
} from "../api";
import { useApp } from "../state";
import { OutlineCorrectionEditor } from "../components/OutlineCorrectionEditor";
import { PhysicalCutoutEditor } from "../components/PhysicalCutoutEditor";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { ReadinessBadge, READINESS_LABEL, READINESS_TEXT_TONE } from "../components/ReadinessPanel";
import { useLocation } from "wouter";
import { commitOnChange } from "../domEvents";
import { pathForCombine, pathForCompose } from "../urlState";
import { applySelectionClick } from "../selection";
import { useBinProfiles } from "../useBinProfiles";

/** Tool library: individually-captured tools composed into one drawer. Select
 *  tools saved from separate captures, pick a drawer size, and nest them —
 *  building a big set from small, accurate, fully-on-mat captures. */
export function Library() {
  const [, navigate] = useLocation();
  const currentResult = useApp((s) => s.result);
  const setCurrentResult = useApp((s) => s.setResult);
  const binProfiles = useBinProfiles();
  const [tools, setTools] = useState<LibraryTool[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    label: string;
    polygon: Poly;
  } | null>(null);
  const [sam, setSam] = useState<{ id: string; sess: LibraryEditResult } | null>(null);
  const [viewing, setViewing] = useState<{ t: LibraryTool; data: PhotoOutline } | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tile" | "list">("tile");
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  async function openView(t: LibraryTool) {
    try {
      const data = await getLibraryPhotoOutline(t.id);
      if (data.has_photo) setViewing({ t, data });
      else toggle(t.id); // no photo → clicking just selects (old behaviour)
    } catch {
      toggle(t.id);
    }
  }
  // thumbnails live at a static URL; bump a version per tool so the <img>
  // reloads the regenerated image after an outline edit (else it's cached)
  const [bust, setBust] = useState<Record<string, number>>({});
  // prefer the real-photo crop when present (tells similar outlines apart)
  const thumbSrc = (t: LibraryTool) => {
    const base = t.photo_thumb ?? t.thumb;
    return bust[t.id] ? `${base}?v=${bust[t.id]}` : base;
  };

  async function openOutline(id: string) {
    try {
      const polygon = await getLibraryOutline(id);
      if (!polygon) throw new Error("this tool has no physical cutout");
      setEditing({
        id,
        label: tools.find((tool) => tool.id === id)?.label || id,
        polygon,
      });
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function saveOutline(polygon: Poly) {
    if (!editing) return;
    setBusy(true);
    try {
      await patch(editing.id, {
        outline: polygon,
        edit_source: "physical",
      });
      setEditing(null);
    } catch (e) {
      alert("Save failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openSam(id: string) {
    try {
      setSam({ id, sess: await libraryEditStart(id) });
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function saveSam(outlineVariant: OutlineVariant) {
    if (!sam) return;
    try {
      const saved = await libraryEditSave(sam.sess.session, outlineVariant);
      setTools((current) =>
        current.map((tool) => (tool.id === saved.id ? { ...tool, ...saved } : tool)),
      );
      setBust((value) => ({ ...value, [sam.id]: Date.now() }));
      setSam(null);
    } catch (e) {
      alert("Save failed: " + (e as Error).message);
    }
  }

  async function reopenAsCurrent(t: LibraryTool) {
    if (!t.source_project) {
      setLibraryNotice(
        "This tool has no capture project on record, so it can't be reopened as the current tool.",
      );
      return;
    }
    const isAlreadyCurrent = currentResult?.project === t.source_project;
    const currentIsUnsaved =
      !isAlreadyCurrent &&
      currentResult != null &&
      !tools.some((tool) => tool.source_project === currentResult.project);
    if (currentIsUnsaved) {
      const confirmed = window.confirm(
        "The current tool hasn't been saved to the library — reopening " +
          `"${t.label || t.id}" will replace it. Continue?`,
      );
      if (!confirmed) return;
    }
    setLibraryNotice(null);
    try {
      setCurrentResult(await getResult(t.source_project));
    } catch (e) {
      setLibraryNotice((e as Error).message);
    }
  }

  const refresh = () => listLibrary().then(setTools).catch(() => setTools([]));
  useEffect(() => { refresh(); }, []);

  /** Plain click toggles one tool (and becomes the shift-click anchor);
   *  shift-click selects the contiguous range between the anchor and this
   *  tool (or, with nothing selected yet, just this one) — see
   *  applySelectionClick. Blocked tools can't be clicked, and don't count
   *  toward range positions for tools that can. */
  const toggle = (id: string, shiftKey = false) => {
    if (tools.find((tool) => tool.id === id)?.readiness.status === "block") return;
    const selectableIds = tools.filter((t) => t.readiness.status !== "block").map((t) => t.id);
    const result = applySelectionClick(selectableIds, sel, anchorId, id, shiftKey);
    setSel(result.selection);
    setAnchorId(result.anchor);
  };

  const selectableIds = tools.filter((t) => t.readiness.status !== "block").map((t) => t.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.has(id));
  const someSelected = selectableIds.some((id) => sel.has(id));
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  });
  function toggleSelectAll() {
    if (allSelected) {
      setSel(new Set());
      setAnchorId(null);
    } else {
      setSel(new Set(selectableIds));
      setAnchorId(selectableIds[selectableIds.length - 1] ?? null);
    }
  }

  async function remove(id: string) {
    await deleteLibraryTool(id);
    setSel((s) => { const n = new Set(s); n.delete(id); return n; });
    refresh();
  }

  async function clone(id: string) {
    await cloneLibraryTool(id);
    refresh();
  }

  async function patch(id: string, changes: Parameters<typeof updateLibraryTool>[1]) {
    const u = await updateLibraryTool(id, changes);
    setTools((ts) => ts.map((x) => (x.id === id ? { ...x, ...u } : x)));
    if (u.readiness.status === "block") {
      setSel((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
    if ("outline" in changes || "thickness_mm" in changes || "silhouette_height_mm" in changes)
      setBust((b) => ({ ...b, [id]: Date.now() })); // outline/thumb regenerated
  }

  async function exportLibrary() {
    setLibraryNotice(null);
    try {
      await downloadLibraryArchive();
      setLibraryNotice("Portable library archive downloaded.");
    } catch (reason) {
      setLibraryNotice((reason as Error).message);
    }
  }

  async function backupLibrary() {
    setLibraryNotice(null);
    try {
      const saved = await createLibraryBackup();
      setLibraryNotice(
        `Saved ${saved.filename} with ${saved.tool_count} tool${saved.tool_count === 1 ? "" : "s"}.`,
      );
    } catch (reason) {
      setLibraryNotice((reason as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="grp-label mb-2">{tools.length} saved</div>
          <h1 className="titledev text-3xl">
            <span className="text-teal">TOOL</span> <span className="text-muted">LIBRARY</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn btn-ghost" onClick={backupLibrary}>
            Create backup
          </button>
          <button className="btn btn-ghost" onClick={exportLibrary}>
            Export library
          </button>
        </div>
      </header>

      {libraryNotice && (
        <div className="mb-5 border border-line bg-paper-2 px-4 py-3 font-mono text-xs text-knockout">
          {libraryNotice}
        </div>
      )}

      {tools.length === 0 && (
        <div className="panel">
          <p className="font-body">
            No saved tools yet. Trace a tool (or a small batch), then use{" "}
            <strong>Save to library</strong> on the result. Saved tools compose into a drawer here.
          </p>
        </div>
      )}

      {tools.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 font-mono text-xs text-muted">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                disabled={selectableIds.length === 0}
                onChange={toggleSelectAll}
              />
              {sel.size > 0 ? `${sel.size} selected` : "Select all"}
            </label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                className={`btn !px-3 !py-1 text-xs ${viewMode === "tile" ? "border-teal text-teal" : "btn-ghost"}`}
                onClick={() => setViewMode("tile")}
              >
                Tile
              </button>
              <button
                type="button"
                className={`btn !px-3 !py-1 text-xs ${viewMode === "list" ? "border-teal text-teal" : "btn-ghost"}`}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
            </div>
          </div>

          {viewMode === "tile" ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* tool grid */}
          <div className="panel min-w-0 p-4 sm:p-6">
            <div className="grp-label mb-4">01 · Select tools</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {tools.map((t) => {
                const on = sel.has(t.id);
                const blocked = t.readiness.status === "block";
                return (
                  <div
                    key={t.id}
                    className="border bg-paper-2 overflow-hidden"
                    style={{ borderRadius: 2, borderColor: on ? "var(--c-teal)" : "var(--c-line)" }}
                  >
                    <div className="relative bg-field">
                      <img
                        src={thumbSrc(t)}
                        alt={t.label || t.id}
                        className="w-full aspect-square object-contain p-3"
                        style={{ cursor: "zoom-in" }}
                        title="View the source photo and accepted selection"
                        onClick={() => openView(t)}
                      />
                      <button
                        className="absolute top-2 left-2 w-7 h-7 flex items-center justify-center font-mono text-sm border bg-field"
                        style={{
                          borderRadius: 2, lineHeight: 1,
                          borderColor: on ? "var(--c-teal)" : "var(--c-line)",
                          color: on ? "#50c8c8" : "var(--c-knockout)",
                        }}
                        disabled={blocked}
                        onClick={(e) => { e.stopPropagation(); toggle(t.id, e.shiftKey); }}
                        title={
                          blocked
                            ? t.readiness.checks
                              .filter((check) => check.status === "block")
                              .map((check) => check.message)
                              .join("\n")
                            : "Select for compose or combine"
                        }
                      >
                        {on ? "✓" : ""}
                      </button>
                      <button
                        className="absolute top-2 right-2 w-7 h-7 bg-field border border-line text-knockout hover:text-gold font-mono text-base"
                        onClick={(e) => { e.stopPropagation(); remove(t.id); }}
                        title="Delete tool"
                      >
                        ×
                      </button>
                    </div>
                    <div className="p-3 space-y-3 text-ink" onClick={(e) => e.stopPropagation()}>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase text-muted">Tool name</span>
                        <input
                          className="w-full bg-transparent border-b border-line font-mono text-sm text-ink py-1 outline-none placeholder:text-muted"
                          defaultValue={t.label}
                          placeholder="Unnamed tool"
                          onBlur={(e) => e.target.value !== t.label && patch(t.id, { label: e.target.value })}
                        />
                      </label>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] uppercase text-muted">Print readiness</span>
                        <ReadinessBadge readiness={t.readiness} />
                      </div>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase text-muted">Bin profile</span>
                        <select
                          className="mono-input mt-1 w-full !px-2 !py-1 !text-[10px]"
                          aria-label={`Bin profile for ${t.label || "this tool"}`}
                          value=""
                          onChange={(e) => {
                            const profile = binProfiles.find((p) => p.id === e.target.value);
                            if (!profile) return;
                            // lip isn't editable per-tool via this control today —
                            // updateLibraryTool's PATCH doesn't accept it — so only
                            // fill height/live grid and magnet-hole defaults apply here.
                            patch(t.id, {
                              fill_height_pct: profile.fill_height_pct,
                              live_grid: profile.live_grid,
                              magnet_holes: profile.magnet_holes_default,
                              magnet_hole_diameter_mm: profile.magnet_hole_diameter_mm_default,
                              magnet_hole_depth_mm: profile.magnet_hole_depth_mm_default,
                              magnet_corners_only: profile.magnet_corners_only_default,
                            }).catch(() => {});
                          }}
                        >
                          <option value="" disabled>fill {t.fill_height_pct}%{t.live_grid ? " + live grid" : ""}</option>
                          {binProfiles.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted">
                        <span>
                          {t.grid_x}×{t.grid_y}u · {t.derived_overall_height_mm ?? "—"}mm tall
                          {t.live_grid ? ` · ${t.derived_available_cells.length} live` : ""}
                        </span>
                        <button
                          className={`px-2 py-1 border ${t.finger_hole ? "text-teal border-teal" : "text-muted border-line"}`}
                          style={{ borderRadius: 2 }}
                          title={t.fill_height_pct !== 100 || t.live_grid
                            ? "enclosed access lobe inside the separator for easier tool removal"
                            : "finger scallop to lift the recessed tool out (full-depth pockets need it)"}
                          onClick={() => patch(t.id, { finger_hole: !t.finger_hole }).catch(() => {})}
                        >
                          Finger access: {t.finger_hole ? "on" : "off"}
                        </button>
                        <button
                          className={`px-2 py-1 border ${t.magnet_holes ? "text-teal border-teal" : "text-muted border-line"}`}
                          style={{ borderRadius: 2 }}
                          title="Cut magnet holes at each corner of every foot"
                          onClick={() => patch(t.id, { magnet_holes: !t.magnet_holes }).catch(() => {})}
                        >
                          Magnet holes: {t.magnet_holes ? "on" : "off"}
                        </button>
                      </div>
                      {t.magnet_holes && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="min-w-0">
                            <span className="block font-mono text-[9px] uppercase text-muted">Magnet diameter</span>
                            <input
                              aria-label="Magnet hole diameter in millimetres"
                              className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                              type="number" step={0.1} min={0.1}
                              defaultValue={t.magnet_hole_diameter_mm}
                              ref={commitOnChange((v) => Number(v) !== t.magnet_hole_diameter_mm && patch(t.id, { magnet_hole_diameter_mm: Number(v) }))}
                            />
                          </label>
                          <label className="min-w-0">
                            <span className="block font-mono text-[9px] uppercase text-muted">Magnet depth</span>
                            <input
                              aria-label="Magnet hole depth in millimetres"
                              className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                              type="number" step={0.1} min={0.1} max={4.7}
                              defaultValue={t.magnet_hole_depth_mm}
                              ref={commitOnChange((v) => Number(v) !== t.magnet_hole_depth_mm && patch(t.id, { magnet_hole_depth_mm: Number(v) }))}
                            />
                          </label>
                          <button
                            className={`px-2 py-1 border col-span-2 ${t.magnet_corners_only ? "text-teal border-teal" : "text-muted border-line"}`}
                            style={{ borderRadius: 2 }}
                            title="Only at the bin's own outer corners — far fewer holes, faster to print"
                            onClick={() => patch(t.id, { magnet_corners_only: !t.magnet_corners_only }).catch(() => {})}
                          >
                            Corners only: {t.magnet_corners_only ? "on" : "off"}
                          </button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <label className="min-w-0">
                          <span className="block font-mono text-[9px] uppercase text-muted">Silhouette height</span>
                          <input
                            aria-label="Tool thickness in millimetres"
                            className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                            type="number" step={0.5} min={0}
                            defaultValue={t.thickness_mm}
                            ref={commitOnChange((v) => Number(v) !== t.thickness_mm && patch(t.id, { thickness_mm: Number(v) }))}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="block font-mono text-[9px] uppercase text-muted">Full height</span>
                          <input
                            aria-label="Full tool height in millimetres"
                            className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                            type="number" step={0.5} min={0.1}
                            placeholder="optional"
                            defaultValue={t.full_height_mm ?? ""}
                            ref={commitOnChange((raw) => {
                              const value = raw === "" ? null : Number(raw);
                              if (value !== t.full_height_mm) patch(t.id, { full_height_mm: value }).catch(() => {});
                            })}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="block font-mono text-[9px] uppercase text-muted">
                            {t.fill_height_pct === 100 && !t.live_grid ? "Depth" : "Recess"}
                          </span>
                          <input
                            key={`d-${t.id}-${t.derived_key}`}
                            aria-label="Tool recess depth in millimetres"
                            className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                            style={{ color: t.pocket_depth_mm == null ? "var(--c-muted)" : undefined }}
                            type="number" step={0.5} min={0.1}
                            defaultValue={t.pocket_depth_mm ?? t.derived_pocket_depth_mm ?? ""}
                            title={t.pocket_depth_mm == null ? "Automatic recess depth; type to override" : "Manual override; clear for automatic"}
                            ref={commitOnChange((raw) => {
                              const v = raw === "" ? null : Number(raw);
                              const matchesDerived =
                                v != null &&
                                t.derived_pocket_depth_mm != null &&
                                v === t.derived_pocket_depth_mm;
                              patch(t.id, { pocket_depth_mm: matchesDerived ? null : v }).catch(() => {});
                            })}
                          />
                        </label>
                        <label className="min-w-0">
                          <span className="block font-mono text-[9px] uppercase text-muted">Clearance</span>
                          <input
                            aria-label="Pocket clearance in millimetres"
                            className="mono-input min-w-0 !px-2 !py-1 !text-sm"
                            type="number" step={0.25} min={0}
                            defaultValue={t.clearance_mm}
                            ref={commitOnChange((v) => Number(v) !== t.clearance_mm && patch(t.id, { clearance_mm: Number(v) }))}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
                        <button className="font-mono text-[10px] text-teal hover:underline" onClick={() => openOutline(t.id)}>
                          ✎ Edit physical cutout · R{t.outline_revision}
                        </button>
                        {t.has_photo && (
                          <button className="font-mono text-[10px] text-teal hover:underline" onClick={() => openSam(t.id)}>
                            ◐ Correct photo selection
                          </button>
                        )}
                        <button
                          className="font-mono text-[10px] text-teal hover:underline"
                          onClick={() => void clone(t.id)}
                          title="Duplicate this tool under a new id, so you can select two of the same tool in one combine bin/compose drawer"
                        >
                          ⧉ Clone
                        </button>
                        {t.source_project && (
                          <button
                            className="font-mono text-[10px] text-teal hover:underline"
                            onClick={() => reopenAsCurrent(t)}
                            title={
                              'Reopen this tool as "current tool" — examine its full ' +
                              "capture/calibration details, download its bin files, " +
                              "and regenerate it with adjusted settings"
                            }
                          >
                            ↺ Re-open as current
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* compose / combine controls */}
          <div className="panel h-fit min-w-0 p-4 sm:p-6">
            <div className="grp-label mb-4">02 · Compose / combine</div>
            <div className="space-y-4">
              <button
                className="btn btn-primary w-full"
                disabled={!sel.size}
                onClick={() => navigate(pathForCompose([...sel]))}
              >
                Compose {sel.size} tool{sel.size === 1 ? "" : "s"}…
              </button>
              {sel.size >= 1 && (
                <button
                  className="btn w-full"
                  onClick={() => {
                    navigate(pathForCombine([...sel]));
                  }}
                >
                  ⧉ Combine into ONE bin…
                </button>
              )}
            </div>
          </div>
        </div>
          ) : (
            <div className="space-y-4">
              <div className="panel p-4 sm:p-6">
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={!sel.size}
                    onClick={() => navigate(pathForCompose([...sel]))}
                  >
                    Compose {sel.size} Tool{sel.size === 1 ? "" : "s"}…
                  </button>
                  {sel.size >= 1 && (
                    <button
                      className="btn"
                      onClick={() => {
                        navigate(pathForCombine([...sel]));
                      }}
                    >
                      Combine {sel.size} Tool{sel.size === 1 ? "" : "s"}
                    </button>
                  )}
                </div>
              </div>

              <div className="panel !p-0 overflow-hidden">
                {tools.map((t) => {
                  const on = sel.has(t.id);
                  const blocked = t.readiness.status === "block";
                  return (
                    <div key={t.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={blocked}
                        title={
                          blocked
                            ? t.readiness.checks
                              .filter((check) => check.status === "block")
                              .map((check) => check.message)
                              .join("\n")
                            : "Select for compose or combine"
                        }
                        onClick={(e) => toggle(t.id, e.shiftKey)}
                        onChange={() => {}}
                      />
                      <button
                        className="h-10 w-10 shrink-0 overflow-hidden border border-line bg-field p-0.5"
                        style={{ borderRadius: 2 }}
                        title="View the source photo and accepted selection"
                        onClick={() => openView(t)}
                      >
                        <img src={thumbSrc(t)} alt="" className="h-full w-full object-contain" />
                      </button>
                      <button
                        className="min-w-0 flex-1 truncate text-left font-mono text-sm text-ink hover:text-teal hover:underline"
                        title='Reopen this tool as "current tool" — examine its full capture/calibration details, download its bin files, and regenerate it with adjusted settings'
                        onClick={() => reopenAsCurrent(t)}
                      >
                        {t.label || t.id}
                      </button>
                      <span
                        className={`w-14 shrink-0 text-right font-mono text-[10px] uppercase ${READINESS_TEXT_TONE[t.readiness.status]}`}
                        title={t.readiness.checks.filter((check) => check.status !== "pass").map((check) => check.message).join("\n")}
                      >
                        {READINESS_LABEL[t.readiness.status]}
                      </span>
                      <button
                        className="shrink-0 font-mono text-sm text-teal hover:text-knockout"
                        title="Duplicate this tool under a new id, so you can select two of the same tool in one combine bin/compose drawer"
                        onClick={() => void clone(t.id)}
                      >
                        ⧉
                      </button>
                      <button
                        className="shrink-0 font-mono text-base text-knockout hover:text-gold"
                        title="Delete tool"
                        onClick={() => remove(t.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setEditing(null)}
        >
          <div className="w-full max-w-[900px]" onClick={(e) => e.stopPropagation()}>
            <div className="font-mono text-xs text-knockout mb-2 truncate">
              Library cutout · {editing.label}
            </div>
            <PhysicalCutoutEditor
              initial={editing.polygon}
              busy={busy}
              onSave={saveOutline}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {sam && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setSam(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <OutlineCorrectionEditor
              session={sam.sess}
              onPrompt={(points, box) => libraryEditClick(sam.sess.session, points, box)}
              onHistory={(direction) => libraryEditHistory(sam.sess.session, direction)}
              onSave={(_state, outlineVariant) => saveSam(outlineVariant)}
              onCancel={() => setSam(null)}
              title="Library photo selection correction"
            />
          </div>
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setViewing(null)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PhotoLightbox
              data={viewing.data}
              label={viewing.t.label}
              onClose={() => setViewing(null)}
              onCutout={() => { const id = viewing.t.id; setViewing(null); openOutline(id); }}
              onRefine={() => { const id = viewing.t.id; setViewing(null); openSam(id); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
