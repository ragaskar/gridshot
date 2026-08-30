"""Bin geometry re-parameterization: `bin_solid()`'s old `style` parameter is
replaced by `fill_height_pct: float` (0-100) + `live_grid: bool`. See
docs/bin-profiles-v2-proposal.md for the full derivation.

Legacy mapping (exact, lossless): pocket -> (100, False), corral -> (0, False),
grid -> (0, True). This file pins that mapping to mesh digests, so any
accidental geometry drift in the fast path (fill_height_pct=100) or the
general path (everything else) fails loudly.

The lipless `fill_height_pct=100` (pocket) reference is byte-identical to
the pre-refactor code, as intended. Every other reference value here is
NOT — investigating a user-reported "floating artifacts" rendering bug
surfaced two real, pre-existing defects, both fixed in this pass:

1. The general path's separator/base/shelf construction: unioning a
   ring-with-a-hole against both an adjacent plate below (the deck) and a
   hole-filling disk above (the shelf) is a marginal case for manifold3d's
   boolean kernel, and a tiny negative-volume (inverted-normal) phantom
   shell could leak through even though the intended result is one clean
   solid. `_drop_boolean_noise` in gridfinity.py fixes it (decompose, keep
   the positive-volume piece, raise instead of guessing if that heuristic
   doesn't cleanly apply).
2. `_lip_ring`'s ring sat with its bottom face exactly coincident with the
   body's top face (zero overlap) — manifold3d's boolean kernel doesn't
   reliably fuse that seam, and for some grid layouts the entire lip came
   out as a genuinely disconnected floating piece rather than fused to the
   body. Fixed by extending the ring `ov` below the body's top face so it
   truly penetrates into the (always-solid there) outer wall.

Every `lip=True` reference value and every `fill_height_pct=0` reference
value were recaptured after these fixes, so they pin the corrected
geometry rather than reproducing either bug.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest
from manifold3d import Manifold, OpType

from gridshot.core import gridfinity as grid_mod

TOOL_POCKET = grid_mod.Poly(
    exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
)

# (fill_height_pct, live_grid, lip, height_u) -> (volume, nverts, digest).
# Only (100, False, False, *) is byte-identical to the pre-refactor code.
# Every (0, *, *, *) row pins the geometry after the boolean-noise fix (see
# module docstring) — lower vertex count, slightly higher volume, since a
# negative-volume phantom shell no longer gets tessellated into the mesh.
# Every (*, *, True, *) [lip] row pins the geometry after the lip-ring
# overlap fix — vertex count is higher (the ring's extra `ov` slice adds
# faces) but volume is unchanged (the overlap lands entirely inside
# material that was already solid).
LEGACY_REFERENCE = {
    (100, False, False, 3): (139560.49815429433, 1708, "e2ed2778deaa4ff1"),
    (0, False, False, 3): (49545.59723894811, 2572, "f079125c43b39eea"),
    (0, True, False, 4): (56370.93483053047, 2572, "ddd0254f353941fb"),
    (100, False, True, 3): (141774.27519762123, 2694, "abdbecc903a8ebd3"),
    (0, False, True, 3): (58303.43713631163, 3685, "bf2d5e322e1b34b9"),
    (0, True, True, 4): (68172.52489256168, 3685, "a6c81aba60169c23"),
}


def _digest(solid) -> tuple[float, int, str]:
    mesh = solid.to_mesh()
    verts = np.asarray(mesh.vert_properties)
    tris = np.asarray(mesh.tri_verts)
    h = hashlib.sha256()
    h.update(np.round(verts, 6).tobytes())
    h.update(tris.tobytes())
    return solid.volume(), verts.shape[0], h.hexdigest()[:16]


class TestLegacyStylesMatchTheirReference:
    @pytest.mark.parametrize("lip", [False, True])
    @pytest.mark.parametrize(
        "fill_height_pct,live_grid,height_u",
        [(100, False, 3), (0, False, 3), (0, True, 4)],
    )
    def test_matches_reference(self, fill_height_pct, live_grid, height_u, lip):
        solid = grid_mod.bin_solid(
            2, 2, height_u, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=fill_height_pct, live_grid=live_grid, lip=lip,
        )
        volume, nverts, digest = _digest(solid)
        expected_volume, expected_nverts, expected_digest = LEGACY_REFERENCE[
            (fill_height_pct, live_grid, lip, height_u)
        ]
        assert volume == pytest.approx(expected_volume, rel=1e-9)
        assert nverts == expected_nverts
        assert digest == expected_digest

    @pytest.mark.parametrize("live_grid", [False, True])
    def test_general_path_never_leaves_a_negative_volume_fragment(self, live_grid):
        """The regression this file's corral/grid reference values were
        recaptured for — see the module docstring. A tool's own
        separator/base/shelf construction, unioned against the deck below
        and its own shelf above, used to be able to leak a tiny inverted-
        normal phantom shell even though the result is meant to be one
        clean solid."""
        solid = grid_mod.bin_solid(
            2, 2, 4, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=0, live_grid=live_grid, lip=True,
        )
        pieces = solid.decompose()
        assert len(pieces) == 1
        assert all(p.volume() > 0 for p in pieces)

    @pytest.mark.parametrize("live_grid", [False, True])
    def test_no_tools_produces_a_plain_watertight_shell(self, live_grid):
        """A bin with zero tool footprints — a fresh "New bin", or every
        tool removed from a saved one — used to be rejected outright by a
        `not fast_path and not cuts` guard on any path but the fast one
        (fill_height_pct=100). There's no minimum tool count any more: an
        empty `pockets`/`cuts` list should just build the plain deck+wall(+
        fill) shell with nothing cut into it."""
        solid = grid_mod.bin_solid(
            2, 2, 4, pockets=[], fill_height_pct=50, live_grid=live_grid, lip=True,
        )
        mesh = grid_mod.to_trimesh(solid)
        assert mesh.is_watertight
        assert mesh.volume > 0

    def test_lip_is_never_a_disconnected_floating_piece(self):
        """Regression test for the second bug this file's docstring
        describes: for some grid layouts, `_lip_ring`'s zero-overlap seam
        against the body's top face left the entire lip as a genuinely
        disconnected piece — not a phantom sliver, a real floating shell,
        matching a user report of "floating artifacts above the lip" that
        produced a slicer warning. 3x2 at height_u=6 reproduced it; this
        pins that exact case plus a small parameter sweep."""
        for gx, gy, height_u in [(3, 2, 6), (2, 3, 6), (4, 3, 5), (2, 2, 3)]:
            solid = grid_mod.bin_solid(
                gx, gy, height_u, pocket=TOOL_POCKET, pocket_depth=5.0,
                fill_height_pct=0, live_grid=False, lip=True,
            )
            pieces = solid.decompose()
            assert len(pieces) == 1, (gx, gy, height_u, len(pieces))

    def test_default_fill_height_pct_is_100(self):
        """Omitting fill_height_pct/live_grid entirely still means pocket."""
        default = grid_mod.bin_solid(
            2, 2, 3, pocket=TOOL_POCKET, pocket_depth=5.0,
        )
        explicit = grid_mod.bin_solid(
            2, 2, 3, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=100, live_grid=False,
        )
        assert default.volume() == pytest.approx(explicit.volume(), rel=1e-9)


class TestLiveGridReachableFromSolidFill:
    def test_needs_at_least_2u_even_at_full_fill_height(self):
        """The stacking-plane clearance guard used to only fire for
        style=="grid" -- it must now fire for live_grid=True regardless of
        fill_height_pct, since a fully-filled bin can still host sockets."""
        with pytest.raises(ValueError, match="grid style needs at least 2u|live.grid"):
            grid_mod.bin_solid(
                2, 2, 1, pocket=TOOL_POCKET, pocket_depth=2.0,
                fill_height_pct=100, live_grid=True,
            )


def _probe(solid: Manifold, x: float, y: float, z: float, size: float = 1.0) -> bool:
    """True if `solid` has material at (x, y, z) — intersects a small cube
    centred there and checks whether anything survives."""
    box = Manifold.cube((size, size, size), center=True).translate((x, y, z))
    return not Manifold.batch_boolean([solid, box], OpType.Intersect).is_empty()


class TestIntermediateFillHeight:
    """0% and 100% were already pinned byte-identical to the pre-refactor
    corral/pocket code above. This is the new territory in between —
    Phase 3 of docs/bin-profiles-v2-proposal.md."""

    def _bin(self, fill_height_pct: float, live_grid: bool = False, height_u: int = 6):
        return grid_mod.bin_solid(
            3, 1, height_u, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=fill_height_pct, live_grid=live_grid, lip=False,
        )

    @pytest.mark.parametrize("fill_height_pct", [25, 50, 75])
    def test_produces_a_single_valid_watertight_solid(self, fill_height_pct):
        solid = self._bin(fill_height_pct)
        mesh = grid_mod.to_trimesh(solid)
        assert mesh.is_watertight
        assert len(mesh.split(only_watertight=False)) == 1
        assert solid.volume() > 0

    def test_higher_fill_height_means_more_material(self):
        volumes = [self._bin(pct).volume() for pct in (0, 25, 50, 75, 100)]
        assert volumes == sorted(volumes)
        assert volumes[0] < volumes[-1]

    def test_general_floor_area_is_solid_below_the_fill_line_hollow_above_it(self):
        # 3x1 grid, tool centred in cell 1 (the middle) — probe the general
        # floor area under the *unused* cell 0, away from the tool's own wall.
        solid = self._bin(fill_height_pct=50, height_u=8)
        deck_top = grid_mod.BASE_H + grid_mod.FLOOR_THICKNESS
        total_h = 8 * grid_mod.UNIT_H
        fill_top_z = deck_top + 0.5 * (total_h - deck_top)
        probe_x = -grid_mod.PITCH  # cell 0's centre, away from the tool in cell 1
        assert _probe(solid, probe_x, 0, deck_top + 1.0)  # just above the deck: solid
        assert not _probe(solid, probe_x, 0, total_h - 1.0)  # near the top: hollow
        assert not _probe(solid, probe_x, 0, fill_top_z + 2.0)  # comfortably above the fill line

    def test_a_tools_own_pocket_is_unaffected_by_fill_height(self):
        """The tool's own wall/shelf/cavity is unconditional — filling the
        general area around it must never intrude into its pocket."""
        depth = 5.0
        for pct in (0, 50, 100):
            solid = grid_mod.bin_solid(
                3, 1, 6, pocket=TOOL_POCKET, pocket_depth=depth,
                fill_height_pct=pct, live_grid=False, lip=False,
            )
            total_h = 6 * grid_mod.UNIT_H
            # tool is centred at the grid's own centre (cell 1) by construction
            assert not _probe(solid, 0, 0, total_h - depth / 2, size=4.0)

    def test_live_grid_at_full_fill_height_matches_zero_fill_height_socket_count(self):
        """The new "Pocket Live Grid" combo: sockets fill exactly the same
        cells whether the rest of the floor is hollow or fully filled."""
        # A 4x2 grid actually leaves eligible cells for this tool+wall combo
        # (checked directly via grid_available_cells) — a 3x1 grid doesn't,
        # which would make this test vacuous rather than wrong.
        assert grid_mod.grid_available_cells(
            4, 2, [(TOOL_POCKET, 5.0, ())], lip=False,
        ) == [(-grid_mod.PITCH, 0.0), (grid_mod.PITCH, 0.0)]

        low = grid_mod.bin_solid(
            4, 2, 6, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=0, live_grid=True, lip=False,
        )
        high = grid_mod.bin_solid(
            4, 2, 6, pocket=TOOL_POCKET, pocket_depth=5.0,
            fill_height_pct=100, live_grid=True, lip=False,
        )
        # A live-grid socket's own cavity must be identically hollowed out
        # in both cases — a socket needs a genuinely open cavity above it
        # regardless of how the rest of the floor is filled.
        deck_top = grid_mod.BASE_H + grid_mod.FLOOR_THICKNESS
        socket_cavity_z = deck_top + grid_mod.BASEPLATE_H / 2
        socket_x = -grid_mod.PITCH  # one of the two eligible cells
        assert not _probe(low, socket_x, 0, socket_cavity_z, size=4.0)
        assert not _probe(high, socket_x, 0, socket_cavity_z, size=4.0)
        assert high.volume() > low.volume()

    def test_both_depth_guards_fire_in_their_own_regime(self):
        # Fast path (fill_height_pct=100, live_grid off): min_floor_mm guard.
        with pytest.raises(grid_mod.PocketTooDeepError, match="pocket depth"):
            grid_mod.bin_solid(
                2, 2, 1, pocket=TOOL_POCKET, pocket_depth=15.0,
                fill_height_pct=100, live_grid=False,
            )
        # General path (anything else): deck_top guard.
        with pytest.raises(grid_mod.PocketTooDeepError, match="recess depth"):
            grid_mod.bin_solid(
                2, 2, 1, pocket=TOOL_POCKET, pocket_depth=15.0,
                fill_height_pct=50, live_grid=False,
            )
