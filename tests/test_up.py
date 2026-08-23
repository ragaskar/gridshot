"""scripts/up — flag parsing, service selection, and bind-address defaults
for single-host vs. multi-host (--frontend / --segserver) deploys.

Driven as a real subprocess, like tests/test_lib_compose.py, but with
scripts/up and scripts/lib-compose.sh copied into a fake repo root so the
script's own `cd .. ` lands in the tmp workdir instead of the real repo.
GRIDSHOT_COMPOSE points at a stub that just logs its argv and environment,
so no real docker/podman/tailscale is ever invoked.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
BASH = shutil.which("bash")
assert BASH, "bash not found on PATH — needed to run these tests at all"

REAL_TOOLS = ("mkdir", "grep", "bash", "sed", "awk", "cut", "cat", "readlink", "dirname", "env")


@pytest.fixture
def workdir(tmp_path):
    (tmp_path / "scripts").mkdir()
    shutil.copy(REPO_ROOT / "scripts" / "up", tmp_path / "scripts" / "up")
    shutil.copy(
        REPO_ROOT / "scripts" / "lib-compose.sh", tmp_path / "scripts" / "lib-compose.sh"
    )
    (tmp_path / "scripts" / "up").chmod(0o755)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in REAL_TOOLS:
        real = shutil.which(tool)
        assert real, f"{tool} not found on PATH — needed to run these tests at all"
        (bin_dir / tool).symlink_to(real)

    compose_log = tmp_path / "compose.log"
    compose_stub = bin_dir / "compose-stub"
    compose_stub.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "ARGV: $*" >> "{compose_log}"\n'
        f'env | grep -E "^GRIDSHOT_(BIND_ADDR|SEGSERVER_BIND_ADDR)=" '
        f'>> "{compose_log}" || true\n'
    )
    compose_stub.chmod(0o755)

    tailscale_log = tmp_path / "tailscale.log"
    tailscale_stub = bin_dir / "tailscale"
    tailscale_stub.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "$*" >> "{tailscale_log}"\n'
        'if [ "$1 $2" = "serve status" ]; then echo "fake status line"; fi\n'
    )
    tailscale_stub.chmod(0o755)

    return tmp_path, compose_log, tailscale_log


def run_up(workdir, *args, env_extra=None):
    tmp_path, _, _ = workdir
    env = {
        "PATH": str(tmp_path / "bin"),
        "GRIDSHOT_COMPOSE": str(tmp_path / "bin" / "compose-stub"),
        "DISABLE_TOKEN_CHECK": "1",
    }
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [str(tmp_path / "scripts" / "up"), *args],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
    )


def compose_argv(workdir):
    _, compose_log, _ = workdir
    if not compose_log.exists():
        return None
    lines = compose_log.read_text().splitlines()
    argv_line = next(line for line in lines if line.startswith("ARGV: "))
    return argv_line[len("ARGV: ") :]


def compose_env(workdir):
    _, compose_log, _ = workdir
    if not compose_log.exists():
        return {}
    env = {}
    for line in compose_log.read_text().splitlines():
        if "=" in line and not line.startswith("ARGV:"):
            k, v = line.split("=", 1)
            env[k] = v
    return env


def test_default_builds_both_services(workdir):
    result = run_up(workdir)
    assert result.returncode == 0, result.stderr
    assert compose_argv(workdir) == "up -d --build segserver web"


def test_frontend_builds_only_web(workdir):
    result = run_up(
        workdir, "--frontend", env_extra={"GRIDSHOT_SEGSERVER_URL": "http://seg.lan:8801"}
    )
    assert result.returncode == 0, result.stderr
    assert compose_argv(workdir) == "up -d --build web"


def test_segserver_builds_only_segserver(workdir):
    result = run_up(workdir, "--segserver")
    assert result.returncode == 0, result.stderr
    assert compose_argv(workdir) == "up -d --build segserver"


def test_frontend_and_segserver_mutually_exclusive(workdir):
    result = run_up(workdir, "--frontend", "--segserver")
    assert result.returncode != 0
    assert compose_argv(workdir) is None


def test_tailscale_with_segserver_rejected(workdir):
    result = run_up(workdir, "--segserver", "--tailscale")
    assert result.returncode != 0
    assert compose_argv(workdir) is None


def test_frontend_requires_segserver_url(workdir):
    result = run_up(workdir, "--frontend")
    assert result.returncode != 0
    assert "GRIDSHOT_SEGSERVER_URL" in result.stderr
    assert compose_argv(workdir) is None


def test_default_requires_hf_token(workdir):
    result = run_up(workdir, env_extra={"DISABLE_TOKEN_CHECK": ""})
    assert result.returncode != 0
    assert "HF_TOKEN" in result.stderr
    assert compose_argv(workdir) is None


def test_frontend_skips_hf_token_check(workdir):
    result = run_up(
        workdir,
        "--frontend",
        env_extra={"DISABLE_TOKEN_CHECK": "", "GRIDSHOT_SEGSERVER_URL": "http://seg.lan:8801"},
    )
    assert result.returncode == 0, result.stderr


def test_tailscale_narrows_web_bind_addr(workdir):
    result = run_up(workdir, "--tailscale")
    assert result.returncode == 0, result.stderr
    env = compose_env(workdir)
    assert env.get("GRIDSHOT_BIND_ADDR") == "127.0.0.1"


def test_default_does_not_set_bind_addr(workdir):
    result = run_up(workdir)
    assert result.returncode == 0, result.stderr
    env = compose_env(workdir)
    assert "GRIDSHOT_BIND_ADDR" not in env
    assert "GRIDSHOT_SEGSERVER_BIND_ADDR" not in env


def test_segserver_widens_its_own_bind_addr(workdir):
    result = run_up(workdir, "--segserver")
    assert result.returncode == 0, result.stderr
    env = compose_env(workdir)
    assert env.get("GRIDSHOT_SEGSERVER_BIND_ADDR") == "0.0.0.0"


def test_tailscale_invokes_tailscale_cli(workdir):
    result = run_up(workdir, "--tailscale")
    assert result.returncode == 0, result.stderr
    _, _, tailscale_log = workdir
    assert tailscale_log.exists()
    assert "serve --bg 8800" in tailscale_log.read_text()


def test_default_does_not_invoke_tailscale(workdir):
    result = run_up(workdir)
    assert result.returncode == 0, result.stderr
    _, _, tailscale_log = workdir
    assert not tailscale_log.exists()
