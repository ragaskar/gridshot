"""Bin Library — saved multi-tool combine-editor arrangements.

A saved bin stores its *recipe* (which tools, how they're placed, every
override, and the bin-wide settings) rather than a frozen geometry snapshot.
Re-exporting or reopening a saved bin always regenerates from the tools'
current library state, exactly like the live combine editor does — so it
degrades the same way if a referenced tool is later edited or deleted.

Entries live as one JSON file per bin under config/bins/, the same
bind-mounted config directory the tool library already uses.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from . import gridfinity as grid_mod
from .models import config_dir

BIN_LIBRARY_SCHEMA_VERSION = "binlibrary.v1"


class SavedBinPlacement(BaseModel):
    id: str
    tx: float
    ty: float
    rot: float = 0.0
    mirror_x: bool = False
    mirror_y: bool = False


class SavedBinOverride(BaseModel):
    id: str
    finger_hole: Optional[bool] = None
    clearance_mm: Optional[float] = None
    finger_hole_arc_mm: Optional[float] = None
    finger_hole_side_flip: Optional[bool] = None
    finger_hole_offset_mm: Optional[float] = None
    finger_hole_diameter_mm: Optional[float] = None
    locked_rotation_deg: Optional[float] = None
    pocket_depth_mm: Optional[float] = None


class SavedBin(BaseModel):
    schema_version: Literal["binlibrary.v1"] = BIN_LIBRARY_SCHEMA_VERSION

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_bin_style(cls, data):
        """`bin_style: pocket|corral|grid` -> `fill_height_pct`/`live_grid` —
        see docs/bin-profiles-v2-proposal.md. Self-heals on next load."""
        if isinstance(data, dict) and "bin_style" in data and "fill_height_pct" not in data:
            pct, live = grid_mod.LEGACY_STYLE_TO_FILL.get(data["bin_style"], (100.0, False))
            data = {**data, "fill_height_pct": pct, "live_grid": live}
        return data

    id: str
    label: str = ""
    created_ts: int = 0
    tool_ids: list[str]
    placements: list[SavedBinPlacement]
    overrides: list[SavedBinOverride] = Field(default_factory=list)
    overall_height: Optional[float] = None
    lip: bool = True
    fill_height_pct: float = 100.0
    live_grid: bool = False
    magnet_holes: bool = False
    magnet_hole_diameter_mm: float = 6.5
    magnet_hole_depth_mm: float = 2.0
    force_gx: Optional[int] = None
    force_gy: Optional[int] = None
    removed_cells: Optional[list[tuple[int, int]]] = None
    # Bin Profile structural overrides — None means "use gridfinity.py's
    # module constant" at export/reopen time. See gridshot/core/binprofiles.py.
    lip_height_mm: Optional[float] = None
    lip_chamfer_top_mm: Optional[float] = None
    lip_straight_mm: Optional[float] = None
    lip_chamfer_bottom_mm: Optional[float] = None
    min_wall_mm: Optional[float] = None
    min_floor_mm: Optional[float] = None
    floor_thickness_mm: Optional[float] = None
    tool_wall_mm: Optional[float] = None
    tool_wall_flare_mm: Optional[float] = None
    tool_wall_reinforcement_h_mm: Optional[float] = None
    edge_margin_mm: Optional[float] = None
    magnet_hole_inset_from_edge_mm: Optional[float] = None
    # Which Bin Profile the editor had applied when this was saved, purely
    # so reopening shows the same picker selection — a one-time copy like
    # every other profile-derived field above, not a live reference; None
    # for bins saved before Bin Profiles existed, or with no profile applied.
    applied_profile_id: Optional[str] = None


def bins_dir() -> Path:
    d = config_dir() / "bins"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _bin_path(bin_id: str) -> Path:
    if not bin_id or Path(bin_id).name != bin_id:
        raise KeyError(bin_id)
    return bins_dir() / f"{bin_id}.json"


def _atomic_text(path: Path, value: str) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(value)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def new_bin_id() -> str:
    """Same convention as library_add/library_clone's tool ids."""
    return f"{int(time.time())}-{uuid.uuid4().hex[:6]}"


def save_bin(bin: SavedBin) -> SavedBin:
    path = _bin_path(bin.id)
    _atomic_text(path, bin.model_dump_json(indent=2))
    return bin


def load_bin(bin_id: str) -> SavedBin:
    path = _bin_path(bin_id)
    if not path.is_file():
        raise KeyError(bin_id)
    return SavedBin.model_validate(json.loads(path.read_text()))


def list_bins() -> list[SavedBin]:
    """Every saved bin, newest first."""
    return sorted(
        (SavedBin.model_validate(json.loads(p.read_text())) for p in bins_dir().glob("*.json")),
        key=lambda b: b.created_ts,
        reverse=True,
    )


def delete_bin(bin_id: str) -> bool:
    try:
        path = _bin_path(bin_id)
    except KeyError:
        return False
    if not path.is_file():
        return False
    path.unlink()
    return True
