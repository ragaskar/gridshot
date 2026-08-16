"""finalize_bin's magnet-hole wiring: the option flows from BinSettings
through DerivedBinSpec into the actual generated solid, is reflected back on
TraceResult, and changes the derivation_key (so cached STL/3MF downloads
don't go stale when only the magnet-hole settings change)."""

from __future__ import annotations

import trimesh

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


class TestMagnetHolesInFinalizeBin:
    def test_disabled_by_default(self, tmp_path):
        result = _finalize(tmp_path)

        assert result.magnet_holes is False

    def test_enabling_reduces_the_generated_mesh_volume(self, tmp_path):
        plain = trimesh.load(_finalize(tmp_path, stem="plain").files["stl"])
        holed = trimesh.load(
            _finalize(tmp_path, stem="holed", magnet_holes=True).files["stl"]
        )

        assert holed.volume < plain.volume

    def test_result_reports_the_effective_settings(self, tmp_path):
        result = _finalize(
            tmp_path,
            magnet_holes=True,
            magnet_hole_diameter_mm=5.0,
            magnet_hole_depth_mm=1.5,
        )

        assert result.magnet_holes is True
        assert result.magnet_hole_diameter_mm == 5.0
        assert result.magnet_hole_depth_mm == 1.5

    def test_derivation_key_changes_with_magnet_settings(self, tmp_path):
        """Downloads are cache-busted by derivation_key — it must change
        whenever magnet-hole settings change, or a stale file could be served."""
        off = _finalize(tmp_path, stem="off")
        on = _finalize(tmp_path, stem="on", magnet_holes=True)
        different_size = _finalize(
            tmp_path, stem="bigger", magnet_holes=True,
            magnet_hole_diameter_mm=8.0,
        )

        keys = {off.derivation_key, on.derivation_key, different_size.derivation_key}
        assert len(keys) == 3
