"""Canonical, deterministic derivation of printable bin geometry.

Capture produces a physical, parallax-corrected tool footprint. Every later
surface -- library cards, drawer composition, previews, and export -- must
derive its printable geometry from that footprint through this module. The
content key makes the dependency on tool geometry, settings, and printer
compensation explicit instead of letting persisted grid dimensions become a
second source of truth.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field

import numpy as np
from shapely.affinity import rotate as shapely_rotate
from shapely.affinity import scale as shapely_scale
from shapely.affinity import translate
from shapely.geometry import Point
from shapely.ops import nearest_points

from . import bench as bench_mod
from . import contour as contour_mod
from . import gridfinity as grid_mod
from .models import Poly, PrinterProfile

DERIVATION_VERSION = "bin-spec-v3"


@dataclass(frozen=True)
class ToolGeometry:
    """Physical footprint plus distinct vertical measurements.

    ``thickness_mm`` remains a compatibility alias for silhouette-driving height.
    Full tool height controls automatic recess depth when it has been measured.
    """

    outline: Poly
    thickness_mm: float | None = None
    silhouette_height_mm: float | None = None
    full_height_mm: float | None = None

    def __post_init__(self) -> None:
        silhouette = self.silhouette_height_mm
        if silhouette is None:
            silhouette = self.thickness_mm
        if silhouette is None:
            raise ValueError("silhouette height is required")
        if self.thickness_mm is not None and not math.isclose(
            self.thickness_mm, silhouette, abs_tol=1e-6
        ):
            raise ValueError("thickness and silhouette height disagree")
        object.__setattr__(self, "thickness_mm", float(silhouette))
        object.__setattr__(self, "silhouette_height_mm", float(silhouette))


@dataclass(frozen=True)
class BinSettings:
    """Source settings that can change derived printable geometry."""

    clearance_mm: float = 1.0
    fill_height_pct: float = 100.0
    live_grid: bool = False
    pocket_depth_mm: float | None = None
    height_u: int | None = None
    overall_height_mm: float | None = None
    lip: bool = True
    finger_hole: bool = False
    # `finger_hole_arc_mm` is the current position model: arc-length in mm
    # along the pocket outline, measured from its first vertex. `None` means
    # "not yet explicitly placed" and falls back to `finger_hole_side_flip`/
    # `finger_hole_offset_mm` — the discrete bbox-edge model this replaced —
    # which is otherwise unused by new saves. Keeping the old fields and the
    # legacy placement code lets an existing saved tool/bin's hole resolve to
    # the exact same point it had before, without persisting raw coordinates
    # anywhere: the first time it's touched (dragged/nudged), the frontend
    # commits an explicit `finger_hole_arc_mm` and the legacy fields stop
    # being consulted for that tool.
    finger_hole_arc_mm: float | None = None
    finger_hole_side_flip: bool = False
    finger_hole_offset_mm: float = 0.0
    round_tool: bool = False
    magnet_holes: bool = False
    magnet_hole_diameter_mm: float = grid_mod.MAGNET_HOLE_DIAMETER_MM
    magnet_hole_depth_mm: float = grid_mod.MAGNET_HOLE_DEPTH_MM


@dataclass
class DerivedBinSpec:
    """All non-mesh geometry needed to preview or manufacture one bin."""

    tool_poly: Poly
    cleared_poly: Poly
    compensated_poly: Poly
    pocket_poly: Poly
    sizing_poly: Poly
    grid: tuple[int, int]
    height_u: int
    fill_height_pct: float
    live_grid: bool
    lip: bool
    pocket_depth_mm: float
    overall_height_mm: float
    silhouette_height_mm: float
    full_height_mm: float | None
    magnet_holes: bool = False
    magnet_hole_diameter_mm: float = grid_mod.MAGNET_HOLE_DIAMETER_MM
    magnet_hole_depth_mm: float = grid_mod.MAGNET_HOLE_DEPTH_MM
    finger_holes: list[tuple[float, float, float]] = field(default_factory=list)
    # The arc-length actually used to place `finger_holes[0]` — concrete even
    # when the request left `BinSettings.finger_hole_arc_mm` unset (the
    # legacy-fallback point's own arc-length), so a caller always has a real
    # position to seed dragging/nudging from.
    finger_hole_arc_mm: float = 0.0
    reserved_cells: list[tuple[float, float]] = field(default_factory=list)
    available_cells: list[tuple[float, float]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    derivation_key: str = ""


def _dominant_edge_angle_deg(shape) -> float:
    """Length-weighted axial mean of boundary edge orientations."""
    coords = np.asarray(shape.simplify(0.5).exterior.coords)
    vec = np.diff(coords, axis=0)
    lengths = np.linalg.norm(vec, axis=1)
    theta2 = 2 * np.arctan2(vec[:, 1], vec[:, 0])
    return math.degrees(
        0.5
        * math.atan2(
            (lengths * np.sin(theta2)).sum(),
            (lengths * np.cos(theta2)).sum(),
        )
    )


def _align_for_bin(shape, wall: float):
    """Choose the smallest useful bin rotation and return it plus a transform."""
    origin = tuple(np.asarray(shape.centroid.coords[0], dtype=np.float64))
    rect = list(shape.minimum_rotated_rectangle.exterior.coords)
    edges = [
        (rect[i + 1][0] - rect[i][0], rect[i + 1][1] - rect[i][1])
        for i in range(2)
    ]
    vx, vy = max(edges, key=lambda edge: edge[0] ** 2 + edge[1] ** 2)
    candidates = [
        _dominant_edge_angle_deg(shape),
        math.degrees(math.atan2(vy, vx)),
    ]
    best = None
    for angle in candidates:
        rotated = shapely_rotate(shape, -angle, origin=origin)
        gx, gy = grid_mod.auto_grid(contour_mod.from_shapely(rotated), wall=wall)
        candidate = (gx * gy, -angle)
        if best is None or candidate[0] < best[0]:
            best = candidate
    base = best[1]

    total = min(
        (base + delta / 4 for delta in range(-8, 9)),
        key=lambda angle: (
            lambda bounds: (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
        )(shapely_rotate(shape, angle, origin=origin).bounds),
    )

    def apply(other):
        return shapely_rotate(other, total, origin=origin)

    return apply(shape), apply


_MIRROR_SIDE = {"bottom": "top", "top": "bottom", "left": "right", "right": "left"}


def _ring_points(shape) -> list[tuple[float, float]]:
    """A shapely polygon's exterior ring as a plain point list, without the
    closing duplicate — the form every arc-length helper below walks."""
    coords = [(float(x), float(y)) for x, y in shape.exterior.coords]
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return coords


def _ring_length(ring: list[tuple[float, float]]) -> float:
    if len(ring) < 2:
        return 0.0
    total = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        total += math.hypot(x1 - x0, y1 - y0)
    return total


def _point_at_arc_length(ring: list[tuple[float, float]], arc_mm: float) -> tuple[float, float]:
    """Walk `ring` from its first vertex for `arc_mm` and interpolate. Callers
    wrap `arc_mm` into `[0, _ring_length(ring))` first; a value outside that
    range (or a degenerate ring) resolves to the first vertex."""
    if not ring:
        return (0.0, 0.0)
    if len(ring) < 2 or arc_mm <= 0:
        return ring[0]
    remaining = arc_mm
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        seg_len = math.hypot(x1 - x0, y1 - y0)
        if seg_len <= 1e-12:
            continue
        if remaining <= seg_len:
            t = remaining / seg_len
            return (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        remaining -= seg_len
    return ring[0]


def _arc_length_at_point(ring: list[tuple[float, float]], target: tuple[float, float]) -> float:
    """Inverse of `_point_at_arc_length`: the arc-length of whichever point on
    `ring` is nearest `target` (its projection onto the nearest edge)."""
    if len(ring) < 2:
        return 0.0
    tx, ty = target
    best_dist: float | None = None
    best_arc = 0.0
    traveled = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        dx, dy = x1 - x0, y1 - y0
        seg_len2 = dx * dx + dy * dy
        if seg_len2 <= 1e-24:
            continue
        seg_len = math.sqrt(seg_len2)
        t = max(0.0, min(1.0, ((tx - x0) * dx + (ty - y0) * dy) / seg_len2))
        px, py = x0 + dx * t, y0 + dy * t
        dist = math.hypot(tx - px, ty - py)
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_arc = traveled + t * seg_len
        traveled += seg_len
    return best_arc


def _side_anchor(bounds: tuple[float, float, float, float], side: str) -> Point:
    """The bbox edge-midpoint for one of the four named finger-hole sides."""
    minx, miny, maxx, maxy = bounds
    if side == "bottom":
        return Point((minx + maxx) / 2, miny)
    if side == "top":
        return Point((minx + maxx) / 2, maxy)
    if side == "left":
        return Point(minx, (miny + maxy) / 2)
    return Point(maxx, (miny + maxy) / 2)  # "right"


def _legacy_finger_hole_point(pocket_shape, wall: float, settings: "BinSettings") -> Point:
    """Deprecated bbox-edge-snap placement, kept only so an existing saved
    tool/bin whose finger hole was never explicitly repositioned (no
    `finger_hole_arc_mm`) resolves to the exact point it always has —
    `derive_bin_spec` converts this point to its equivalent arc-length so new
    saves go through `finger_hole_arc_mm` from then on. See `BinSettings`."""
    base_grid = grid_mod.auto_grid(contour_mod.from_shapely(pocket_shape), wall=wall)
    minx, miny, maxx, maxy = pocket_shape.bounds
    anchors = [
        pocket_shape.representative_point(),
        Point((minx + maxx) / 2, miny),
        Point((minx + maxx) / 2, maxy),
        Point(minx, (miny + maxy) / 2),
        Point(maxx, (miny + maxy) / 2),
    ]
    point = None
    for anchor in anchors:
        candidate = nearest_points(pocket_shape.exterior, anchor)[0]
        candidate_shape = pocket_shape.union(candidate.buffer(10.0))
        candidate_grid = grid_mod.auto_grid(
            contour_mod.from_shapely(candidate_shape), wall=wall
        )
        if point is None:
            point = candidate
        if candidate_grid == base_grid:
            point = candidate
            break

    bbox_w, bbox_h = maxx - minx, maxy - miny
    edge_gaps = {
        "bottom": point.y - miny,
        "top": maxy - point.y,
        "left": point.x - minx,
        "right": maxx - point.x,
    }
    nearest_side = min(edge_gaps, key=edge_gaps.get)
    near_threshold = max(
        1.0,
        0.25 * (bbox_w if nearest_side in ("bottom", "top") else bbox_h),
    )
    chosen_side = nearest_side if edge_gaps[nearest_side] <= near_threshold else "center"

    if (
        settings.finger_hole_side_flip or settings.finger_hole_offset_mm
    ) and chosen_side != "center":
        side = (
            _MIRROR_SIDE[chosen_side]
            if settings.finger_hole_side_flip
            else chosen_side
        )
        offset_anchor = _side_anchor(pocket_shape.bounds, side)
        if side in ("bottom", "top"):
            offset_anchor = Point(
                offset_anchor.x + settings.finger_hole_offset_mm, offset_anchor.y
            )
        else:
            offset_anchor = Point(
                offset_anchor.x, offset_anchor.y + settings.finger_hole_offset_mm
            )
        point = nearest_points(pocket_shape.exterior, offset_anchor)[0]

    return point


def _derivation_key(
    tool: ToolGeometry, settings: BinSettings, printer: PrinterProfile
) -> str:
    payload = {
        "version": DERIVATION_VERSION,
        "tool": tool.outline.model_dump(mode="json"),
        "silhouette_height_mm": tool.silhouette_height_mm,
        "full_height_mm": tool.full_height_mm,
        "settings": asdict(settings),
        "printer_profile": printer.model_dump(mode="json"),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def derive_bin_spec(
    tool: ToolGeometry,
    settings: BinSettings,
    printer_profile: PrinterProfile,
) -> DerivedBinSpec:
    """Derive one complete bin specification from authoritative source values.

    Tool is the physical, parallax-corrected footprint in the mat frame.
    No stored grid size, effective pocket depth, or previous generated file is
    consulted. The same inputs therefore produce the same geometry and key.
    """
    outline = tool.outline
    silhouette_height_mm = float(tool.silhouette_height_mm)
    full_height_mm = tool.full_height_mm
    tool_shape = contour_mod.to_shapely(outline)
    if tool_shape.is_empty or not tool_shape.is_valid or tool_shape.area <= 0:
        raise ValueError("tool outline must be a valid polygon with positive area")
    if not math.isfinite(silhouette_height_mm) or silhouette_height_mm <= 0:
        raise ValueError("silhouette height must be > 0")
    if full_height_mm is not None and (
        not math.isfinite(full_height_mm) or full_height_mm <= 0
    ):
        raise ValueError("full tool height must be > 0")
    if not math.isfinite(settings.clearance_mm) or settings.clearance_mm < 0:
        raise ValueError("clearance must be >= 0")
    if not math.isfinite(settings.finger_hole_offset_mm):
        raise ValueError("finger hole offset must be finite")
    if settings.finger_hole_arc_mm is not None and not math.isfinite(settings.finger_hole_arc_mm):
        raise ValueError("finger hole arc length must be finite")
    if not (0.0 <= settings.fill_height_pct <= 100.0):
        raise ValueError(
            f"fill_height_pct must be between 0 and 100, got {settings.fill_height_pct}"
        )
    if settings.pocket_depth_mm is not None and (
        not math.isfinite(settings.pocket_depth_mm)
        or settings.pocket_depth_mm <= 0
    ):
        raise ValueError("pocket depth must be > 0")
    if settings.height_u is not None and settings.height_u < 1:
        raise ValueError("height must be at least 1u")
    if settings.overall_height_mm is not None and settings.overall_height_mm <= 0:
        raise ValueError("overall height must be > 0")

    warnings: list[str] = []
    effective_lip = settings.lip
    if printer_profile.created_at == "default":
        warnings.append(
            f"using assumed printer shrink {100 * bench_mod.DEFAULT_SHRINK:.1f}% — "
            "run gridshot bench coupon to measure it for high-shrink materials "
            "or near-maximal parts"
        )

    cleared = contour_mod.offset(outline, settings.clearance_mm)
    compensated_shape = bench_mod.compensate(
        contour_mod.to_shapely(cleared), printer_profile
    )
    compensated = contour_mod.from_shapely(compensated_shape)

    # Mat/image coordinates use y down; CAD and print coordinates use y up.
    flip_pocket = shapely_scale(compensated_shape, yfact=-1.0, origin=(0, 0))
    flip_tool = shapely_scale(tool_shape, yfact=-1.0, origin=(0, 0))
    fast_path = settings.fill_height_pct == 100.0 and not settings.live_grid
    wall = grid_mod.MIN_WALL_LIP if effective_lip else grid_mod.MIN_WALL
    if not fast_path:
        wall = max(
            wall,
            grid_mod.TOOL_WALL
            + grid_mod.TOOL_WALL_FLARE
            + grid_mod.EDGE_MARGIN,
        )
    aligned, apply_rotation = _align_for_bin(flip_pocket, wall)
    aligned_tool = apply_rotation(flip_tool)
    minx, miny, maxx, maxy = aligned.bounds
    tx, ty = -(minx + maxx) / 2, -(miny + maxy) / 2
    pocket_shape = translate(aligned, tx, ty)
    tool_bin_shape = translate(aligned_tool, tx, ty)

    if settings.pocket_depth_mm is None:
        if full_height_mm is not None:
            depth = grid_mod.auto_recess_depth(full_height_mm)
            height_basis = (
                f"measured full tool height {full_height_mm:.1f}mm + "
                f"{grid_mod.FULL_DEPTH_MARGIN:.1f}mm margin"
            )
        else:
            depth = grid_mod.auto_pocket_depth(
                silhouette_height_mm, settings.round_tool
            )
            height_basis = (
                f"legacy conservative estimate from silhouette height "
                f"{silhouette_height_mm:.1f}mm; record full tool height to replace it"
            )
        if fast_path:
            warnings.append(
                f"pocket depth defaulted to {depth:.1f}mm from {height_basis}; "
                "the tool remains below the stacking plane"
            )
        elif not settings.live_grid:
            warnings.append(
                f"recess defaulted to {depth:.1f}mm from {height_basis}; "
                "the thin tool shelf and full-height wall retain the tool well"
            )
        else:
            warnings.append(
                f"live-grid recess defaulted to {depth:.1f}mm from {height_basis}; "
                "complete sockets are added only where they fit"
            )
    else:
        depth = settings.pocket_depth_mm

    fingers: list[tuple[float, float, float]] = []
    sizing = pocket_shape
    finger_hole_arc_mm = 0.0
    if settings.finger_hole:
        ring = _ring_points(pocket_shape)
        total_len = _ring_length(ring)
        if settings.finger_hole_arc_mm is not None:
            arc = settings.finger_hole_arc_mm % total_len if total_len > 1e-9 else 0.0
            point = Point(_point_at_arc_length(ring, arc))
        else:
            point = _legacy_finger_hole_point(pocket_shape, wall, settings)
            arc = _arc_length_at_point(ring, (point.x, point.y)) if total_len > 1e-9 else 0.0

        sizing = pocket_shape.union(point.buffer(10.0))
        finger_hole_arc_mm = arc
        fingers.append((float(point.x), float(point.y), 20.0))

    # Centre the complete cut envelope, including the optional scallop.
    sminx, sminy, smaxx, smaxy = sizing.bounds
    dx, dy = -(sminx + smaxx) / 2, -(sminy + smaxy) / 2
    pocket_shape = translate(pocket_shape, dx, dy)
    tool_bin_shape = translate(tool_bin_shape, dx, dy)
    sizing = translate(sizing, dx, dy)
    fingers = [(x + dx, y + dy, diameter) for x, y, diameter in fingers]

    gx, gy = grid_mod.auto_grid(contour_mod.from_shapely(sizing), wall=wall)
    need_u = grid_mod.auto_height_u(depth)
    if settings.height_u is not None:
        height_u = settings.height_u
        if height_u < need_u:
            requirement = f"a {depth:.1f}mm-deep recess"
            raise ValueError(
                f"height {height_u}u is too short for {requirement}; "
                f"use at least {need_u}u"
            )
    elif settings.overall_height_mm is not None:
        height_u = grid_mod.height_u_for_overall(
            settings.overall_height_mm, effective_lip
        )
        if height_u < need_u:
            minimum = grid_mod.finished_height_mm(need_u, effective_lip)
            requirement = f"a {depth:.1f}mm-deep recess"
            achieved = grid_mod.finished_height_mm(height_u, effective_lip)
            raise ValueError(
                f"overall height {settings.overall_height_mm:.1f}mm rounds to {height_u}u "
                f"= {achieved:.1f}mm, too short for {requirement} — set it to "
                f"at least {minimum:.1f}mm"
            )
        achieved = grid_mod.finished_height_mm(height_u, effective_lip)
        if abs(achieved - settings.overall_height_mm) > 0.1:
            warnings.append(
                f"overall height snapped to {achieved:.1f}mm "
                f"({height_u}u{' + lip' if effective_lip else ''}) — gridfinity heights "
                "come in 7mm steps"
            )
    else:
        height_u = need_u

    reserved_cells: list[tuple[float, float]] = []
    available_cells: list[tuple[float, float]] = []
    if settings.live_grid:
        cuts = [(contour_mod.from_shapely(pocket_shape), depth, fingers)]
        reserved_cells = grid_mod.grid_reserved_cells(
            gx, gy, cuts, lip=effective_lip
        )
        available_cells = grid_mod.grid_available_cells(
            gx, gy, cuts, lip=effective_lip
        )

    return DerivedBinSpec(
        tool_poly=contour_mod.from_shapely(tool_bin_shape),
        cleared_poly=cleared,
        compensated_poly=compensated,
        pocket_poly=contour_mod.from_shapely(pocket_shape),
        sizing_poly=contour_mod.from_shapely(sizing),
        grid=(gx, gy),
        height_u=height_u,
        fill_height_pct=settings.fill_height_pct,
        live_grid=settings.live_grid,
        lip=effective_lip,
        pocket_depth_mm=depth,
        overall_height_mm=grid_mod.finished_height_mm(height_u, effective_lip),
        silhouette_height_mm=silhouette_height_mm,
        full_height_mm=full_height_mm,
        magnet_holes=settings.magnet_holes,
        magnet_hole_diameter_mm=settings.magnet_hole_diameter_mm,
        magnet_hole_depth_mm=settings.magnet_hole_depth_mm,
        finger_holes=fingers,
        finger_hole_arc_mm=finger_hole_arc_mm,
        reserved_cells=reserved_cells,
        available_cells=available_cells,
        warnings=warnings,
        derivation_key=_derivation_key(
            tool, settings, printer_profile
        ),
    )
