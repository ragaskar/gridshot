"""Bin Profiles: named, reusable presets of bin *style* parameters (lip,
base geometry mode, magnet-hole defaults, allow-custom-shape, and advanced
structural constants) — storage layer and CLI, ahead of the REST API."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from gridshot.cli.main import app
from gridshot.core import binprofiles as profiles_mod


@pytest.fixture
def profiles_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


class TestStorage:
    def test_a_fresh_config_dir_self_heals_the_3_seeded_profiles(self, profiles_dir):
        profiles = profiles_mod.list_profiles()

        assert {p.id for p in profiles} == {
            profiles_mod.SEED_POCKET_ID, profiles_mod.SEED_CORRAL_ID, profiles_mod.SEED_GRID_ID,
        }
        pocket = next(p for p in profiles if p.id == profiles_mod.SEED_POCKET_ID)
        assert pocket.name == "Pocket"
        assert pocket.base_style == "pocket"
        assert pocket.lip is True
        assert pocket.allow_custom_shape is True
        # Every structural field inherits gridfinity.py's module constant —
        # this is what guarantees the seed reproduces today's geometry exactly.
        assert pocket.lip_height_mm is None
        assert pocket.min_wall_mm is None

        corral = next(p for p in profiles if p.id == profiles_mod.SEED_CORRAL_ID)
        grid = next(p for p in profiles if p.id == profiles_mod.SEED_GRID_ID)
        assert corral.allow_custom_shape is False
        assert grid.allow_custom_shape is False

    def test_seeding_does_not_resurrect_deleted_defaults(self, profiles_dir):
        profiles_mod.list_profiles()  # triggers the initial self-heal
        for seed_id in (profiles_mod.SEED_POCKET_ID, profiles_mod.SEED_CORRAL_ID, profiles_mod.SEED_GRID_ID):
            profiles_mod.delete_profile(seed_id)

        assert profiles_mod.list_profiles() == []

    def test_save_load_delete_round_trip(self, profiles_dir):
        profiles_mod.list_profiles()  # ensure the dir/marker exist
        custom = profiles_mod.BinProfile(
            id=profiles_mod.new_profile_id(), name="My Style",
            base_style="pocket", lip=False, min_wall_mm=2.5,
        )
        profiles_mod.save_profile(custom)

        loaded = profiles_mod.load_profile(custom.id)
        assert loaded.name == "My Style"
        assert loaded.lip is False
        assert loaded.min_wall_mm == 2.5

        assert profiles_mod.delete_profile(custom.id) is True
        assert profiles_mod.delete_profile(custom.id) is False
        with pytest.raises(KeyError):
            profiles_mod.load_profile(custom.id)

    def test_delete_also_removes_the_preview_image(self, profiles_dir):
        profiles_mod.list_profiles()
        custom = profiles_mod.BinProfile(id=profiles_mod.new_profile_id(), name="Has Preview")
        profiles_mod.save_profile(custom)
        profiles_mod.save_preview(custom.id, b"\x89PNG\r\n fake")

        assert profiles_mod.has_preview(custom.id) is True
        profiles_mod.delete_profile(custom.id)
        assert profiles_mod.has_preview(custom.id) is False

    def test_list_is_newest_first(self, profiles_dir):
        profiles_mod.list_profiles()
        older = profiles_mod.BinProfile(id=profiles_mod.new_profile_id(), name="Older", created_ts=100)
        newer = profiles_mod.BinProfile(id=profiles_mod.new_profile_id(), name="Newer", created_ts=200)
        profiles_mod.save_profile(older)
        profiles_mod.save_profile(newer)

        names = [p.name for p in profiles_mod.list_profiles()]
        assert names.index("Newer") < names.index("Older")

    def test_a_profile_missing_new_fields_loads_with_defaults(self, profiles_dir):
        # Simulates an old profile JSON written before a new field existed —
        # not a real scenario yet (this is the first version), but pins the
        # guarantee new Optional fields rely on: Pydantic fills them in.
        profiles_mod.list_profiles()
        path = profiles_mod.profiles_dir() / "legacy.json"
        path.write_text('{"id": "legacy", "name": "Legacy"}')

        loaded = profiles_mod.load_profile("legacy")
        assert loaded.base_style == "pocket"
        assert loaded.lip_height_mm is None


class TestCli:
    def test_seed_is_idempotent(self, profiles_dir):
        runner = CliRunner()
        first = runner.invoke(app, ["bin-profiles", "seed"])
        second = runner.invoke(app, ["bin-profiles", "seed"])

        assert first.exit_code == 0
        assert "seeded:" in first.output
        assert second.exit_code == 0
        assert "already exist" in second.output

    def test_reseed_resets_builtins_without_touching_custom_profiles(self, profiles_dir):
        profiles_mod.list_profiles()
        custom = profiles_mod.BinProfile(id=profiles_mod.new_profile_id(), name="Mine")
        profiles_mod.save_profile(custom)
        pocket = profiles_mod.load_profile(profiles_mod.SEED_POCKET_ID)
        profiles_mod.save_profile(pocket.model_copy(update={"lip": False}))

        runner = CliRunner()
        result = runner.invoke(app, ["bin-profiles", "reseed"])

        assert result.exit_code == 0
        assert profiles_mod.load_profile(profiles_mod.SEED_POCKET_ID).lip is True
        assert profiles_mod.load_profile(custom.id).name == "Mine"

    def test_list_marks_seeded_profiles(self, profiles_dir):
        runner = CliRunner()
        result = runner.invoke(app, ["bin-profiles", "list"])

        assert result.exit_code == 0
        assert result.output.count("*") == 3

    def test_delete_reports_an_error_for_an_unknown_id(self, profiles_dir):
        runner = CliRunner()
        result = runner.invoke(app, ["bin-profiles", "delete", "no-such-profile"])

        assert result.exit_code != 0
