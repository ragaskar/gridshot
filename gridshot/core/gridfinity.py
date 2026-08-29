"""Gridfinity bin solids with tool-shaped pockets, built on manifold3d.

Dimensional constants follow gridfinity-rebuilt-openscad's standard.scad
(MIT, Zack Freedman's spec relicense): 42 mm pitch, 7 mm height units,
41.5 mm bin footprint, 3.75 mm corner radius, and the 4.75 mm foot profile
(0.8 chamfer / 1.8 straight / 2.15 chamfer, 45°).  Chamfered transitions are
exact: hulls between rounded-rect plates, where a 45° chamfer is a uniform
offset that grows the corner radius by the same amount.

M1 scope: foot + body + pocket + finger holes.  Stacking lip and magnet
pockets arrive with the full generator in M3.
"""

from __future__ import annotations

import math

import numpy as np
from manifold3d import CrossSection, FillRule, JoinType, Manifold, OpType
from shapely.affinity import translate as shapely_translate
from shapely.geometry import Point, box
from shapely.ops import unary_union

from .contour import from_shapely, to_shapely
from .models import Poly

PITCH = 42.0
UNIT_H = 7.0
BIN_SIZE = 41.5  # per-unit footprint: 0.25mm clearance per side within the pitch
CORNER_R = 3.75
BASE_H = 4.75
FOOT_CHAMFER_BOT = 0.8  # z 0 → 0.8, offset −(2.15+1.8... see profile below
FOOT_STRAIGHT = 1.8  # z 0.8 → 2.6
FOOT_CHAMFER_TOP = 2.15  # z 2.6 → 4.75
MIN_WALL = 2.0  # pocket to outer wall
MIN_FLOOR = 1.2  # under-pocket floor above the base

# Magnet holes: one per corner of every foot, per the gridfinity.xyz spec.
FOOT_BOTTOM_SIZE = BIN_SIZE - 2 * (FOOT_CHAMFER_TOP + FOOT_CHAMFER_BOT)  # 35.6
MAGNET_HOLE_INSET_FROM_EDGE_MM = 4.8  # hole centre inset from the foot's bottom edge
MAGNET_HOLE_OFFSET_MM = FOOT_BOTTOM_SIZE / 2 - MAGNET_HOLE_INSET_FROM_EDGE_MM  # 13.0
MAGNET_HOLE_DIAMETER_MM = 6.5
MAGNET_HOLE_DEPTH_MM = 2.0

# stacking lip, per gridfinity.xyz spec (gridfinity-rebuilt STACKING_LIP_LINE):
# from the opening at the outer wall going down-inward: 1.9mm 45° chamfer,
# 1.8mm vertical, 0.7mm 45° to the inner tip 2.6mm inside the wall face
LIP_H = 4.4
LIP_CH_TOP = 1.9
LIP_STRAIGHT = 1.8
LIP_CH_BOT = 0.7
LIP_INSET = LIP_CH_TOP + LIP_CH_BOT  # 2.6
MIN_WALL_LIP = LIP_INSET + 0.8  # pocket clears the lip's cavity-floor edge; the
# ledge is backed by solid body, so 0.8mm of top-face margin suffices

# A concave (custom bin shape) chamfer transition is built as a stack of
# this many thin steps instead of one hull — see _lip_ring. Each step's
# riser is ~LIP_CH_TOP/this at the print scale involved (well under 0.3mm),
# fine enough to be functionally indistinguishable from the true 45° plane.
LIP_CHAMFER_LOFT_STEPS = 8

EPS = 1e-3

CIRCULAR_SEGMENTS = 64

# Toolshapes (parametric, no-photo tool outlines — see gridshot/core/bintools.py
# `create_toolshape`) round their pocket's bottom interior corner by this
# fixed radius when the shape's "fillet bottom" option is on. Hardcoded
# rather than user-configurable for now: visible without being dramatic.
TOOLSHAPE_FILLET_RADIUS_MM = 1.5

# Facets approximating the fillet's quarter-circle profile — see
# _pocket_bottom_fillet. Purely cosmetic, so far fewer than
# LIP_CHAMFER_LOFT_STEPS's structural chamfer is plenty.
FILLET_LOFT_STEPS = 8

# A pocket's top opening edge (`bevel_pockets`, fast path only — see
# bin_solid) gets a convex round-over (a curved fillet, tangent to both the
# pocket wall and the bin's top face — "rounded off," not "rounded inward")
# of this radius, hardcoded rather than user-configurable for now, same as
# TOOLSHAPE_FILLET_RADIUS_MM above. Clamped per-bin against the tightest
# configured wall margin in play (see _pocket_top_round_radius), so this is
# a ceiling, not a guarantee — it only reaches the full 0.6mm when the
# surrounding walls are comfortably wider than that.
POCKET_ROUND_RADIUS_MM = 0.6

# Legacy (fill_height_pct, live_grid) mapping — exact and lossless. See
# docs/bin-profiles-v2-proposal.md. Used both to translate old `style` values
# at bin_solid() call sites that haven't migrated yet, and by each model's
# backfill validator for on-disk records that predate these fields.
LEGACY_STYLE_TO_FILL: dict[str, tuple[float, bool]] = {
    "pocket": (100.0, False),
    "corral": (0.0, False),
    "grid": (0.0, True),
}


def style_to_fill_params(style: str) -> tuple[float, bool]:
    """`(fill_height_pct, live_grid)` for a legacy `style` string."""
    try:
        return LEGACY_STYLE_TO_FILL[style]
    except KeyError:
        raise ValueError(f"unknown bin style: {style}") from None


# General-fill/shadow-tray geometry. A thin bottom deck supports loose parts.
# Each tool rests on a thin shelf at its requested recess depth, inside a
# full-height wall that keeps loose parts out of the tool well. The general
# floor area (everything outside every tool's own wall footprint) fills
# upward from the deck by fill_height_pct of the remaining height.
FLOOR_THICKNESS = 1.2
TOOL_WALL = 2.0
TOOL_WALL_FLARE = 0.8
TOOL_WALL_REINFORCEMENT_H = 1.0
EDGE_MARGIN = 1.0

# Exact inverse socket profile from gridfinity-rebuilt's baseplate cutter.
BASEPLATE_H = 5.0
BASEPLATE_OUTER_R = 4.0
BASEPLATE_CLEARANCE_H = 0.35
BASEPLATE_CHAMFER_BOT = 0.7
BASEPLATE_STRAIGHT = 1.8
BASEPLATE_CHAMFER_TOP = 2.15
BASEPLATE_INNER_R = 1.15
BASEPLATE_INNER_SIZE = 36.3
GRID_SOCKET_GAP = 0.5
DRAWER_BASE_FLOOR = 1.2


def _rounded_rect(w: float, d: float, r: float) -> CrossSection:
    """Centred rounded rectangle as a CrossSection."""
    r = min(r, w / 2 - EPS, d / 2 - EPS)
    core = CrossSection.square((w - 2 * r, d - 2 * r), center=True)
    return core.offset(r, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS)


def _plate(w: float, d: float, r: float, z: float) -> Manifold:
    return Manifold.extrude(_rounded_rect(w, d, r), EPS).translate((0, 0, z))


def _cell_center(ix: int, iy: int, gx: int, gy: int) -> tuple[float, float]:
    """World XY of grid cell (ix, iy)'s centre, matching the feet/socket loops."""
    return (ix - (gx - 1) / 2) * PITCH, (iy - (gy - 1) / 2) * PITCH


def _rounded_polyomino_outline(
    gx: int, gy: int, included: frozenset[tuple[int, int]] | None
) -> CrossSection:
    """The bin's outer footprint: a plain rounded rect (today's shape) when
    every cell is included, or the rounded outline of just the included
    cells' union otherwise — a "custom bin shape".

    Corners are rounded to CORNER_R at both convex (outer) and concave
    (notch) corners via two morphological passes: an opening
    (erode-then-dilate) rounds convex corners, then a closing
    (dilate-then-erode) rounds concave ones. Cell pitch (42mm) is far larger
    than 2×CORNER_R (7.5mm), so the two passes can't interact.
    """
    outer_w = PITCH * gx - (PITCH - BIN_SIZE)
    outer_d = PITCH * gy - (PITCH - BIN_SIZE)
    if included is None or len(included) == gx * gy:
        return _rounded_rect(outer_w, outer_d, CORNER_R)
    raw = CrossSection()
    for ix, iy in included:
        cx, cy = _cell_center(ix, iy, gx, gy)
        raw = raw + CrossSection.square((BIN_SIZE, BIN_SIZE), center=True).translate((cx, cy))
    opened = raw.offset(-CORNER_R, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS).offset(
        CORNER_R, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS
    )
    return opened.offset(CORNER_R, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS).offset(
        -CORNER_R, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS
    )


class DisconnectedBinShapeError(ValueError):
    pass


def validate_connected_shape(gx: int, gy: int, included: frozenset[tuple[int, int]]) -> None:
    """Every included cell must be within the gx×gy grid and 4-connected to
    every other one — a custom bin shape is one printable piece, not several
    disjoint islands (a hole in the middle, e.g. a ring, is still one piece
    and is allowed)."""
    if not included:
        raise DisconnectedBinShapeError("custom bin shape must include at least one grid cell")
    for ix, iy in included:
        if not (0 <= ix < gx and 0 <= iy < gy):
            raise DisconnectedBinShapeError(
                f"custom bin shape cell ({ix},{iy}) is outside the {gx}x{gy} forced grid"
            )
    start = next(iter(included))
    seen = {start}
    stack = [start]
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) in included and (nx, ny) not in seen:
                seen.add((nx, ny))
                stack.append((nx, ny))
    if seen != included:
        raise DisconnectedBinShapeError(
            "custom bin shape must be a single connected piece — some cells are "
            "cut off from the rest"
        )


def _foot() -> Manifold:
    """One gridfinity foot, centred, sitting on z=0, top at BASE_H.

    Profile (per side, 45° chamfers): bottom face 35.6 mm (r 0.8), out to
    37.2 mm (r 1.6) at z 0.8, straight to z 2.6, out to 41.5 mm (r 3.75)
    at z 4.75.
    """
    top_w = BIN_SIZE
    mid_w = top_w - 2 * FOOT_CHAMFER_TOP  # 37.2
    bot_w = mid_w - 2 * FOOT_CHAMFER_BOT  # 35.6
    r_top = CORNER_R
    r_mid = r_top - FOOT_CHAMFER_TOP  # 1.6
    r_bot = r_mid - FOOT_CHAMFER_BOT  # 0.8

    z_mid0 = FOOT_CHAMFER_BOT
    z_mid1 = FOOT_CHAMFER_BOT + FOOT_STRAIGHT

    chamfer_bot = Manifold.batch_hull(
        [_plate(bot_w, bot_w, r_bot, 0.0), _plate(mid_w, mid_w, r_mid, z_mid0 - EPS)]
    )
    straight = Manifold.extrude(_rounded_rect(mid_w, mid_w, r_mid), FOOT_STRAIGHT).translate(
        (0, 0, z_mid0)
    )
    chamfer_top = Manifold.batch_hull(
        [_plate(mid_w, mid_w, r_mid, z_mid1), _plate(top_w, top_w, r_top, BASE_H - EPS)]
    )
    return chamfer_bot + straight + chamfer_top


def _baseplate_socket_cutter() -> Manifold:
    """Exact negative volume for one upstream-profile baseplate socket."""
    mid_size = BASEPLATE_INNER_SIZE + 2 * BASEPLATE_CHAMFER_BOT
    mid_r = BASEPLATE_INNER_R + BASEPLATE_CHAMFER_BOT
    z0 = BASEPLATE_CLEARANCE_H
    z1 = z0 + BASEPLATE_CHAMFER_BOT
    z2 = z1 + BASEPLATE_STRAIGHT
    bottom = Manifold.extrude(
        _rounded_rect(BASEPLATE_INNER_SIZE, BASEPLATE_INNER_SIZE, BASEPLATE_INNER_R),
        z0 + EPS,
    ).translate((0, 0, -EPS))
    lower = Manifold.batch_hull([
        _plate(BASEPLATE_INNER_SIZE, BASEPLATE_INNER_SIZE, BASEPLATE_INNER_R, z0),
        _plate(mid_size, mid_size, mid_r, z1),
    ])
    straight = Manifold.extrude(
        _rounded_rect(mid_size, mid_size, mid_r), BASEPLATE_STRAIGHT + 2 * EPS
    ).translate((0, 0, z1 - EPS))
    upper = Manifold.batch_hull([
        _plate(mid_size, mid_size, mid_r, z2),
        _plate(PITCH, PITCH, BASEPLATE_OUTER_R, BASEPLATE_H),
    ])
    return bottom + lower + straight + upper


def _baseplate_socket() -> Manifold:
    """One mechanically compatible 42 mm socket ring, z=0 through z=5."""
    outer = Manifold.extrude(
        _rounded_rect(PITCH, PITCH, BASEPLATE_OUTER_R), BASEPLATE_H
    )
    return outer - _baseplate_socket_cutter()


def drawer_baseplate_solid(cols: int, rows: int) -> Manifold:
    """A complete drawer-sized Gridfinity socket grid for 3D composition.

    The preview base is deliberately separate from printable bin export: it
    represents the drawer's existing 42 mm socket grid so composed bins can be
    inspected in context. Its top is z=0 and each standard socket rises from
    there, which lets the exact bin feet seat at the same z used by fit tests.
    """
    if cols < 1 or rows < 1:
        raise ValueError("drawer grid must be at least 1×1")
    width = cols * PITCH
    depth = rows * PITCH
    floor = Manifold.extrude(
        _rounded_rect(width, depth, BASEPLATE_OUTER_R),
        DRAWER_BASE_FLOOR,
    ).translate((0, 0, -DRAWER_BASE_FLOOR))
    socket = _baseplate_socket()
    sockets = [
        socket.translate((
            (col - (cols - 1) / 2) * PITCH,
            (row - (rows - 1) / 2) * PITCH,
            0,
        ))
        for col in range(cols)
        for row in range(rows)
    ]
    return Manifold.batch_boolean([floor, *sockets], OpType.Add)


LIP_RIM_FLAT = 0.4  # top rim flat: the spec draws a knife edge, which is both
# unprintable and degenerate to mesh — a 0.4mm flat keeps 1.5mm of 45° chamfer
# engagement and clean geometry (foot seats 0.4mm shallower, laterally solid)


def _is_convex(cross_section: CrossSection) -> bool:
    """True if `cross_section` has no concave (reflex) region — its own area
    equals its convex hull's. A plain rounded rect (every grid cell
    included) always is; a custom bin shape with cells removed generally
    isn't, whenever the removed cells notch into the outer boundary."""
    area = cross_section.area()
    return abs(area - cross_section.hull().area()) < 1e-6 * max(area, 1.0)


def _chamfer_transition(
    outline: CrossSection, inset_a: float, z_a: float, inset_b: float, z_b: float, ov: float = 0.05,
) -> Manifold:
    """A 45°-style chamfer between two (inset, z) offsets of the same
    `outline` — normally just the convex hull of the two plates, which is
    exact for a plain rounded rect (always convex). But `outline` can be a
    concave custom-bin-shape polyomino, and hull() can't have a concavity:
    given two plates that both carry the same notch, their hull bridges
    straight across it with a flat diagonal face — used as `_lip_ring`'s
    cavity, that carves the lip's socket too aggressively near the notch
    corner and leaves an unsupported overhang there (reported as a Bambu
    Studio "floating cantilever" warning on a real bin — force_gx=6,
    force_gy=5, removed_cells=[(0,2),(0,3),(0,4)], lip=True — that
    print-sliced cleanly with lip=False).

    Falls back to a stack of thin steps for a concave outline instead —
    each step uses the true offset outline at its own inset, so a notch
    stays a notch throughout, at the cost of a very fine
    (sub-0.3mm-riser) stair-step instead of a perfectly smooth plane."""
    def rr(inset: float) -> CrossSection:
        return outline.offset(-inset, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS)

    def plate(inset: float, z: float) -> Manifold:
        return Manifold.extrude(rr(inset), EPS).translate((0, 0, z))

    if _is_convex(outline):
        return Manifold.batch_hull([plate(inset_a, z_a), plate(inset_b, z_b)])
    if z_a > z_b:
        inset_a, z_a, inset_b, z_b = inset_b, z_b, inset_a, z_a
    steps = LIP_CHAMFER_LOFT_STEPS
    slabs = []
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        inset = inset_a + (inset_b - inset_a) * t0
        step_z0 = z_a + (z_b - z_a) * t0
        step_z1 = z_a + (z_b - z_a) * t1
        # Each step overlaps its neighbours by `ov`, the same zero-overlap-
        # seam guard used everywhere else in this file — two independently-
        # extruded slabs meeting at an exact shared Z plane are exactly the
        # "floating artifacts" failure mode this file already works around
        # elsewhere.
        slabs.append(Manifold.extrude(rr(inset), (step_z1 - step_z0) + 2 * ov).translate((0, 0, step_z0 - ov)))
    return Manifold.batch_boolean(slabs, OpType.Add)


def _pocket_bottom_fillet(
    inner: CrossSection, floor_z: float, radius: float, ov: float = 0.05,
) -> Manifold:
    """Extra material to cut at a pocket's bottom interior corner, rounding
    the join between the vertical wall and the horizontal floor instead of
    leaving them meet at a hard right angle.

    `inner` is the pocket's own cross-section (clearance already applied).
    At height `h` above the floor (0 <= h <= radius) the cut's cross-section
    is `inner` outset by `radius - sqrt(radius**2 - (radius - h)**2)` — zero
    at h=radius (seamlessly continuing into the straight-walled cut above,
    which already carves `inner` at every height), growing to a full
    `radius` right at the floor (tangent to it, same as a round-over router
    bit). Built as a stack of hulled plates like `_chamfer_transition`, just
    following this curved offset profile instead of a straight one so the
    facets approximate a real fillet rather than a single flat chamfer —
    except when `inner` is concave, where hulling two different-outset
    plates of the *same* concave shape bridges its own bays with a flat
    phantom face (`_chamfer_transition`'s failure mode, but triggered here
    by one shape's two offsets instead of two shapes) — falls back to a
    stack of thin, non-hulled single-offset slabs in that case, same
    stair-stepped tradeoff `_chamfer_transition` accepts for a concave
    outline."""
    def ring(outset: float) -> CrossSection:
        return (
            inner.offset(outset, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS)
            if outset > EPS else inner
        )

    def plate(outset: float, z: float) -> Manifold:
        return Manifold.extrude(ring(outset), EPS).translate((0, 0, z))

    convex = _is_convex(inner)
    slabs = []
    for i in range(FILLET_LOFT_STEPS):
        h0 = radius * i / FILLET_LOFT_STEPS
        h1 = radius * (i + 1) / FILLET_LOFT_STEPS
        o0 = radius - math.sqrt(max(0.0, radius * radius - (radius - h0) ** 2))
        o1 = radius - math.sqrt(max(0.0, radius * radius - (radius - h1) ** 2))
        if convex:
            slabs.append(Manifold.batch_hull([
                plate(o0, floor_z + h0 - ov),
                plate(o1, floor_z + h1),
            ]))
        else:
            # Widest (o0) offset of the pair, held constant across the whole
            # step rather than hulled down to o1 — over-covers slightly
            # instead of risking a hull bridge across a concavity.
            slabs.append(Manifold.extrude(
                ring(o0), (h1 - h0) + 2 * ov
            ).translate((0, 0, floor_z + h0 - ov)))
    return Manifold.batch_boolean(slabs, OpType.Add)


def _pocket_top_round_radius(
    depth: float, min_wall_mm: float, min_wall_lip_mm: float, tool_wall_mm: float, lip: bool,
) -> float:
    """How large a `POCKET_ROUND_RADIUS_MM` round-over can safely go on one
    pocket's top opening edge without threatening to breach a neighbouring
    wall — the round-over flares the opening outward by its radius on every
    side, so it's clamped against whichever configured wall margin is
    tightest: the outer wall (`min_wall_mm`, tighter still as
    `min_wall_lip_mm` when a lip is present), and half of `tool_wall_mm`
    (halved because two adjacent pockets each flare toward each other across
    that same gap). Also clamped to the pocket's own `depth`, same as
    `_pocket_bottom_fillet`, so a shallow pocket never gets a round-over
    taller than itself. Degrades to 0 (no round-over, not an error) for a
    bin configured with wall margins already thinner than any round-over."""
    wall_margin = min(min_wall_mm, min_wall_lip_mm if lip else min_wall_mm, tool_wall_mm / 2)
    return max(0.0, min(POCKET_ROUND_RADIUS_MM, wall_margin - EPS, depth - EPS))


def _pocket_top_fillet(
    cross_section: CrossSection, top_z: float, radius: float, ov: float = 0.05,
) -> Manifold:
    """Extra material to cut at a pocket opening's top edge, rounding the
    join between the vertical wall and the bin's top face with a convex
    round-over instead of leaving them meet at a hard right angle — the
    mirror of `_pocket_bottom_fillet`, tracing the same quarter-circle
    profile downward from the top face instead of upward from the floor.

    `cross_section` is one opening's own 2D shape (clearance already
    applied) — call this once per opening (the pocket outline, each finger
    hole circle, the finger-hole connector) rather than passing their union:
    `Manifold.batch_hull` on a shared ring would bridge disjoint openings
    with a flat phantom wall between them, same failure mode this file's
    `_chamfer_transition` documents for a concave *outer* outline.

    That same bridging risk applies *within* a single opening too, whenever
    `cross_section` is itself concave (a tool silhouette's waist, a fork's
    tines, ...): hulling that one shape's own two different-outset plates
    can bridge its bays with a flat phantom face, cutting material far
    outside the opening's real footprint. Falls back to a stack of thin,
    non-hulled single-offset slabs in that case, same stair-stepped
    tradeoff `_chamfer_transition` accepts for a concave outline."""
    def ring(outset: float) -> CrossSection:
        return (
            cross_section.offset(outset, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS)
            if outset > EPS else cross_section
        )

    def plate(outset: float, z: float) -> Manifold:
        return Manifold.extrude(ring(outset), EPS).translate((0, 0, z))

    convex = _is_convex(cross_section)
    slabs = []
    for i in range(FILLET_LOFT_STEPS):
        d0 = radius * i / FILLET_LOFT_STEPS
        d1 = radius * (i + 1) / FILLET_LOFT_STEPS
        o0 = radius - math.sqrt(max(0.0, radius * radius - (radius - d0) ** 2))
        o1 = radius - math.sqrt(max(0.0, radius * radius - (radius - d1) ** 2))
        if convex:
            slabs.append(Manifold.batch_hull([
                plate(o0, top_z - d0 + ov),
                plate(o1, top_z - d1),
            ]))
        else:
            # Widest (o0) offset of the pair, held constant across the whole
            # step rather than hulled down to o1 — over-covers slightly
            # instead of risking a hull bridge across a concavity.
            slabs.append(Manifold.extrude(
                ring(o0), (d1 - d0) + 2 * ov
            ).translate((0, 0, top_z - d1 - ov)))
    return Manifold.batch_boolean(slabs, OpType.Add)


def _lip_ring(
    outline: CrossSection,
    z_top: float,
    lip_height_mm: float = LIP_H,
    lip_chamfer_top_mm: float = LIP_CH_TOP,
    lip_straight_mm: float = LIP_STRAIGHT,
    lip_chamfer_bottom_mm: float = LIP_CH_BOT,
) -> Manifold:
    """Spec stacking lip: a rim whose inner cavity accepts the foot of the
    bin above (45° faces mate flush).  Sits on the solid body, so the spec's
    thin-wall support section isn't needed.

    `outline` is the bin's outer footprint — a plain rounded rect, or, for a
    [[custom bin shape]], the rounded polyomino outline from
    `_rounded_polyomino_outline`. Every inset below is a uniform erosion of
    that same outline, so the lip follows whatever shape the body has —
    for a plain rect this reduces to exactly the old dimension math (eroding
    a rounded rect by `t` shrinks each side by `2t` and the corner radius by
    `t`), it's just expressed as a generic offset instead."""
    lip_inset = lip_chamfer_top_mm + lip_chamfer_bottom_mm
    z_hi = z_top + lip_height_mm
    f = LIP_RIM_FLAT
    ov = 0.05  # segments interpenetrate by a real overlap — plate-to-plate
    # seams at EPS thickness tessellate into sub-float32 sliver faces

    # The ring's own bottom face would otherwise sit exactly at z_top,
    # perfectly coincident with the body's top face below it — the same
    # zero-overlap seam this function's `ov` trick already guards against
    # internally, but here between the ring and the body it's unioned onto.
    # manifold3d's boolean kernel doesn't reliably fuse an exactly-coincident
    # plate-to-plate seam between two independently-built solids: it can
    # leave the ring as a genuinely disconnected piece, floating just above
    # the body ("floating artifacts above the lip"). Extending the ring
    # down by `ov` makes it truly penetrate into the body's outer wall
    # (always solid there, in both the fast and general paths) instead of
    # just touching it. The cavity cut below reaches further down still
    # (`lower`, to z_top - 0.2), so this extra sliver is cut away wherever
    # the cavity applies and only remains as overlap in the outer wall.
    ring = Manifold.extrude(outline, lip_height_mm + ov).translate((0, 0, z_top - ov))

    def rr(inset: float) -> CrossSection:
        return outline.offset(-inset, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS)

    # opening band: vertical at the rim-flat inset, over-tall for a clean cut
    opening = Manifold.extrude(rr(f), 1.0 + f + ov).translate((0, 0, z_hi - f - ov))
    # upper 45° chamfer (truncated by the rim flat, same spec plane)
    upper = _chamfer_transition(outline, f, z_hi - f, lip_chamfer_top_mm, z_hi - lip_chamfer_top_mm, ov)
    # straight section, overlapping both chamfers
    straight = Manifold.extrude(
        rr(lip_chamfer_top_mm), lip_straight_mm + 2 * ov
    ).translate((0, 0, z_top + lip_chamfer_bottom_mm - ov))
    # lower 45° chamfer, extended 0.2 below the cavity floor so the boolean
    # never meets the body's top face edge-on (leaves a hidden micro-groove)
    lower = _chamfer_transition(
        outline, lip_chamfer_top_mm, z_top + lip_chamfer_bottom_mm, lip_inset + 0.2, z_top - 0.2, ov,
    )
    cavity = opening + upper + straight + lower
    return ring - cavity


def _cross_section_from_poly(poly: Poly) -> CrossSection:
    shape = to_shapely(poly)
    rings = [np.asarray(shape.exterior.coords[:-1], dtype=np.float64)]
    rings += [np.asarray(r.coords[:-1], dtype=np.float64) for r in shape.interiors]
    # EvenOdd is orientation-independent: interior rings become holes
    return CrossSection(rings, FillRule.EvenOdd)


def auto_grid(pocket: Poly, wall: float = MIN_WALL) -> tuple[int, int]:
    """Smallest full-unit footprint whose usable interior fits the pocket."""
    minx, miny, maxx, maxy = to_shapely(pocket).bounds
    need_w = (maxx - minx) + 2 * wall
    need_d = (maxy - miny) + 2 * wall
    gx = max(1, math.ceil((need_w + (PITCH - BIN_SIZE)) / PITCH))
    gy = max(1, math.ceil((need_d + (PITCH - BIN_SIZE)) / PITCH))
    return gx, gy


FULL_DEPTH_MARGIN = 1.5  # sink the tool just below the rim so bins still stack


def auto_recess_depth(full_tool_height_mm: float) -> float:
    """Recess a measured full tool just below the stacking plane."""
    if not math.isfinite(full_tool_height_mm) or full_tool_height_mm <= 0:
        raise ValueError("full tool height must be > 0")
    return max(2.0, full_tool_height_mm + FULL_DEPTH_MARGIN)


def auto_pocket_depth(thickness_mm: float, round_tool: bool = False) -> float:
    """Default pocket depth = full depth for the whole tool, recessed just below
    the rim so the bin stacks and retrieval is by finger scallop (not by pinching
    a proud tool).

    This is the conservative legacy fallback when only silhouette-driving
    height is known. New callers should pass measured full height through
    :func:`auto_recess_depth`. `round_tool` remains for call-site compatibility.
    """
    return max(2.0, 2.0 * thickness_mm + FULL_DEPTH_MARGIN)


def auto_height_u(pocket_depth: float, min_floor_mm: float = MIN_FLOOR) -> int:
    """Fewest whole gridfinity units that hold base + floor + pocket."""
    return max(1, math.ceil((BASE_H + min_floor_mm + pocket_depth) / UNIT_H))


def finished_height_mm(height_u: int, lip: bool, lip_height_mm: float = LIP_H) -> float:
    """Physical top-of-bin height: the unit stack plus the stacking lip.

    The lip rises lip_height_mm above height_u·UNIT_H, so a lipped bin is
    that much taller than a lipless one of the same unit count. This is the
    height that must match for bins to sit level in a drawer.
    """
    return height_u * UNIT_H + (lip_height_mm if lip else 0.0)


def height_u_for_overall(overall_mm: float, lip: bool, lip_height_mm: float = LIP_H) -> int:
    """Whole unit count whose finished height is closest to overall_mm.

    Inverse of finished_height_mm: subtract the lip (when present) before
    quantising to the 7mm unit, so the *finished* height — not the bare unit
    stack — is what tracks the requested value.
    """
    body = overall_mm - (lip_height_mm if lip else 0.0)
    return max(1, round(body / UNIT_H))


def usable_height_for_overall(
    overall_mm: float, lip: bool, *,
    floor_thickness_mm: float = FLOOR_THICKNESS, lip_height_mm: float = LIP_H,
) -> float:
    """Depth available below `fill_height_pct`'s 100% reference — the
    finished height minus the base, the floor, and (if present) the lip.

    Inverse of the `BASE_H + floor_thickness_mm + usable + (lip_height_mm if
    lip)` split bin_solid's own fill-height math (deck_top, fill_top_z) is
    built from — see the "usable" span there.
    """
    return overall_mm - BASE_H - floor_thickness_mm - (lip_height_mm if lip else 0.0)


class PocketTooDeepError(ValueError):
    pass


def _rounded_rect_polygon(w: float, d: float, r: float):
    """Shapely rounded rectangle matching :func:`_rounded_rect`."""
    r = min(r, w / 2 - EPS, d / 2 - EPS)
    return box(
        -w / 2 + r,
        -d / 2 + r,
        w / 2 - r,
        d / 2 - r,
    ).buffer(r, quad_segs=16)


def toolshape_rounded_rect_outline(width_mm: float, length_mm: float, radius_mm: float) -> Poly:
    """Parametric outline for the "rounded rectangle" toolshape — centred at
    the origin, same convention as every photo-traced tool's stamp, so it
    drops straight into the existing placement/rotation math."""
    if width_mm <= 0 or length_mm <= 0:
        raise ValueError("toolshape width/length must be > 0")
    if radius_mm < 0:
        raise ValueError("toolshape radius must be >= 0")
    return from_shapely(_rounded_rect_polygon(width_mm, length_mm, radius_mm))


def grid_candidate_cells(
    gx: int, gy: int, *, lip: bool = False,
    min_wall_mm: float = MIN_WALL, min_wall_lip_mm: float = MIN_WALL_LIP,
) -> list[tuple[float, float]]:
    """Complete 42 mm sockets that fit inside the corral's outer wall.

    The candidate field is centred and remains on 42 mm pitch. It is never used
    to grow the bin; small or narrow corrals simply return no candidates.
    """
    outer_w = PITCH * gx - (PITCH - BIN_SIZE)
    outer_d = PITCH * gy - (PITCH - BIN_SIZE)
    inset = min_wall_lip_mm if lip else min_wall_mm
    inner_w = outer_w - 2 * inset
    inner_d = outer_d - 2 * inset
    if inner_w <= 0 or inner_d <= 0:
        return []
    inner_r = max(EPS, CORNER_R - inset)
    usable = _rounded_rect_polygon(inner_w, inner_d, inner_r).buffer(
        -GRID_SOCKET_GAP
    )
    if usable.is_empty:
        return []
    minx, miny, maxx, maxy = usable.bounds
    nx = max(0, math.floor((maxx - minx + EPS) / PITCH))
    ny = max(0, math.floor((maxy - miny + EPS) / PITCH))
    socket_shape = _rounded_rect_polygon(PITCH, PITCH, BASEPLATE_OUTER_R)
    candidates = []
    for ix in range(nx):
        for iy in range(ny):
            cx = (ix - (nx - 1) / 2) * PITCH
            cy = (iy - (ny - 1) / 2) * PITCH
            cell = shapely_translate(socket_shape, xoff=cx, yoff=cy)
            if usable.covers(cell):
                candidates.append((float(cx), float(cy)))
    return candidates


def _grid_retention_envelope(
    pockets: list[tuple],
    tool_wall_mm: float = TOOL_WALL,
    tool_wall_flare_mm: float = TOOL_WALL_FLARE,
):
    envelopes = []
    for entry in pockets:
        shape = to_shapely(entry[0])
        fingers = entry[2] if len(entry) > 2 else ()
        connector = entry[3] if len(entry) > 3 else None
        lobes = [
            Point(float(x), float(y)).buffer(float(diameter) / 2)
            for x, y, diameter in fingers
        ]
        if connector is not None:
            lobes.append(to_shapely(connector))
        if lobes:
            shape = unary_union([shape, *lobes])
        envelopes.append(
            shape.buffer(
                tool_wall_mm + tool_wall_flare_mm + GRID_SOCKET_GAP,
                quad_segs=16,
            )
        )
    return unary_union(envelopes)


def grid_reserved_cells(
    gx: int, gy: int, pockets: list[tuple], *, lip: bool = False,
    min_wall_mm: float = MIN_WALL, min_wall_lip_mm: float = MIN_WALL_LIP,
    tool_wall_mm: float = TOOL_WALL, tool_wall_flare_mm: float = TOOL_WALL_FLARE,
) -> list[tuple[float, float]]:
    """Fully fitting socket positions blocked by the complete tool envelope."""
    envelope = _grid_retention_envelope(pockets, tool_wall_mm, tool_wall_flare_mm)
    socket_shape = _rounded_rect_polygon(PITCH, PITCH, BASEPLATE_OUTER_R)
    return [
        (cx, cy)
        for cx, cy in grid_candidate_cells(gx, gy, lip=lip, min_wall_mm=min_wall_mm, min_wall_lip_mm=min_wall_lip_mm)
        if not shapely_translate(socket_shape, xoff=cx, yoff=cy).disjoint(envelope)
    ]


def grid_available_cells(
    gx: int, gy: int, pockets: list[tuple], *, lip: bool = False,
    min_wall_mm: float = MIN_WALL, min_wall_lip_mm: float = MIN_WALL_LIP,
    tool_wall_mm: float = TOOL_WALL, tool_wall_flare_mm: float = TOOL_WALL_FLARE,
) -> list[tuple[float, float]]:
    """Complete, unobstructed socket centres in the general floor area."""
    envelope = _grid_retention_envelope(pockets, tool_wall_mm, tool_wall_flare_mm)
    socket_shape = _rounded_rect_polygon(PITCH, PITCH, BASEPLATE_OUTER_R)
    return [
        (cx, cy)
        for cx, cy in grid_candidate_cells(gx, gy, lip=lip, min_wall_mm=min_wall_mm, min_wall_lip_mm=min_wall_lip_mm)
        if shapely_translate(socket_shape, xoff=cx, yoff=cy).disjoint(envelope)
    ]


def bin_solid(
    gx: int,
    gy: int,
    height_u: int,
    pocket: Poly | None = None,
    pocket_depth: float = 0.0,
    finger_holes: list[tuple[float, float, float]] = (),
    finger_hole_connector: Poly | None = None,
    lip: bool = False,
    pockets: list[tuple[Poly, float]] | None = None,
    fill_height_pct: float = 100.0,
    live_grid: bool = False,
    magnet_holes: bool = False,
    magnet_hole_diameter_mm: float = MAGNET_HOLE_DIAMETER_MM,
    magnet_hole_depth_mm: float = MAGNET_HOLE_DEPTH_MM,
    included_cells: frozenset[tuple[int, int]] | None = None,
    lip_height_mm: float = LIP_H,
    lip_chamfer_top_mm: float = LIP_CH_TOP,
    lip_straight_mm: float = LIP_STRAIGHT,
    lip_chamfer_bottom_mm: float = LIP_CH_BOT,
    min_wall_mm: float = MIN_WALL,
    min_floor_mm: float = MIN_FLOOR,
    floor_thickness_mm: float = FLOOR_THICKNESS,
    tool_wall_mm: float = TOOL_WALL,
    tool_wall_flare_mm: float = TOOL_WALL_FLARE,
    tool_wall_reinforcement_h_mm: float = TOOL_WALL_REINFORCEMENT_H,
    magnet_hole_inset_from_edge_mm: float = MAGNET_HOLE_INSET_FROM_EDGE_MM,
    bevel_pockets: bool = False,
) -> Manifold:
    """A Gridfinity tool holder, parameterized instead of style-branched — see
    docs/bin-profiles-v2-proposal.md.

    `fill_height_pct` (0-100) is how far up the general floor area (outside
    every tool's own wall footprint, inside the outer wall, above the deck)
    solid material rises, sized against the bin's own height. `100` (the
    default — today's "pocket") takes an exact fast path: a single solid
    extrusion with pockets cut directly into it, identical to the pre-
    parameterization code. Anything else routes through the general
    (deck + outer wall + per-tool wall/shelf) construction — `0` reproduces
    today's "corral" exactly. Intermediate values rise from the deck to a
    height scaled by the percentage, filling the general floor area (outside
    every tool's own wall footprint and any live_grid socket cell).

    `live_grid` adds baseplate sockets to floor cells no tool's wall+
    clearance envelope reaches, independent of `fill_height_pct` — today's
    "grid" is `fill_height_pct=0, live_grid=True`.

    `included_cells`, when given, restricts the bin's footprint to a subset
    of the gx×gy grid — a "custom bin shape" (see
    `_rounded_polyomino_outline`/`validate_connected_shape`). Only supported
    on the fast path (`fill_height_pct == 100 and not live_grid`) for now —
    the general construction's deck/perimeter still build from a fixed outer
    rect rather than the polyomino outline.

    `finger_hole_connector` is the exact stadium/capsule polygon connecting a
    two-lobe ("span") finger hole's pair of circles in `finger_holes` — cut
    (or unioned into the tool wall envelope) in addition to those circles, so
    a tool narrower than the hole diameter at that cross-section still gets a
    clean channel between the two lobes instead of two disconnected holes.
    `pockets` entries may carry the same thing as an optional 4th tuple
    element: `(pocket, depth, fingers, connector)`.

    `bevel_pockets` rounds off each pocket's top opening edge with a convex
    fillet — a round-over, tangent to both the pocket wall and the bin's top
    face, not a straight chamfer (see
    POCKET_ROUND_RADIUS_MM/_pocket_top_round_radius) — plus, on the same
    entry, its finger holes and finger-hole connector, so a tool's whole set
    of openings reads as one consistent edge treatment. Fast path only, same
    as the per-entry bottom fillet (`pockets` entries' optional 5th tuple
    element): the general (corral/grid) construction builds each tool as a
    raised wall around an open shelf rather than cutting a cavity into solid
    material, so there's no cut-pocket opening edge to round there.
    """
    if not (0.0 <= fill_height_pct <= 100.0):
        raise ValueError(f"fill_height_pct must be between 0 and 100, got {fill_height_pct}")
    fast_path = fill_height_pct == 100.0 and not live_grid
    if included_cells is not None and len(included_cells) < gx * gy and not fast_path:
        raise ValueError(
            "custom bin shape is only supported at fill_height_pct=100 with live_grid off"
        )
    cuts = list(pockets) if pockets else (
        [(
            pocket, pocket_depth,
            finger_holes if not fast_path else (),
            finger_hole_connector if not fast_path else None,
        )]
        if pocket is not None and pocket_depth > 0 else []
    )
    if not fast_path and not cuts:
        raise ValueError("a non-fast-path bin needs at least one tool footprint")

    min_wall_lip_mm = lip_chamfer_top_mm + lip_chamfer_bottom_mm + 0.8

    total_h = height_u * UNIT_H
    outer_w = PITCH * gx - (PITCH - BIN_SIZE)
    outer_d = PITCH * gy - (PITCH - BIN_SIZE)
    outline = _rounded_polyomino_outline(gx, gy, included_cells)
    if fast_path:
        body = Manifold.extrude(
            outline, total_h - BASE_H
        ).translate((0, 0, BASE_H))
    else:
        deck_top = BASE_H + floor_thickness_mm
        deck = Manifold.extrude(
            _rounded_rect(outer_w, outer_d, CORNER_R), floor_thickness_mm
        ).translate((0, 0, BASE_H))
        outer = _rounded_rect(outer_w, outer_d, CORNER_R)
        inset = min_wall_lip_mm if lip else min_wall_mm
        inner = _rounded_rect(
            outer_w - 2 * inset, outer_d - 2 * inset, CORNER_R - inset
        )
        perimeter = Manifold.extrude(
            outer - inner, total_h - deck_top + EPS
        ).translate((0, 0, deck_top - EPS))
        body = deck + perimeter

        available_cells: list[tuple[float, float]] = []
        if live_grid:
            if total_h < deck_top + BASEPLATE_H - EPS:
                raise ValueError(
                    "live_grid needs at least 2u so socket walls remain below "
                    "the stacking plane"
                )
            available_cells = grid_available_cells(
                gx, gy, cuts, lip=lip, min_wall_mm=min_wall_mm, min_wall_lip_mm=min_wall_lip_mm,
                tool_wall_mm=tool_wall_mm, tool_wall_flare_mm=tool_wall_flare_mm,
            )

        # General floor fill: solid material rises from the deck by
        # fill_height_pct of the remaining height, everywhere outside every
        # tool's own wall footprint and any cell reserved for a live_grid
        # socket (a socket needs a genuinely open cavity above it — filling
        # that cell would seal it, defeating the socket). At 0% this is a
        # no-op (byte-identical to the pre-fill-height corral/grid geometry);
        # at 100% it fills the general area clear to the top, same as the
        # solid-fill fast path does for a tool's own pocket.
        if fill_height_pct > 0:
            fill_top_z = deck_top + (fill_height_pct / 100.0) * (total_h - deck_top)
            # Exclusion boundaries are shrunk by `ov` before subtracting, so
            # the fill genuinely overlaps into the wall/socket material
            # instead of exactly touching its boundary — an exact touch
            # (zero-overlap, coincident boundary) between two independently
            # unioned solids tessellates into a degenerate near-zero-volume
            # phantom shell (same failure mode `_lip_ring`'s `ov` avoids).
            ov = 0.05
            tool_wall_union = CrossSection()
            for entry in cuts:
                pk, _depth = entry[0], entry[1]
                pk_fingers = entry[2] if len(entry) > 2 else ()
                pk_connector = entry[3] if len(entry) > 3 else None
                tool_inner = _cross_section_from_poly(pk)
                for fx, fy, dia in pk_fingers:
                    tool_inner = tool_inner + CrossSection.circle(
                        dia / 2, CIRCULAR_SEGMENTS
                    ).translate((fx, fy))
                if pk_connector is not None:
                    tool_inner = tool_inner + _cross_section_from_poly(pk_connector)
                tool_wall_union = tool_wall_union + tool_inner.offset(
                    tool_wall_mm - ov, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS
                )
            fill_area = outer - tool_wall_union
            if available_cells:
                socket_footprint = _rounded_rect(
                    PITCH - 2 * ov, PITCH - 2 * ov, max(EPS, BASEPLATE_OUTER_R - ov)
                )
                for cx, cy in available_cells:
                    fill_area = fill_area - socket_footprint.translate((cx, cy))
            body = body + Manifold.extrude(
                fill_area, fill_top_z - deck_top + EPS
            ).translate((0, 0, deck_top - EPS))

        if live_grid:
            socket = _baseplate_socket().translate((0, 0, deck_top - EPS))
            for cx, cy in available_cells:
                body = body + socket.translate((cx, cy, 0))
    if lip:
        body = body + _lip_ring(
            outline, total_h, lip_height_mm, lip_chamfer_top_mm, lip_straight_mm, lip_chamfer_bottom_mm,
        )

    foot = _foot()
    feet = []
    foot_centers = []
    for ix in range(gx):
        for iy in range(gy):
            if included_cells is not None and (ix, iy) not in included_cells:
                continue
            cx, cy = _cell_center(ix, iy, gx, gy)
            feet.append(foot.translate((cx, cy, 0)))
            foot_centers.append((cx, cy))
    solid = Manifold.batch_boolean([body, *feet], OpType.Add)

    if magnet_holes:
        if not math.isfinite(magnet_hole_diameter_mm) or magnet_hole_diameter_mm <= 0:
            raise ValueError("magnet hole diameter must be > 0")
        if not math.isfinite(magnet_hole_depth_mm) or magnet_hole_depth_mm <= 0:
            raise ValueError("magnet hole depth must be > 0")
        if magnet_hole_depth_mm >= BASE_H:
            raise ValueError(
                f"magnet hole depth {magnet_hole_depth_mm}mm must be less than "
                f"the {BASE_H}mm foot height"
            )
        radius = magnet_hole_diameter_mm / 2
        magnet_hole_offset_mm = FOOT_BOTTOM_SIZE / 2 - magnet_hole_inset_from_edge_mm
        hole = Manifold.cylinder(
            magnet_hole_depth_mm + EPS, radius, radius, CIRCULAR_SEGMENTS
        ).translate((0, 0, -EPS))
        holes = [
            hole.translate((cx + hx, cy + hy, 0))
            for cx, cy in foot_centers
            for hx in (-magnet_hole_offset_mm, magnet_hole_offset_mm)
            for hy in (-magnet_hole_offset_mm, magnet_hole_offset_mm)
        ]
        solid = solid - Manifold.batch_boolean(holes, OpType.Add)

    for entry in cuts:
        pk, depth = entry[0], entry[1]
        pk_fingers = entry[2] if len(entry) > 2 else ()
        pk_connector = entry[3] if len(entry) > 3 else None
        pk_fillet_radius = entry[4] if len(entry) > 4 else None
        if not fast_path:
            if depth <= 0:
                raise ValueError("recess depth must be > 0")
            floor_z = total_h - depth
            deck_top = BASE_H + floor_thickness_mm
            if floor_z < deck_top - EPS:
                raise PocketTooDeepError(
                    f"recess depth {depth}mm needs "
                    f"≥{deck_top + depth:.1f}mm of finished height; "
                    f"increase height_u (now {height_u})"
                )
            inner = _cross_section_from_poly(pk)
            for fx, fy, dia in pk_fingers:
                inner = inner + CrossSection.circle(
                    dia / 2, CIRCULAR_SEGMENTS
                ).translate((fx, fy))
            if pk_connector is not None:
                inner = inner + _cross_section_from_poly(pk_connector)
            outer = inner.offset(
                tool_wall_mm, JoinType.Round, circular_segments=CIRCULAR_SEGMENTS
            )
            reinforced = inner.offset(
                tool_wall_mm + tool_wall_flare_mm,
                JoinType.Round,
                circular_segments=CIRCULAR_SEGMENTS,
            )
            separator = Manifold.extrude(
                outer - inner, total_h - deck_top + EPS
            ).translate((0, 0, deck_top - EPS))
            base = Manifold.extrude(
                reinforced - inner, tool_wall_reinforcement_h_mm + EPS
            ).translate((0, 0, deck_top - EPS))
            shelf_bottom = max(BASE_H, floor_z - floor_thickness_mm)
            shelf = Manifold.extrude(
                outer, floor_z - shelf_bottom + EPS
            ).translate((0, 0, shelf_bottom))
            solid = solid + separator + base + shelf
            continue
        floor_z = total_h - depth
        if floor_z < BASE_H + min_floor_mm - EPS:
            raise PocketTooDeepError(
                f"pocket depth {depth}mm needs ≥{BASE_H + min_floor_mm + depth:.1f}mm "
                f"of bin height; increase height_u (now {height_u})"
            )
        inner = _cross_section_from_poly(pk)
        cut = Manifold.extrude(inner, depth + EPS).translate((0, 0, floor_z))
        if pk_fillet_radius:
            # Only meaningful on this straight-extrusion fast path — the
            # general (corral/grid) construction never cuts a plain pocket
            # cavity to begin with, so there's no bottom corner to round.
            radius = min(pk_fillet_radius, max(0.0, depth - EPS))
            if radius > EPS:
                cut = cut + _pocket_bottom_fillet(inner, floor_z, radius)
        solid = solid - cut
        for fx, fy, dia in pk_fingers:
            cyl = Manifold.cylinder(
                depth + EPS, dia / 2, dia / 2, CIRCULAR_SEGMENTS
            ).translate((fx, fy, floor_z))
            solid = solid - cyl
        if pk_connector is not None:
            connector_cut = Manifold.extrude(
                _cross_section_from_poly(pk_connector), depth + EPS
            ).translate((0, 0, floor_z))
            solid = solid - connector_cut
        if bevel_pockets:
            top_z = floor_z + depth  # == total_h, the bin's own top face here
            round_radius = _pocket_top_round_radius(
                depth, min_wall_mm, min_wall_lip_mm, tool_wall_mm, lip,
            )
            if round_radius > EPS:
                # Each opening gets its own round-over call rather than one
                # call on their union — see _pocket_top_fillet's docstring.
                solid = solid - _pocket_top_fillet(inner, top_z, round_radius)
                for fx, fy, dia in pk_fingers:
                    finger = CrossSection.circle(dia / 2, CIRCULAR_SEGMENTS).translate((fx, fy))
                    solid = solid - _pocket_top_fillet(finger, top_z, round_radius)
                if pk_connector is not None:
                    solid = solid - _pocket_top_fillet(
                        _cross_section_from_poly(pk_connector), top_z, round_radius,
                    )

    if fast_path and pocket is not None and pocket_depth > 0:
        floor_z = total_h - pocket_depth
        for fx, fy, dia in finger_holes:
            cyl = Manifold.cylinder(
                pocket_depth + EPS, dia / 2, dia / 2, CIRCULAR_SEGMENTS
            ).translate((fx, fy, floor_z))
            solid = solid - cyl
        if finger_hole_connector is not None:
            connector_cut = Manifold.extrude(
                _cross_section_from_poly(finger_hole_connector), pocket_depth + EPS
            ).translate((0, 0, floor_z))
            solid = solid - connector_cut

    return _drop_boolean_noise(solid)


def _drop_boolean_noise(solid: Manifold) -> Manifold:
    """Discard degenerate, inverted-normal fragments a chain of boolean ops
    can leave behind — found via the general (shell) path's separator/base/
    shelf construction: unioning a ring-with-a-hole against both an adjacent
    plate below and a hole-filling disk above is a marginal case for
    manifold3d's boolean kernel, and a tiny near-zero-volume phantom shell
    can leak through even though the *intended* result is a single clean
    solid (pre-existing in today's corral/grid geometry, not something this
    parameterization introduced — just far more reachable now that the
    general path is reachable at any fill_height_pct, not only 0%).

    A real, intentional piece of geometry always has positive volume
    (correct outward-facing normals); this only ever drops negative-volume
    pieces, and only when a single positive-volume piece remains to return —
    otherwise it raises, so an actual modelling bug surfaces loudly instead
    of being silently swept away.
    """
    pieces = solid.decompose()
    if len(pieces) == 1:
        return solid
    kept = [p for p in pieces if p.volume() > 0]
    dropped = [p for p in pieces if p.volume() <= 0]
    if len(kept) != 1 or not dropped:
        raise RuntimeError(
            f"bin_solid() produced {len(pieces)} disconnected pieces "
            f"({len(kept)} with positive volume) — expected one solid "
            "connected by design; this needs a real fix, not this cleanup"
        )
    return kept[0]


SLICE_THICKNESS_MM = 1.0
MIN_SLICE_THICKNESS_MM = 0.4  # thinner than this isn't reliably printable


def slice_window(
    total_h: float, depths: list[float], thickness: float = SLICE_THICKNESS_MM
) -> tuple[float, float] | None:
    """z0 and clamped thickness for a coupon that intersects every pocket in
    `depths` at once.

    Each pocket/recess occupies [total_h - depth, total_h] — open straight
    through to the top, regardless of style — so any z within every pocket's
    range works for all of them simultaneously; centring on the shallowest
    pocket's range keeps clear of both the top face and its floor. Returns
    None if the shallowest pocket can't support a printable slice.
    """
    if not depths:
        return None
    min_depth = min(depths)
    clamped = min(thickness, min_depth)
    if clamped < MIN_SLICE_THICKNESS_MM:
        return None
    z0 = total_h - (min_depth + clamped) / 2
    return z0, clamped


def slice_layer(
    solid: Manifold, z0: float, thickness: float = SLICE_THICKNESS_MM
) -> Manifold:
    """A horizontal slab of `solid` spanning [z0, z0 + thickness], full XY extent.

    Pocket/recess cutouts are single constant-section extrusions with no
    draft or taper, so a slab anywhere within a cutout's depth range exposes
    the identical trace as the full bin — this crops one out into a small,
    fast-printing coupon for checking fit before committing to the full bin.
    """
    span = 1000.0  # comfortably larger than any bin footprint
    slab = Manifold.extrude(
        CrossSection.square((span, span), center=True), thickness
    ).translate((0, 0, z0))
    return Manifold.batch_boolean([solid, slab], OpType.Intersect)


def to_trimesh(solid: Manifold):
    import trimesh

    mesh = solid.to_mesh()
    return trimesh.Trimesh(
        vertices=np.asarray(mesh.vert_properties)[:, :3],
        faces=np.asarray(mesh.tri_verts),
        process=False,
    )
