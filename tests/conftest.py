"""Shared fixtures.

Calibration is pure OpenCV geometry, so nothing here touches the GPU
segmentation service; see .claude/rules/testing.md for the stubbing policy.
"""

from __future__ import annotations

import numpy as np
import pytest


class FakeSource:
    """Stand-in for ingest.SourceImage carrying only what signatures read."""

    def __init__(self, width: int, height: int, exif: dict | None = None):
        self.pixels = np.zeros((height, width, 3), dtype=np.uint8)
        self.path = "fake"
        self.exif = exif or {}

    @property
    def width(self) -> int:
        return self.pixels.shape[1]

    @property
    def height(self) -> int:
        return self.pixels.shape[0]


@pytest.fixture
def source_factory():
    """Build a FakeSource from EXIF keyword overrides.

    Defaults describe one plausible landscape iPhone capture; tests vary only
    the field under test so a failure names the field that broke.
    """

    def build(width: int = 16, height: int = 12, **exif) -> FakeSource:
        base = {
            "device_make": "Apple",
            "device_model": "iPhone 15 Pro",
            "lens_model": "iPhone 15 Pro back camera 6.765mm f/1.78",
            "orientation_deg": 0,
            "focal_mm": 6.765,
            "focal_35mm": 24.0,
            "digital_zoom_ratio": 1.0,
        }
        base.update(exif)
        return FakeSource(width, height, base)

    return build
