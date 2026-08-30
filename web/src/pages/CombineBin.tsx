import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { listBins, type SavedBin } from "../api";
import { CombineEditor, type CombineEditorInitial } from "../components/CombineEditor";
import { decodeUrlState, pathForBinReopen, pathForView } from "../urlState";

function reopenInitial(b: SavedBin): CombineEditorInitial {
  return {
    id: b.id,
    label: b.label,
    appliedProfileId: b.applied_profile_id,
    placements: b.placements,
    overrides: b.overrides,
    fillHeightPct: b.fill_height_pct,
    liveGrid: b.live_grid,
    lip: b.lip,
    magnetHoles: b.magnet_holes,
    magnetHoleDiameterMm: b.magnet_hole_diameter_mm,
    magnetHoleDepthMm: b.magnet_hole_depth_mm,
    magnetCornersOnly: b.magnet_corners_only,
    bevelPockets: b.bevel_pockets,
    forceGx: b.force_gx,
    forceGy: b.force_gy,
    removedCells: b.removed_cells,
    lipHeightMm: b.lip_height_mm,
    lipChamferTopMm: b.lip_chamfer_top_mm,
    lipStraightMm: b.lip_straight_mm,
    lipChamferBottomMm: b.lip_chamfer_bottom_mm,
    minWallMm: b.min_wall_mm,
    minFloorMm: b.min_floor_mm,
    floorThicknessMm: b.floor_thickness_mm,
    toolWallMm: b.tool_wall_mm,
    toolWallFlareMm: b.tool_wall_flare_mm,
    toolWallReinforcementHMm: b.tool_wall_reinforcement_h_mm,
    edgeMarginMm: b.edge_margin_mm,
    magnetHoleInsetFromEdgeMm: b.magnet_hole_inset_from_edge_mm,
  };
}

/** The multi-tool combine editor's own page — reached either from the Tool
 *  Library (a fresh selection, `/combine/:ids`) or from the Bin Library
 *  (reopening a saved arrangement, `/combine/reopen/:binId`). A real page
 *  rather than a modal over whichever page sent you here, so it gets its own
 *  URL, survives a reload, and Back leaves it the normal way. */
export function CombineBin() {
  const [path, navigate] = useLocation();
  const decoded = decodeUrlState(path);
  const [reopenBin, setReopenBin] = useState<SavedBin | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);

  // Fetches the saved bin for a `/combine/reopen/:id` link. Skipped once
  // `reopenBin` already matches — onSaved (below) sets it optimistically so
  // a fresh session's first Save As doesn't flash back to a loading state
  // while its own just-persisted bin round-trips through a refetch.
  useEffect(() => {
    if (!decoded.reopenBinId) {
      setReopenBin(null);
      setReopenError(null);
      return;
    }
    if (reopenBin?.id === decoded.reopenBinId) return;
    let cancelled = false;
    listBins()
      .then((bins) => {
        if (cancelled) return;
        const found = bins.find((b) => b.id === decoded.reopenBinId) ?? null;
        setReopenBin(found);
        setReopenError(found ? null : "That saved bin couldn't be found.");
      })
      .catch(() => {
        if (!cancelled) setReopenError("Failed to load the saved bin.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded.reopenBinId]);

  function close() {
    navigate(pathForView(decoded.reopenBinId ? "bins" : "library"));
  }

  const ids = decoded.reopenBinId ? reopenBin?.tool_ids ?? null : decoded.combineIds;

  if (decoded.reopenBinId && !reopenBin) {
    return (
      <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
        <div className="panel">
          <p className="font-body">{reopenError ?? "Loading…"}</p>
        </div>
      </div>
    );
  }

  // `ids` is `[]`, not `null`, for a valid zero-tool session (a brand-new
  // blank bin from /combine/new, or a reopened bin every tool has since
  // been removed from) — only `null` means no combine route matched at all.
  if (ids !== null) {
    return (
      <CombineEditor
        ids={ids}
        overallHeight={reopenBin?.overall_height ?? null}
        initial={reopenBin ? reopenInitial(reopenBin) : undefined}
        defaultForceSize={!reopenBin && ids.length === 0 ? [1, 5] : undefined}
        onClose={close}
        onSaved={(saved) => {
          setReopenBin(saved);
          navigate(pathForBinReopen(saved.id));
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-12">
      <div className="panel">
        <p className="font-body">
          No tools selected. Pick some from the <strong>Tool Library</strong> and use{" "}
          <strong>Combine into ONE bin</strong>, or start a{" "}
          <strong>+ New bin</strong> from the <strong>Bin Library</strong>.
        </p>
      </div>
    </div>
  );
}
