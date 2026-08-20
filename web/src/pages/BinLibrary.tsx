import { useEffect, useState } from "react";
import {
  deleteBin,
  exportSavedBin,
  exportSavedBinSlice,
  listBins,
  renameBin,
  type SavedBin,
} from "../api";
import { CombineEditor, type CombineEditorInitial } from "../components/CombineEditor";

/** Saved multi-tool combine-editor arrangements — a recipe (tools, placements,
 *  overrides, bin-wide settings), not a frozen geometry snapshot. Export and
 *  "Reopen" both regenerate from the tools' current library state. */
export function BinLibrary() {
  const [bins, setBins] = useState<SavedBin[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reopening, setReopening] = useState<SavedBin | null>(null);

  const refresh = () => listBins().then(setBins).catch(() => setBins([]));
  useEffect(() => { refresh(); }, []);

  async function rename(id: string, label: string) {
    try {
      const updated = await renameBin(id, label);
      setBins((current) => current.map((b) => (b.id === id ? updated : b)));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteBin(id);
      setBins((current) => current.filter((b) => b.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function exportBin(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      await exportSavedBin(id);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function exportSlice(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      await exportSavedBinSlice(id);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function reopenInitial(b: SavedBin): CombineEditorInitial {
    return {
      placements: b.placements,
      overrides: b.overrides,
      binStyle: b.bin_style,
      magnetHoles: b.magnet_holes,
      magnetHoleDiameterMm: b.magnet_hole_diameter_mm,
      magnetHoleDepthMm: b.magnet_hole_depth_mm,
      forceGx: b.force_gx,
      forceGy: b.force_gy,
    };
  }

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="grp-label mb-2">{bins.length} saved</div>
          <h1 className="titledev text-3xl">
            <span className="text-teal">BIN</span> <span className="text-muted">LIBRARY</span>
          </h1>
        </div>
      </header>

      {notice && (
        <div className="mb-5 border border-line bg-paper-2 px-4 py-3 font-mono text-xs text-knockout">
          {notice}
        </div>
      )}

      {bins.length === 0 && (
        <div className="panel">
          <p className="font-body">
            No saved bins yet. Arrange a multi-tool bin from the{" "}
            <strong>Tool Library</strong>, then use <strong>Save to Bin Library</strong> once
            you're happy with the arrangement.
          </p>
        </div>
      )}

      {bins.length > 0 && (
        <div className="panel min-w-0 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
            {bins.map((b) => (
              <div
                key={b.id}
                className="border border-line bg-paper-2 overflow-hidden"
                style={{ borderRadius: 2 }}
              >
                <div className="p-3 space-y-3 text-field">
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase text-muted">Name</span>
                    <input
                      className="w-full bg-transparent border-b border-line font-mono text-sm text-field py-1 outline-none placeholder:text-muted"
                      defaultValue={b.label}
                      placeholder="Unnamed bin"
                      key={`${b.id}-${b.label}`}
                      onBlur={(e) => e.target.value !== b.label && rename(b.id, e.target.value)}
                    />
                  </label>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
                    <dt>Saved</dt>
                    <dd className="text-right text-field">
                      {new Date(b.created_ts * 1000).toLocaleDateString()}
                    </dd>
                    <dt>Bin style</dt>
                    <dd className="text-right text-field">{b.bin_style}</dd>
                  </dl>
                  <div className="font-mono text-[10px] text-muted">
                    <span className="uppercase">Tools</span>
                    <p className="mt-1 text-field">
                      {b.tool_labels.map((label) => label ?? "(deleted tool)").join(", ")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => setReopening(b)}
                    >
                      ↻ Reopen
                    </button>
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => void exportBin(b.id)}
                    >
                      ↓ Export bin
                    </button>
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => void exportSlice(b.id)}
                    >
                      ↓ Export slice
                    </button>
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => {
                        if (window.confirm(`Delete "${b.label || "this bin"}"? This can't be undone.`)) {
                          void remove(b.id);
                        }
                      }}
                    >
                      × Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reopening && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setReopening(null)}
        >
          <div className="w-full max-w-[1180px]" onClick={(e) => e.stopPropagation()}>
            <CombineEditor
              ids={reopening.tool_ids}
              overallHeight={reopening.overall_height}
              lip={reopening.lip}
              initial={reopenInitial(reopening)}
              onClose={() => setReopening(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
