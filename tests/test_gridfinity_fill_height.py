"""Bin geometry re-parameterization: `bin_solid()`'s old `style` parameter is
replaced by `fill_height_pct: float` (0-100) + `live_grid: bool`. See
docs/bin-profiles-v2-proposal.md for the full derivation.

Legacy mapping (exact, lossless): pocket -> (100, False), corral -> (0, False),
grid -> (0, True). This file pins that mapping to mesh digests captured from
the pre-refactor code, so any accidental geometry drift in the fast path
(fill_height_pct=100) or the general path (everything else) fails loudly.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from gridshot.core import gridfinity as grid_mod

TOOL_POCKET = grid_mod.Poly(
    exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
)

# (fill_height_pct, live_grid, lip, height_u) -> (volume, nverts, digest),
# captured from bin_solid(style=..., ...) before this refactor.
LEGACY_REFERENCE = {
    (100, False, False, 3): (139560.49815429433, 1708, "e2ed2778deaa4ff1"),
    (0, False, False, 3): (47775.5972389481, 2588, "593c90599b2dc3c4"),
    (0, True, False, 4): (53200.93483053047, 2588, "23cc0cc681b66c21"),
    (100, False, True, 3): (141774.27519762123, 2657, "3fdfb469deeab077"),
    (0, False, True, 3): (56533.43713631049, 3645, "3adba1781777b699"),
    (0, True, True, 4): (65002.524892560534, 3645, "cec7d24f84ccda0d"),
}


def _digest(solid) -> tuple[float, int, str]:
    mesh = solid.to_mesh()
    verts = np.asarray(mesh.vert_properties)
    tris = np.asarray(mesh.tri_verts)
    h = hashlib.sha256()
    h.update(np.round(verts, 6).tobytes())
    h.update(tris.tobytes())
    return solid.volume(), verts.shape[0], h.hexdigest()[:16]


class TestLegacyStylesAreByteIdentical:
    @pytest.mark.parametrize("lip", [False, True])
    @pytest.mark.parametrize(
        "fill_height_pct,live_grid,height_u",
        [(100, False, 3), (0, False, 3), (0, True, 4)],
    )
    def test_matches_pre_refactor_reference(self, fill_height_pct, live_grid, height_u, lip):
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
