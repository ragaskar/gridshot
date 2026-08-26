"""Bin tools: private, per-bin copies of tool geometry, forked out of the
Tool Library (see gridshot/core/bintools.py) so a saved Bin Library entry can
stop referencing a library tool at all."""

from __future__ import annotations

import pytest

from gridshot.core import bintools as bintools_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly

OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _library_tool(**overrides) -> library_mod.LibraryTool:
    fields = dict(id="tool-a", label="Wrench", outline=OUTLINE, thickness_mm=4.0)
    fields.update(overrides)
    return library_mod.LibraryTool(**fields)


class TestIds:
    def test_new_bin_tool_id_is_prefixed(self, config_dir):
        assert bintools_mod.new_bin_tool_id().startswith("bintool-")

    def test_bin_tool_ids_are_disjoint_from_library_ids_by_construction(self, config_dir):
        # Library/bin/profile ids are f"{int(time.time())}-{hex}" — always start
        # with a digit. A "bintool-" id can never collide with one.
        assert not bintools_mod.is_bin_tool_id("1234567890-abcdef")
        assert bintools_mod.is_bin_tool_id(bintools_mod.new_bin_tool_id())


class TestStorage:
    def test_save_load_round_trips(self, config_dir):
        tool = bintools_mod.save(_library_tool(id="bintool-1-aaaaaa"))

        loaded = bintools_mod.load("bintool-1-aaaaaa")
        assert loaded.id == "bintool-1-aaaaaa"
        assert loaded.outline == OUTLINE
        assert tool.id == loaded.id

    def test_load_raises_keyerror_for_missing(self, config_dir):
        with pytest.raises(KeyError):
            bintools_mod.load("bintool-no-such-id")

    def test_delete_removes_it_and_is_idempotent(self, config_dir):
        bintools_mod.save(_library_tool(id="bintool-1-aaaaaa"))

        assert bintools_mod.delete("bintool-1-aaaaaa") is True
        assert bintools_mod.delete("bintool-1-aaaaaa") is False
        with pytest.raises(KeyError):
            bintools_mod.load("bintool-1-aaaaaa")

    def test_a_bin_tool_is_never_listed_as_a_library_tool(self, config_dir):
        bintools_mod.save(_library_tool(id="bintool-1-aaaaaa"))

        assert library_mod.list_tools() == []


class TestDuplicate:
    def test_duplicate_copies_geometry_but_not_photo_or_provenance(self, config_dir):
        source = library_mod.save(_library_tool(
            label="Wrench", clearance_mm=2.5, has_photo=True,
            source_project="proj-1", source_tool="a",
        ))

        forked = bintools_mod.duplicate(source, "bintool-1-aaaaaa")

        assert forked.id == "bintool-1-aaaaaa"
        assert forked.label == "Wrench (copy)"
        assert forked.outline == source.outline
        assert forked.clearance_mm == 2.5
        assert forked.has_photo is False
        assert forked.calibration is None
        assert forked.source_project == ""
        assert forked.source_tool == ""
        assert forked.outline_history == []
        # persisted, and independent of the source from here on
        assert bintools_mod.load("bintool-1-aaaaaa").label == "Wrench (copy)"

    def test_duplicating_a_bin_tool_works_too(self, config_dir):
        source = bintools_mod.save(_library_tool(id="bintool-1-aaaaaa", label="Copy 1"))

        forked = bintools_mod.duplicate(source, "bintool-2-bbbbbb")

        assert forked.label == "Copy 1 (copy)"
        assert forked.outline == source.outline


class TestFreeze:
    def test_freeze_copies_geometry_but_keeps_the_original_label(self, config_dir):
        source = library_mod.save(_library_tool(label="Wrench", clearance_mm=2.5))

        frozen = bintools_mod.freeze(source, "bintool-1-aaaaaa")

        assert frozen.id == "bintool-1-aaaaaa"
        assert frozen.label == "Wrench"  # not "Wrench (copy)" — see duplicate() for that
        assert frozen.outline == source.outline
        assert frozen.clearance_mm == 2.5
        assert frozen.has_photo is False
        assert frozen.calibration is None


class TestToolshapeSurvivesForking:
    """A toolshape has no source tool, so it only ever reaches _fork() via
    Duplicate or a bin Save (which freezes every tool) — regression coverage
    for _fork()'s explicit field allowlist silently dropping the new
    toolshape_* fields and leaving an uneditable static outline behind."""

    def test_duplicate_keeps_the_toolshape_params(self, config_dir):
        source = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=25.0, radius_mm=2.0, fillet_bottom=True,
        )

        forked = bintools_mod.duplicate(source, "bintool-2-bbbbbb")

        assert forked.toolshape_type == "rounded_rect"
        assert forked.toolshape_width_mm == 30.0
        assert forked.toolshape_length_mm == 25.0
        assert forked.toolshape_radius_mm == 2.0
        assert forked.toolshape_fillet_bottom is True
        assert forked.outline == source.outline

    def test_freeze_keeps_the_toolshape_params(self, config_dir):
        source = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=25.0, radius_mm=2.0, fillet_bottom=True,
        )

        frozen = bintools_mod.freeze(source, "bintool-2-bbbbbb")

        assert frozen.toolshape_type == "rounded_rect"
        assert frozen.toolshape_width_mm == 30.0
        assert frozen.toolshape_fillet_bottom is True

    def test_a_plain_tool_forks_with_no_toolshape_fields(self, config_dir):
        source = library_mod.save(_library_tool())

        forked = bintools_mod.duplicate(source, "bintool-1-aaaaaa")

        assert forked.toolshape_type is None
        assert forked.toolshape_fillet_bottom is False


class TestCreateToolshape:
    def test_generates_an_outline_from_the_params(self, config_dir):
        tool = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
        )

        assert tool.id.startswith("bintool-")
        assert tool.toolshape_type == "rounded_rect"
        assert tool.toolshape_width_mm == 30.0
        assert tool.toolshape_length_mm == 20.0
        assert tool.toolshape_radius_mm == 1.0
        assert tool.toolshape_fillet_bottom is False
        assert tool.outline is not None
        assert tool.outline == tool.raw_outline
        assert tool.thickness_mm > 0  # has a default height, editable afterward

    def test_never_appears_in_the_tool_library(self, config_dir):
        bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
        )

        assert library_mod.list_tools() == []

    def test_is_persisted_and_reloadable(self, config_dir):
        tool = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
        )

        assert bintools_mod.load(tool.id).toolshape_width_mm == 30.0

    def test_rejects_an_unknown_toolshape_type(self, config_dir):
        with pytest.raises(ValueError):
            bintools_mod.create_toolshape(
                "hexagon", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
            )


class TestUpdateToolshape:
    def test_changing_width_regenerates_the_outline(self, config_dir):
        tool = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
        )

        updated = bintools_mod.update_toolshape(tool, width_mm=50.0)

        assert updated.toolshape_width_mm == 50.0
        assert updated.toolshape_length_mm == 20.0  # untouched fields stay put
        assert updated.outline != tool.outline
        assert updated.outline == updated.raw_outline

    def test_omitted_fields_keep_their_current_value(self, config_dir):
        tool = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=True,
        )

        updated = bintools_mod.update_toolshape(tool, radius_mm=2.0)

        assert updated.toolshape_width_mm == 30.0
        assert updated.toolshape_length_mm == 20.0
        assert updated.toolshape_fillet_bottom is True

    def test_persists_the_change(self, config_dir):
        tool = bintools_mod.create_toolshape(
            "rounded_rect", width_mm=30.0, length_mm=20.0, radius_mm=1.0, fillet_bottom=False,
        )

        bintools_mod.update_toolshape(tool, fillet_bottom=True)

        assert bintools_mod.load(tool.id).toolshape_fillet_bottom is True


class TestResolveTool:
    def test_resolves_a_plain_id_from_the_library(self, config_dir):
        library_mod.save(_library_tool(id="tool-a"))

        resolved = bintools_mod.resolve_tool("tool-a")

        assert resolved.id == "tool-a"

    def test_resolves_a_bintool_prefixed_id_from_the_bin_tools_store(self, config_dir):
        bintools_mod.save(_library_tool(id="bintool-1-aaaaaa"))

        resolved = bintools_mod.resolve_tool("bintool-1-aaaaaa")

        assert resolved.id == "bintool-1-aaaaaa"

    def test_raises_keyerror_for_an_unknown_id_in_either_space(self, config_dir):
        with pytest.raises(KeyError):
            bintools_mod.resolve_tool("tool-no-such-id")
        with pytest.raises(KeyError):
            bintools_mod.resolve_tool("bintool-no-such-id")
