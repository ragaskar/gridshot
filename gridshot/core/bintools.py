"""Bin tools — private, per-bin copies of tool geometry, forked out of the
Tool Library so a saved Bin Library entry stops referencing a library tool at
all.

Reuses `LibraryTool` wholesale (same Pydantic model, no new schema) rather
than a trimmed parallel type: `derive_tool_spec`, `_tool_readiness`, and the
combine response builder all consume a `LibraryTool`-shaped object, so a bin
tool is structurally identical to a library tool — it just lives under
config/bin-tools/ instead of config/library/, and `library.list_tools()`
never sees it, so it never appears in the Tool Library UI or any picker.

`duplicate()` deliberately drops the source's photo/calibration/provenance —
unlike `library.clone()`, no photo assets are copied, and there is (for now)
no way to reopen a bin tool for photo-based re-editing.

Bin-tool ids are `bintool-`-prefixed, structurally disjoint from library/bin/
profile ids (which always start with a digit — `int(time.time())`). Those
ids are generated as `f"{int(time.time())}-{uuid.uuid4().hex[:6]}"`, only 6
hex chars, so a same-second collision between two of them is unlikely but not
impossible; the prefix means `resolve_tool` never has to guess which store an
id belongs to.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

from . import gridfinity as grid_mod
from . import library as library_mod
from .library import LibraryTool
from .models import config_dir

BIN_TOOL_ID_PREFIX = "bintool-"

# Default height for a freshly-placed toolshape — there's no photo to derive
# one from, so this seeds a generic, plausible tool height; the user edits it
# via the same "height" field as any other tool once it's placed.
TOOLSHAPE_DEFAULT_HEIGHT_MM = 20.0

TOOLSHAPE_LABELS: dict[str, str] = {"rounded_rect": "Rounded Rectangle"}


def is_bin_tool_id(tool_id: str) -> bool:
    return tool_id.startswith(BIN_TOOL_ID_PREFIX)


def new_bin_tool_id() -> str:
    return f"{BIN_TOOL_ID_PREFIX}{int(time.time())}-{uuid.uuid4().hex[:6]}"


def bin_tools_dir() -> Path:
    d = config_dir() / "bin-tools"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _tool_path(tool_id: str) -> Path:
    if not tool_id or Path(tool_id).name != tool_id:
        raise KeyError(tool_id)
    return bin_tools_dir() / f"{tool_id}.json"


def _atomic_text(path: Path, value: str) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(value)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def save(tool: LibraryTool) -> LibraryTool:
    tool = library_mod.refresh_derived(tool)
    _atomic_text(_tool_path(tool.id), tool.model_dump_json(indent=2))
    return tool


def load(tool_id: str) -> LibraryTool:
    path = _tool_path(tool_id)
    if not path.is_file():
        raise KeyError(tool_id)
    return LibraryTool.model_validate(json.loads(path.read_text()))


def list_ids() -> list[str]:
    """Every bin-tool id currently on disk — for `gridshot bin-tools gc`,
    which deletes whichever of these no saved bin references any more."""
    return [p.stem for p in bin_tools_dir().glob("*.json")]


def delete(tool_id: str) -> bool:
    try:
        path = _tool_path(tool_id)
    except KeyError:
        return False
    if not path.is_file():
        return False
    path.unlink()
    return True


def _fork(source: LibraryTool, new_id: str, *, label: str) -> LibraryTool:
    """Shared by `duplicate()` and `freeze()` — geometry and settings only.
    No photo, calibration, provenance, or outline history: those describe
    how the *source* was captured/edited, not anything a combined bin needs
    downstream."""
    forked = LibraryTool(
        id=new_id,
        label=label,
        thickness_mm=source.thickness_mm,
        silhouette_height_mm=source.silhouette_height_mm,
        full_height_mm=source.full_height_mm,
        raw_outline=source.raw_outline,
        outline=source.outline,
        clearance_mm=source.clearance_mm,
        fill_height_pct=source.fill_height_pct,
        live_grid=source.live_grid,
        pocket_depth_mm=source.pocket_depth_mm,
        round_tool=source.round_tool,
        finger_hole=source.finger_hole,
        finger_hole_arc_mm=source.finger_hole_arc_mm,
        finger_hole_side_flip=source.finger_hole_side_flip,
        finger_hole_offset_mm=source.finger_hole_offset_mm,
        finger_hole_diameter_mm=source.finger_hole_diameter_mm,
        finger_hole_span=source.finger_hole_span,
        finger_hole_arc2_mm=source.finger_hole_arc2_mm,
        lip=source.lip,
        magnet_holes=source.magnet_holes,
        magnet_hole_diameter_mm=source.magnet_hole_diameter_mm,
        magnet_hole_depth_mm=source.magnet_hole_depth_mm,
        toolshape_type=source.toolshape_type,
        toolshape_width_mm=source.toolshape_width_mm,
        toolshape_length_mm=source.toolshape_length_mm,
        toolshape_radius_mm=source.toolshape_radius_mm,
        toolshape_fillet_bottom=source.toolshape_fillet_bottom,
        created_ts=int(time.time()),
    )
    return save(forked)


def duplicate(source: LibraryTool, new_id: str) -> LibraryTool:
    """Fork a tool into a second, independent bin tool the user explicitly
    asked for (the Combine editor's "⧉ Duplicate") — labeled "{label}
    (copy)", same convention as `library.clone()`."""
    label = f"{source.label} (copy)" if source.label else source.label
    return _fork(source, new_id, label=label)


def freeze(source: LibraryTool, new_id: str) -> LibraryTool:
    """Fork a tool into a private bin-tool copy that *represents the same
    tool*, not a duplicate of it — used when saving a bin freezes every one
    of its tools (see `_fork_new_tools` in app.py). Keeps the original
    label unchanged; unlike `duplicate()`, this isn't a second instance the
    user asked for."""
    return _fork(source, new_id, label=source.label)


def _toolshape_outline(kind: str, *, width_mm: float, length_mm: float, radius_mm: float):
    if kind == "rounded_rect":
        return grid_mod.toolshape_rounded_rect_outline(width_mm, length_mm, radius_mm)
    raise ValueError(f"unknown toolshape type {kind!r}")


def create_toolshape(
    kind: str, *, width_mm: float, length_mm: float, radius_mm: float, fillet_bottom: bool,
) -> LibraryTool:
    """A brand-new bin-tool with no source tool at all — its outline is
    generated in code from these parameters rather than traced from a photo.
    Never appears in the Tool Library (see module docstring)."""
    outline = _toolshape_outline(kind, width_mm=width_mm, length_mm=length_mm, radius_mm=radius_mm)
    tool = LibraryTool(
        id=new_bin_tool_id(),
        label=TOOLSHAPE_LABELS.get(kind, kind),
        thickness_mm=TOOLSHAPE_DEFAULT_HEIGHT_MM,
        raw_outline=outline,
        outline=outline,
        toolshape_type=kind,
        toolshape_width_mm=width_mm,
        toolshape_length_mm=length_mm,
        toolshape_radius_mm=radius_mm,
        toolshape_fillet_bottom=fillet_bottom,
        created_ts=int(time.time()),
    )
    return save(tool)


def update_toolshape(
    tool: LibraryTool, *,
    width_mm: float | None = None,
    length_mm: float | None = None,
    radius_mm: float | None = None,
    fillet_bottom: bool | None = None,
) -> LibraryTool:
    """Re-derive a toolshape's outline after a parameter edit. `tool` must
    already be a toolshape (checked by the caller via `toolshape_type`)."""
    w = tool.toolshape_width_mm if width_mm is None else width_mm
    l = tool.toolshape_length_mm if length_mm is None else length_mm
    r = tool.toolshape_radius_mm if radius_mm is None else radius_mm
    fb = tool.toolshape_fillet_bottom if fillet_bottom is None else fillet_bottom
    outline = _toolshape_outline(tool.toolshape_type, width_mm=w, length_mm=l, radius_mm=r)
    updated = tool.model_copy(update={
        "outline": outline,
        "raw_outline": outline,
        "toolshape_width_mm": w,
        "toolshape_length_mm": l,
        "toolshape_radius_mm": r,
        "toolshape_fillet_bottom": fb,
    })
    return save(updated)


def resolve_tool(tool_id: str) -> LibraryTool:
    """Load a tool id that may belong to either store — the Tool Library or
    bin-tools — dispatching deterministically on the `bintool-` prefix rather
    than a try/fallback, so a same-second id collision between the two can
    never silently resolve to the wrong record."""
    if is_bin_tool_id(tool_id):
        return load(tool_id)
    return library_mod.load(tool_id)
