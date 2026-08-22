"""Core-level geometry for a custom (non-rectangular) pocket-style bin
footprint: `validate_connected_shape` and `bin_solid(..., included_cells=...)`.
See tests/test_combine_custom_bin_shape.py for the HTTP-level surface."""

from __future__ import annotations

import pytest

from gridshot.core import gridfinity as grid_mod


class TestValidateConnectedShape:
    def test_accepts_a_fully_connected_l_shape(self):
        grid_mod.validate_connected_shape(2, 2, frozenset({(0, 1), (1, 0), (1, 1)}))

    def test_accepts_a_ring_with_a_hole_in_the_middle(self):
        included = frozenset(
            (ix, iy) for ix in range(3) for iy in range(3) if (ix, iy) != (1, 1)
        )
        grid_mod.validate_connected_shape(3, 3, included)

    def test_rejects_two_diagonally_touching_islands(self):
        with pytest.raises(grid_mod.DisconnectedBinShapeError, match="connected"):
            grid_mod.validate_connected_shape(2, 2, frozenset({(0, 0), (1, 1)}))

    def test_rejects_a_cell_outside_the_grid(self):
        with pytest.raises(grid_mod.DisconnectedBinShapeError, match="outside"):
            grid_mod.validate_connected_shape(2, 2, frozenset({(0, 0), (5, 5)}))

    def test_rejects_an_empty_shape(self):
        with pytest.raises(grid_mod.DisconnectedBinShapeError):
            grid_mod.validate_connected_shape(2, 2, frozenset())


class TestBinSolidCustomShape:
    def test_l_shape_produces_a_valid_manifold(self):
        included = frozenset({(0, 1), (1, 0), (1, 1)})
        solid = grid_mod.bin_solid(2, 2, height_u=3, included_cells=included)
        assert solid.status().name == "NoError"
        assert solid.volume() > 0

    def test_l_shape_with_lip_produces_a_valid_manifold(self):
        included = frozenset({(0, 1), (1, 0), (1, 1)})
        solid = grid_mod.bin_solid(2, 2, height_u=3, lip=True, included_cells=included)
        assert solid.status().name == "NoError"
        assert solid.volume() > 0

    def test_full_grid_included_cells_matches_the_default_unmasked_bin(self):
        full = frozenset((ix, iy) for ix in range(2) for iy in range(2))
        masked = grid_mod.bin_solid(2, 2, height_u=3, lip=True, included_cells=full)
        default = grid_mod.bin_solid(2, 2, height_u=3, lip=True, included_cells=None)
        assert masked.volume() == pytest.approx(default.volume(), rel=1e-9)

    def test_custom_shape_rejected_off_the_fast_path(self):
        pocket = grid_mod.Poly(
            exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
        )
        with pytest.raises(ValueError, match="fill_height_pct=100"):
            grid_mod.bin_solid(
                2, 2, height_u=3, fill_height_pct=0,
                pockets=[(pocket, 4.0, [])],
                included_cells=frozenset({(0, 1), (1, 0), (1, 1)}),
            )

    def test_removed_corner_produces_fewer_feet_than_a_full_grid(self):
        # 3 of 4 cells included → 3 feet, not 4 — the clearest structural
        # signal that the removed cell's foot is actually skipped.
        included = frozenset({(0, 1), (1, 0), (1, 1)})
        solid = grid_mod.bin_solid(2, 2, height_u=3, included_cells=included)
        default = grid_mod.bin_solid(2, 2, height_u=3, included_cells=None)
        assert solid.volume() < default.volume()
