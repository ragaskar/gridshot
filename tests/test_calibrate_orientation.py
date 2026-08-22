"""Pins the chirality contract `detect_corners`' docstring claims but never
actually tested: ChArUco object points must increase in the same direction as
image points on both axes (x right, y down, no swap, no flip) — otherwise the
homography built from them would mirror every traced tool outline. The
docstring names this test `test_object_y_matches_image_y`; it never existed
until now, so the guarantee was unverified. See docs/mirroring-investigation
notes in the commit that added this file for the fuller trace.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from gridshot.core import mat as mat_mod
from gridshot.core.models import MatSpec

SPEC = MatSpec(paper="a4", squares_x=8, squares_y=6, square_mm=25.0, marker_mm=18.0)


def _detect_object_and_image_points():
    board = mat_mod.build_board(SPEC)
    img = board.generateImage((SPEC.squares_x * 100, SPEC.squares_y * 100))
    detector = cv2.aruco.CharucoDetector(board)
    charuco_corners, charuco_ids, _, _ = detector.detectBoard(img)
    obj_pts, img_pts = board.matchImagePoints(charuco_corners, charuco_ids)
    return obj_pts.reshape(-1, 3), img_pts.reshape(-1, 2)


class TestObjectPointsMatchImageConvention:
    def test_object_y_matches_image_y(self):
        """Same object-x, increasing object-y -> increasing image-y (not flipped)."""
        obj_pts, img_pts = _detect_object_and_image_points()
        for x in sorted(set(obj_pts[:, 0])):
            rows = np.where(np.isclose(obj_pts[:, 0], x))[0]
            if len(rows) < 2:
                continue
            lo = rows[np.argmin(obj_pts[rows, 1])]
            hi = rows[np.argmax(obj_pts[rows, 1])]
            if obj_pts[hi, 1] - obj_pts[lo, 1] <= 0:
                continue
            assert img_pts[hi, 1] > img_pts[lo, 1], (
                "object-y and image-y disagree on direction — the homography "
                "would mirror every traced tool outline"
            )
            assert img_pts[hi, 0] == pytest.approx(img_pts[lo, 0], abs=0.6)
            return
        raise AssertionError("no same-x, different-y point pair found in this board")

    def test_object_x_matches_image_x(self):
        """Same object-y, increasing object-x -> increasing image-x (not flipped)."""
        obj_pts, img_pts = _detect_object_and_image_points()
        for y in sorted(set(obj_pts[:, 1])):
            cols = np.where(np.isclose(obj_pts[:, 1], y))[0]
            if len(cols) < 2:
                continue
            lo = cols[np.argmin(obj_pts[cols, 0])]
            hi = cols[np.argmax(obj_pts[cols, 0])]
            if obj_pts[hi, 0] - obj_pts[lo, 0] <= 0:
                continue
            assert img_pts[hi, 0] > img_pts[lo, 0], (
                "object-x and image-x disagree on direction — the homography "
                "would mirror every traced tool outline"
            )
            assert img_pts[hi, 1] == pytest.approx(img_pts[lo, 1], abs=0.6)
            return
        raise AssertionError("no same-y, different-x point pair found in this board")
