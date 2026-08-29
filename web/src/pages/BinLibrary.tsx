import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  deleteBin,
  exportSavedBin,
  exportSavedBinSlice,
  listBins,
  renameBin,
  type SavedBin,
} from "../api";
import { clearBinPreviewCache } from "../binPreviewCache";
import { BinThumbnail } from "../components/BinThumbnail";
import { binExportName } from "../exportNaming";
import { pathForBinReopen } from "../urlState";

/** Saved multi-tool combine-editor arrangements — a recipe (tools, placements,
 *  overrides, bin-wide settings), not a frozen geometry snapshot. Export and
 *  "Reopen" both regenerate from the tools' current library state. Reopening
 *  (and the combine editor itself) lives on its own page — see CombineBin. */
export function BinLibrary() {
  const [, navigate] = useLocation();
  const [bins, setBins] = useState<SavedBin[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => listBins().then(setBins).catch(() => setBins([]));
  useEffect(() => { refresh(); }, []);

  function openReopen(b: SavedBin) {
    navigate(pathForBinReopen(b.id));
  }

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
      clearBinPreviewCache(id);
    } finally {
      setBusyId(null);
    }
  }

  async function exportBin(b: SavedBin) {
    setBusyId(b.id);
    setNotice(null);
    try {
      await exportSavedBin(b.id, binExportName(b.label, b.tool_labels.filter((l): l is string => Boolean(l))));
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function exportSlice(b: SavedBin) {
    setBusyId(b.id);
    setNotice(null);
    try {
      await exportSavedBinSlice(
        b.id,
        undefined,
        binExportName(b.label, b.tool_labels.filter((l): l is string => Boolean(l))),
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusyId(null);
    }
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
                <BinThumbnail bin={b} />
                <div className="p-3 space-y-3 text-ink">
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase text-muted">Name</span>
                    <input
                      className="w-full bg-transparent border-b border-line font-mono text-sm text-ink py-1 outline-none placeholder:text-muted"
                      defaultValue={b.label}
                      placeholder="Unnamed bin"
                      key={`${b.id}-${b.label}`}
                      onBlur={(e) => e.target.value !== b.label && rename(b.id, e.target.value)}
                    />
                  </label>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
                    <dt>Saved</dt>
                    <dd className="text-right text-ink">
                      {new Date(b.created_ts * 1000).toLocaleDateString()}
                    </dd>
                    <dt>Fill height</dt>
                    <dd className="text-right text-ink">{b.fill_height_pct}%{b.live_grid ? " + live grid" : ""}</dd>
                  </dl>
                  <div className="font-mono text-[10px] text-muted">
                    <span className="uppercase">Tools</span>
                    <p className="mt-1 text-ink">
                      {b.tool_labels.map((label) => label ?? "(deleted tool)").join(", ")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => openReopen(b)}
                    >
                      ↻ Reopen
                    </button>
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => void exportBin(b)}
                    >
                      ↓ Export bin
                    </button>
                    <button
                      className="btn btn-ghost text-[10px] !px-2 !py-2"
                      disabled={busyId === b.id}
                      onClick={() => void exportSlice(b)}
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
    </div>
  );
}
