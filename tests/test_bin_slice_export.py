"""finalize_bin's slice export: a thin, full-footprint horizontal coupon of
the pocket/recess cutout, written alongside the full bin's STL/3MF so trace
tolerance can be checked by printing a small coupon instead of the whole bin.
"""

from __future__ import annotations

import pytest
import trimesh

from gridshot.core import gridfinity as grid_mod
from gridshot.core import trace as trace_mod
from gridshot.core.models import Poly

TOOL_OUTLINE = Poly(
    exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)]
)


def _finalize(tmp_path, **overrides):
    kwargs = dict(
        smoothed=TOOL_OUTLINE,
        calibration=None,
        thickness_mm=4.0,
        pre_corrected=True,
        out_dir=tmp_path,
        stem="tool",
    )
    kwargs.update(overrides)
    return trace_mod.finalize_bin(**kwargs)


class TestSliceExport:
    def test_slice_files_are_produced_alongside_the_full_bin(self, tmp_path):
        result = _finalize(tmp_path)

        assert result.files["slice-stl"].is_file()
        assert result.files["slice-3mf"].is_file()

    def test_slice_is_a_thin_coupon_inside_the_full_bins_height(self, tmp_path):
        result = _finalize(tmp_path)

        slice_mesh = trimesh.load(result.files["slice-stl"])
        full_mesh = trimesh.load(result.files["stl"])
        zmin, zmax = slice_mesh.bounds[:, 2]
        full_zmin, full_zmax = full_mesh.bounds[:, 2]

        assert zmax - zmin == pytest.approx(grid_mod.SLICE_THICKNESS_MM, abs=1e-3)
        assert full_zmin <= zmin
        assert zmax <= full_zmax

    def test_slice_exposes_the_pocket_hole(self, tmp_path):
        """The cutout must actually be present in the coupon: its footprint
        holds less material than a solid slab of the same thickness/extent."""
        result = _finalize(tmp_path)
        mesh = trimesh.load(result.files["slice-stl"])
        (xmin, ymin, _), (xmax, ymax, _) = mesh.bounds
        solid_slab_volume = (xmax - xmin) * (ymax - ymin) * grid_mod.SLICE_THICKNESS_MM

        assert mesh.volume < solid_slab_volume

    def test_shallow_pocket_depth_skips_the_slice_with_a_warning(self, tmp_path):
        result = _finalize(
            tmp_path, pocket_depth_mm=grid_mod.MIN_SLICE_THICKNESS_MM / 2
        )

        assert "slice-stl" not in result.files
        assert "slice-3mf" not in result.files
        assert any("slice" in w for w in result.warnings)
