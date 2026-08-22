"""scripts/lib-compose.sh — the container-runtime setup the wrappers share.

Driven through bash with stub engine binaries on PATH, because the behaviour
under test is entirely "which engine is this, and what did it tell us".
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parent.parent / "scripts" / "lib-compose.sh"
BASH = shutil.which("bash")
assert BASH, "bash not found on PATH — needed to run these tests at all"

# lib-compose.sh only ever shells out to `mkdir`/`grep` (plus whatever engine
# `command -v` finds) — real ones, symlinked into the stub dir below, so a
# "no docker/podman" test stays true even on a dev box that actually has one
# installed under /usr/bin. `bash` is here too: stub scripts below are
# `#!/usr/bin/env bash`, and `env` resolves that via this same restricted PATH.
REAL_TOOLS = ("mkdir", "grep", "bash")


@pytest.fixture
def workdir(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in REAL_TOOLS:
        real = shutil.which(tool)
        assert real, f"{tool} not found on PATH — needed to run these tests at all"
        (bin_dir / tool).symlink_to(real)
    return tmp_path


def stub(workdir, name: str, *, stdout: str = "", exit_code: int = 0) -> None:
    path = workdir / "bin" / name
    path.write_text(f'#!/usr/bin/env bash\nprintf %s "{stdout}"\nexit {exit_code}\n')
    path.chmod(0o755)


ROOTLESS_DOCKER = "name=rootless name=seccomp,profile=builtin"
ROOTFUL_DOCKER = "name=seccomp,profile=builtin name=apparmor"
# podman-docker's shim forwards to podman's native schema, which has no
# SecurityOptions field for the template to render.
PODMAN_SHIM = "<no value>"


def run(workdir, script: str, env: dict[str, str] | None = None):
    return subprocess.run(
        [BASH, "-c", f"set -euo pipefail\nsource {LIB}\n{script}"],
        cwd=workdir,
        capture_output=True,
        text=True,
        # PATH is *only* the stub dir — no real /usr/bin:/bin fallback — so a
        # scenario that doesn't stub docker/podman means that engine is
        # genuinely absent, regardless of what the host actually has installed.
        env={"PATH": str(workdir / "bin"), **(env or {})},
    )


def run_setup(workdir, env: dict[str, str] | None = None):
    """Run the full setup, reporting the resulting GRIDSHOT_USER on stdout."""
    return run(
        workdir,
        'gridshot_compose_setup\nprintf %s "${GRIDSHOT_USER:-}"\n',
        env,
    )


def user_after_setup(workdir, env: dict[str, str] | None = None) -> str:
    result = run_setup(workdir, env)
    assert result.returncode == 0, result.stderr
    return result.stdout


class TestEnginePick:
    def test_docker_is_preferred_when_present(self, workdir):
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)
        stub(workdir, "podman", stdout="false")

        result = run(workdir, 'gridshot_pick_engine\nprintf %s "$GRIDSHOT_COMPOSE"')

        assert result.stdout == "docker compose"

    def test_podman_is_used_when_docker_is_absent(self, workdir):
        stub(workdir, "podman", stdout="false")

        result = run(workdir, 'gridshot_pick_engine\nprintf %s "$GRIDSHOT_COMPOSE"')

        assert result.stdout == "podman compose"

    def test_an_explicit_provider_wins(self, workdir):
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)

        result = run(
            workdir,
            'gridshot_pick_engine\nprintf "%s|%s" "$GRIDSHOT_COMPOSE" "$GRIDSHOT_ENGINE"',
            {"GRIDSHOT_COMPOSE": "podman-compose"},
        )

        assert result.stdout == "podman-compose|podman"

    def test_no_engine_at_all_fails_loudly(self, workdir):
        result = run_setup(workdir)

        assert result.returncode != 0
        assert "no docker or podman on PATH" in result.stderr

    def test_the_compose_command_is_invoked_as_two_words(self, workdir):
        """"docker compose" is a command plus subcommand, not an executable."""
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)
        echo = workdir / "bin" / "fake-compose"
        echo.write_text('#!/usr/bin/env bash\nprintf "%s" "$*"\n')
        echo.chmod(0o755)

        result = run(
            workdir,
            "gridshot_pick_engine\ngridshot_compose up -d web",
            {"GRIDSHOT_COMPOSE": "fake-compose sub"},
        )

        assert result.stdout == "sub up -d web"


class TestUserDetection:
    def test_rootless_docker_runs_as_container_root(self, workdir):
        """Rootless engines map container UID 0 to the host user, so this is
        what makes written files belong to the person running it."""
        stub(workdir, "docker", stdout=ROOTLESS_DOCKER)
        assert user_after_setup(workdir) == "0:0"

    def test_rootful_docker_keeps_the_default(self, workdir):
        """UID 0 would be real root here, writing root-owned files into the
        repo — so leave it unset and let compose apply 1000:1000."""
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)
        assert user_after_setup(workdir) == ""

    def test_rootless_podman_runs_as_container_root(self, workdir):
        stub(workdir, "podman", stdout="true")
        assert user_after_setup(workdir) == "0:0"

    def test_rootful_podman_keeps_the_default(self, workdir):
        stub(workdir, "podman", stdout="false")
        assert user_after_setup(workdir) == ""

    def test_podman_docker_shim_falls_through_to_podman(self, workdir):
        """`docker` here is podman's shim: the compat query cannot render, so
        the answer has to come from podman itself."""
        stub(workdir, "docker", stdout=PODMAN_SHIM)
        stub(workdir, "podman", stdout="true")

        assert user_after_setup(workdir) == "0:0"

    def test_unreachable_daemon_warns_instead_of_guessing_quietly(
        self, workdir
    ):
        stub(workdir, "docker", stdout="", exit_code=1)

        result = run_setup(workdir)

        assert result.returncode == 0
        assert result.stdout == ""
        assert "could not reach" in result.stderr
        assert "GRIDSHOT_USER=0:0" in result.stderr

    def test_a_confident_answer_is_quiet(self, workdir):
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)

        assert run_setup(workdir).stderr == ""

    def test_explicit_environment_value_wins(self, workdir):
        stub(workdir, "docker", stdout=ROOTLESS_DOCKER)
        assert user_after_setup(workdir, {"GRIDSHOT_USER": "1234:5678"}) == "1234:5678"

    def test_a_value_in_dotenv_is_left_alone(self, workdir):
        """compose reads .env itself; exporting over it would silently
        override a deliberate choice."""
        stub(workdir, "docker", stdout=ROOTLESS_DOCKER)
        (workdir / ".env").write_text("GRIDSHOT_USER=4321:4321\n")

        assert user_after_setup(workdir) == ""

    def test_a_commented_dotenv_value_does_not_count(self, workdir):
        stub(workdir, "docker", stdout=ROOTLESS_DOCKER)
        (workdir / ".env").write_text("# GRIDSHOT_USER=4321:4321\n")

        assert user_after_setup(workdir) == "0:0"

    def test_an_unrelated_dotenv_does_not_block_detection(self, workdir):
        stub(workdir, "docker", stdout=ROOTLESS_DOCKER)
        (workdir / ".env").write_text("HF_TOKEN=abc\nGRIDSHOT_SAM=sam2\n")

        assert user_after_setup(workdir) == "0:0"


class TestMountDirs:
    def test_bind_mount_targets_are_created_as_the_host_user(self, workdir):
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)

        run_setup(workdir)

        assert (workdir / "config").is_dir()
        assert (workdir / "projects").is_dir()

    def test_existing_directories_are_left_alone(self, workdir):
        stub(workdir, "docker", stdout=ROOTFUL_DOCKER)
        (workdir / "projects").mkdir()
        keep = workdir / "projects" / "capture-1"
        keep.mkdir()

        run_setup(workdir)

        assert keep.is_dir()
