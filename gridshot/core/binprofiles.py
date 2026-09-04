"""Bin Profiles — named, reusable presets of bin *style* parameters.

A bin profile bundles the parameters that used to be hardcoded per bin style
(pocket/corral/grid): the stacking lip, magnet-hole defaults, whether custom
bin shape is offered, and — for advanced use — the structural constants that
shape the lip, walls, floor, and corral/grid deck. It does **not** carry
per-combine content (tool selection, placements, overrides, overall height,
forced footprint, or which cells are removed) — that stays exactly where it
already lives, on the combine request / Bin Library entry.

Applying a profile is a one-time copy into the combine editor's own fields,
not a live reference — deleting or editing a profile never touches a bin
that was built from it earlier. This mirrors config/bins/'s SavedBin, which
already inlines its style fields rather than pointing at anything.

Entries live as one JSON file per profile under config/bin-profiles/, plus an
optional `<id>-preview.png` thumbnail, the same layout binlibrary.py uses for
saved bins.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, model_validator

from . import gridfinity as grid_mod
from .models import config_dir

BIN_PROFILE_SCHEMA_VERSION = "binprofiles.v1"

# Fixed ids for the three built-in seeded profiles, so `gridshot bin-profiles
# reseed` can target them predictably even after a rename.
SEED_POCKET_ID = "seed-pocket"
SEED_CORRAL_ID = "seed-corral"
SEED_GRID_ID = "seed-grid"


class BinProfile(BaseModel):
    schema_version: Literal["binprofiles.v1"] = BIN_PROFILE_SCHEMA_VERSION

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_base_style(cls, data):
        """`base_style: pocket|corral|grid` -> `fill_height_pct`/`live_grid` —
        see docs/bin-profiles-v2-proposal.md. Self-heals on next load."""
        if isinstance(data, dict) and "base_style" in data and "fill_height_pct" not in data:
            pct, live = grid_mod.LEGACY_STYLE_TO_FILL.get(data["base_style"], (100.0, False))
            data = {**data, "fill_height_pct": pct, "live_grid": live}
        return data

    id: str
    name: str
    created_ts: int = 0
    fill_height_pct: float = 100.0
    live_grid: bool = False
    lip: bool = True
    # Independent of fill_height_pct/live_grid — see gridfinity.py's
    # bin_solid and CombineRequest's validator, both still keyed to the
    # request's actual fill state for the real geometric constraint. This
    # flag only controls whether the combine editor offers the "Custom bin
    # shape" control.
    allow_custom_shape: bool = True
    magnet_holes_default: bool = False
    magnet_hole_diameter_mm_default: float = 6.5
    magnet_hole_depth_mm_default: float = 2.0
    magnet_corners_only_default: bool = False
    magnet_easy_release_default: str = "off"
    # Structural overrides. None means "inherit gridfinity.py's module
    # constant" — what makes the seeded profiles reproduce today's geometry
    # exactly, byte for byte.
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


def profiles_dir() -> Path:
    d = config_dir() / "bin-profiles"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _seeded_marker() -> Path:
    return profiles_dir() / ".seeded"


def _profile_path(profile_id: str) -> Path:
    if not profile_id or Path(profile_id).name != profile_id:
        raise KeyError(profile_id)
    return profiles_dir() / f"{profile_id}.json"


def _preview_path(profile_id: str) -> Path:
    if not profile_id or Path(profile_id).name != profile_id:
        raise KeyError(profile_id)
    return profiles_dir() / f"{profile_id}-preview.png"


def _atomic_write(path: Path, value: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_bytes(value)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def new_profile_id() -> str:
    """Same convention as library_add/save_bin's ids."""
    return f"{int(time.time())}-{uuid.uuid4().hex[:6]}"


def save_profile(profile: BinProfile) -> BinProfile:
    path = _profile_path(profile.id)
    _atomic_write(path, profile.model_dump_json(indent=2).encode())
    return profile


def load_profile(profile_id: str) -> BinProfile:
    path = _profile_path(profile_id)
    if not path.is_file():
        raise KeyError(profile_id)
    return BinProfile.model_validate(json.loads(path.read_text()))


def delete_profile(profile_id: str) -> bool:
    try:
        path = _profile_path(profile_id)
        preview = _preview_path(profile_id)
    except KeyError:
        return False
    if not path.is_file():
        return False
    path.unlink()
    preview.unlink(missing_ok=True)
    return True


def has_preview(profile_id: str) -> bool:
    try:
        return _preview_path(profile_id).is_file()
    except KeyError:
        return False


def preview_path(profile_id: str) -> Path:
    return _preview_path(profile_id)


def save_preview(profile_id: str, png_bytes: bytes) -> None:
    _atomic_write(_preview_path(profile_id), png_bytes)


def _default_seeds() -> tuple[BinProfile, ...]:
    """The 3 built-in profiles, with every structural field left `None` (so
    they inherit gridfinity.py's module constants) — this is what guarantees
    they reproduce today's exact shipped geometry, unedited."""
    return (
        BinProfile(
            id=SEED_POCKET_ID, name="Pocket", fill_height_pct=100.0, live_grid=False,
            lip=True, allow_custom_shape=True,
        ),
        BinProfile(
            id=SEED_CORRAL_ID, name="Corral", fill_height_pct=0.0, live_grid=False,
            lip=True, allow_custom_shape=False,
        ),
        BinProfile(
            id=SEED_GRID_ID, name="Live Grid", fill_height_pct=0.0, live_grid=True,
            lip=True, allow_custom_shape=False,
        ),
    )


def seed_defaults(*, force: bool = False) -> list[BinProfile]:
    """Create any of the 3 fixed-id seeded profiles that don't already exist
    (or, with `force`, reset all 3 back to factory regardless). Leaves any
    other, user-created profile untouched either way. Returns the seeds that
    were (re)written."""
    written = []
    for seed in _default_seeds():
        if force or not _profile_path(seed.id).is_file():
            written.append(save_profile(seed.model_copy(update={"created_ts": int(time.time())})))
    return written


def list_profiles() -> list[BinProfile]:
    """Every saved profile, newest first. Self-heals a fresh/emptied
    config_dir() by seeding the 3 defaults exactly once — gated on a marker
    file, not on the directory being empty, so deleting all profiles later
    doesn't resurrect them (that's what `gridshot bin-profiles reseed` is
    for)."""
    marker = _seeded_marker()
    if not marker.is_file():
        seed_defaults()
        marker.write_text(str(int(time.time())))
    return sorted(
        (BinProfile.model_validate(json.loads(p.read_text())) for p in profiles_dir().glob("*.json")),
        key=lambda p: p.created_ts,
        reverse=True,
    )
