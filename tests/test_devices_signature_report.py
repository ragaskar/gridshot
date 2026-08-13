"""Capture-signature triage across a whole calibration batch."""

from __future__ import annotations

import pytest

from gridshot.core import devices


def names_of(report, matching: bool) -> list[str]:
    return [row.name for row in report.rows if row.matches is matching]


class TestSignatureMismatchFields:
    def test_identical_signatures_have_no_differing_fields(
        self, source_factory
    ):
        left = devices.signature_for(source_factory())
        right = devices.signature_for(source_factory())
        assert devices.signature_mismatch_fields(left, right) == []
        assert devices.same_capture_stream(left, right)

    def test_names_every_field_that_differs(self, source_factory):
        left = devices.signature_for(source_factory())
        right = devices.signature_for(
            source_factory(width=20, digital_zoom_ratio=2.0)
        )
        assert devices.signature_mismatch_fields(left, right) == [
            "image_size",
            "digital_zoom_ratio",
        ]
        assert not devices.same_capture_stream(left, right)

    def test_numeric_drift_within_tolerance_still_matches(
        self, source_factory
    ):
        left = devices.signature_for(source_factory(focal_mm=6.765))
        right = devices.signature_for(source_factory(focal_mm=6.80))
        assert devices.signature_mismatch_fields(left, right) == []

    def test_numeric_drift_beyond_tolerance_is_named(self, source_factory):
        left = devices.signature_for(source_factory(focal_mm=6.765))
        right = devices.signature_for(source_factory(focal_mm=9.0))
        assert devices.signature_mismatch_fields(left, right) == ["focal_mm"]

    def test_missing_on_one_side_only_is_a_mismatch(self, source_factory):
        left = devices.signature_for(source_factory())
        right = devices.signature_for(source_factory(digital_zoom_ratio=None))
        assert devices.signature_mismatch_fields(left, right) == [
            "digital_zoom_ratio"
        ]

    def test_text_fields_compare_case_and_whitespace_insensitively(
        self, source_factory
    ):
        left = devices.signature_for(source_factory(device_model="iPhone 15"))
        right = devices.signature_for(
            source_factory(device_model="  IPHONE   15 ")
        )
        assert devices.signature_mismatch_fields(left, right) == []


class TestBuildSignatureReport:
    def test_majority_signature_becomes_canonical(self, source_factory):
        """The user-facing rule: 3 photos agree, 2 dissent — the 3 win."""
        sources = [
            source_factory(),  # FOO
            source_factory(),  # FOO
            source_factory(width=20),  # BAR
            source_factory(),  # FOO
            source_factory(digital_zoom_ratio=2.0),  # BAZ
        ]
        report = devices.signature_report(
            sources, ["a.heic", "b.heic", "c.heic", "d.heic", "e.heic"]
        )

        assert names_of(report, True) == ["a.heic", "b.heic", "d.heic"]
        assert names_of(report, False) == ["c.heic", "e.heic"]
        assert report.matching_count == 3
        assert report.canonical == devices.signature_for(sources[0])

    def test_every_photo_is_reported_not_just_up_to_the_first_failure(
        self, source_factory
    ):
        sources = [
            source_factory(width=20),
            source_factory(),
            source_factory(),
            source_factory(digital_zoom_ratio=2.0),
        ]
        report = devices.signature_report(sources)

        assert [row.index for row in report.rows] == [1, 2, 3, 4]
        assert [row.matches for row in report.rows] == [
            False,
            True,
            True,
            False,
        ]

    def test_ties_go_to_the_earliest_photo(self, source_factory):
        sources = [source_factory(), source_factory(width=20)]
        report = devices.signature_report(sources)

        assert report.canonical == devices.signature_for(sources[0])
        assert [row.matches for row in report.rows] == [True, False]

    def test_mismatch_rows_name_the_offending_fields(self, source_factory):
        sources = [
            source_factory(),
            source_factory(),
            source_factory(width=20, height=30),
        ]
        report = devices.signature_report(sources)

        odd = report.rows[2]
        assert odd.mismatch_fields == ("image_size",)
        assert "image_size" in odd.reason
        assert report.rows[0].mismatch_fields == ()
        assert report.rows[0].reason == ""

    def test_mixed_phone_orientations_are_caught(self, source_factory):
        """Ingest bakes rotation into pixels, so a portrait shot differs in
        both image_size and orientation_deg — the common iPhone failure."""
        sources = [
            source_factory(width=16, height=12, orientation_deg=0),
            source_factory(width=16, height=12, orientation_deg=0),
            source_factory(width=12, height=16, orientation_deg=90),
        ]
        report = devices.signature_report(sources)

        assert report.rows[2].mismatch_fields == (
            "image_size",
            "orientation_deg",
        )

    def test_single_photo_always_matches_itself(self, source_factory):
        report = devices.signature_report([source_factory()])
        assert report.matching_count == 1
        assert report.rows[0].matches

    def test_empty_batch_yields_an_empty_report(self):
        report = devices.build_signature_report([])
        assert report.rows == ()
        assert report.canonical is None
        assert report.matching_count == 0

    def test_default_labels_when_no_names_given(self, source_factory):
        report = devices.signature_report([source_factory(), source_factory()])
        assert [row.name for row in report.rows] == ["view 1", "view 2"]

    def test_names_must_match_source_count(self, source_factory):
        with pytest.raises(ValueError, match="one label per source"):
            devices.signature_report([source_factory()], ["a", "b"])

    def test_signature_count_must_match_name_count(self, source_factory):
        signatures = [devices.signature_for(source_factory())]
        with pytest.raises(ValueError, match="one label per signature"):
            devices.build_signature_report(signatures, ["a", "b"])


class TestMirroredCaptures:
    def test_mirrored_photo_is_never_canonical_even_as_the_majority(
        self, source_factory
    ):
        sources = [
            source_factory(orientation_mirrored=True),
            source_factory(orientation_mirrored=True),
            source_factory(orientation_mirrored=True),
            source_factory(),
        ]
        report = devices.signature_report(sources)

        assert report.canonical is not None
        assert report.canonical.mirrored is False
        assert [row.matches for row in report.rows] == [
            False,
            False,
            False,
            True,
        ]

    def test_mirrored_rows_say_why(self, source_factory):
        report = devices.signature_report(
            [source_factory(orientation_mirrored=True), source_factory()]
        )
        assert report.rows[0].reason == devices.MIRRORED_REASON
        assert report.rows[0].mismatch_fields == ("mirrored",)

    def test_all_mirrored_leaves_no_canonical(self, source_factory):
        report = devices.signature_report(
            [
                source_factory(orientation_mirrored=True),
                source_factory(orientation_mirrored=True),
            ]
        )
        assert report.canonical is None
        assert report.matching_count == 0
        assert all(not row.matches for row in report.rows)


class TestCalibrationSignature:
    def test_uniform_batch_returns_the_shared_signature(self, source_factory):
        sources = [source_factory() for _ in range(3)]
        assert devices.calibration_signature(sources) == devices.signature_for(
            sources[0]
        )

    def test_error_lists_every_offender_not_only_the_first(
        self, source_factory
    ):
        sources = [
            source_factory(),
            source_factory(),
            source_factory(width=20),
            source_factory(),
            source_factory(digital_zoom_ratio=2.0),
        ]
        with pytest.raises(ValueError) as excinfo:
            devices.calibration_signature(sources)

        message = str(excinfo.value)
        assert "2 of 5" in message
        assert "image 3" in message
        assert "image 5" in message

    def test_mirrored_batch_is_rejected(self, source_factory):
        sources = [source_factory(orientation_mirrored=True) for _ in range(2)]
        with pytest.raises(ValueError, match=devices.MIRRORED_REASON):
            devices.calibration_signature(sources)

    def test_empty_batch_is_rejected(self):
        with pytest.raises(ValueError, match="at least one"):
            devices.calibration_signature([])
