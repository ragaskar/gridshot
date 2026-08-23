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

from . import library as library_mod
from .library import LibraryTool
from .models import config_dir

BIN_TOOL_ID_PREFIX = "bintool-"


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
        lip=source.lip,
        magnet_holes=source.magnet_holes,
        magnet_hole_diameter_mm=source.magnet_hole_diameter_mm,
        magnet_hole_depth_mm=source.magnet_hole_depth_mm,
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


def resolve_tool(tool_id: str) -> LibraryTool:
    """Load a tool id that may belong to either store — the Tool Library or
    bin-tools — dispatching deterministically on the `bintool-` prefix rather
    than a try/fallback, so a same-second id collision between the two can
    never silently resolve to the wrong record."""
    if is_bin_tool_id(tool_id):
        return load(tool_id)
    return library_mod.load(tool_id)
