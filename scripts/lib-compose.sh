# Shared compose setup, sourced by scripts/up and scripts/gridshot.
# Not executable on its own.

# Choose the compose provider, and remember which engine it drives.
#
# GRIDSHOT_COMPOSE overrides everything; otherwise prefer docker (including
# podman-docker's shim, which is the compatibility path this repo is usually
# driven through) and fall back to podman's own wrapper.
gridshot_pick_engine() {
    if [ -n "${GRIDSHOT_COMPOSE:-}" ]; then
        case "$GRIDSHOT_COMPOSE" in
            *podman*) GRIDSHOT_ENGINE=podman ;;
            *) GRIDSHOT_ENGINE=docker ;;
        esac
    elif command -v docker >/dev/null 2>&1; then
        GRIDSHOT_COMPOSE="docker compose"
        GRIDSHOT_ENGINE=docker
    elif command -v podman >/dev/null 2>&1; then
        GRIDSHOT_COMPOSE="podman compose"
        GRIDSHOT_ENGINE=podman
    else
        echo "gridshot: no docker or podman on PATH — set GRIDSHOT_COMPOSE to" \
             "your compose command" >&2
        return 1
    fi
    export GRIDSHOT_COMPOSE GRIDSHOT_ENGINE
}

# Run the chosen compose provider. Deliberately unquoted: the provider is a
# two-word command ("docker compose"), not one executable.
gridshot_compose() {
    # shellcheck disable=SC2086
    $GRIDSHOT_COMPOSE "$@"
}

# Create the writable bind-mount targets as the host user.
#
# Every runtime creates a missing bind-mount source itself, but it does so as
# the daemon's user — root under rootful Docker, and an unmapped subuid under
# rootless Podman. Either way the container user then cannot write there.
# Making them here, before compose runs, means they are simply ours.
gridshot_make_mount_dirs() {
    mkdir -p config projects
}

# Ask Podman directly. Authoritative when the binary is podman's own.
_gridshot_rootless_podman() {
    command -v podman >/dev/null 2>&1 || return 1
    local answer
    answer=$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null) || return 1
    case "$answer" in
        true) echo yes ;;
        false) echo no ;;
        *) return 1 ;;
    esac
}

# Ask over the Docker-compatible API. Answers for real Docker, and for Podman
# when it is being reached through its compat socket.
_gridshot_rootless_docker() {
    command -v docker >/dev/null 2>&1 || return 1
    local options
    options=$(docker info --format '{{range .SecurityOptions}}{{.}} {{end}}' 2>/dev/null) || return 1
    case "$options" in
        # podman-docker's shim forwards to podman's native schema, which has no
        # SecurityOptions — an empty or unrendered result means "ask elsewhere".
        ""|*"<no value>"*) return 1 ;;
        *rootless*) echo yes ;;
        *) echo no ;;
    esac
}

# "yes", "no", or empty when no engine could answer. Not knowing is a normal
# outcome, so this always succeeds — under `set -e` a non-zero return would
# kill the caller before it could report the ambiguity.
gridshot_rootless() {
    case "${GRIDSHOT_ENGINE:-}" in
        podman) _gridshot_rootless_podman || _gridshot_rootless_docker || true ;;
        *) _gridshot_rootless_docker || _gridshot_rootless_podman || true ;;
    esac
}

# Decide which UID:GID the containers should run as.
#
# Under a rootless engine (Podman, or rootless Docker) the container's UID 0 is
# mapped to the invoking host user, so running as root inside is what produces
# host files owned by you; running as 1000 lands on an unmapped subuid that you
# cannot read back. Under rootful Docker the mapping is identity, so UID 0
# would write real root-owned files into the repo and 1000:1000 is right.
#
# An explicit GRIDSHOT_USER always wins, whether it comes from the environment
# or from .env — compose reads .env itself, and exporting over it here would
# silently defeat a deliberate choice.
gridshot_detect_user() {
    if [ -n "${GRIDSHOT_USER:-}" ]; then
        return 0
    fi
    if [ -f .env ] && grep -qE '^[[:space:]]*GRIDSHOT_USER[[:space:]]*=' .env; then
        return 0
    fi

    local rootless
    rootless=$(gridshot_rootless)
    case "$rootless" in
        yes)
            export GRIDSHOT_USER=0:0
            ;;
        no)
            : # rootful Docker — compose's 1000:1000 default is correct
            ;;
        *)
            # Never silent: the default is a guess from here, and getting it
            # wrong surfaces much later as an unexplained permission error.
            echo "gridshot: could not reach the ${GRIDSHOT_ENGINE:-container}" \
                 "daemon to tell whether it is rootless; assuming rootful and" \
                 "using 1000:1000. On rootless Podman or rootless Docker, set" \
                 "GRIDSHOT_USER=0:0 (see .env.example)." >&2
            ;;
    esac
}

# Stamp the web image's build-info footer with the commit and time it was
# actually built from — an explicit signal that a rebuild happened (or
# didn't), instead of inferring it from cache behaviour. Recomputed on every
# call so a stale footer after "rebuild" means the rebuild genuinely didn't
# run, not that this script only checked once. Respects an already-exported
# GRIDSHOT_GIT_SHA/GRIDSHOT_BUILD_TIME (e.g. a CI pipeline pinning its own),
# same pattern as gridshot_detect_user's GRIDSHOT_USER.
gridshot_set_build_info() {
    if [ -z "${GRIDSHOT_GIT_SHA:-}" ]; then
        GRIDSHOT_GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
        if [ "$GRIDSHOT_GIT_SHA" != "unknown" ] \
            && { ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; }; then
            GRIDSHOT_GIT_SHA="${GRIDSHOT_GIT_SHA}-dirty"
        fi
    fi
    : "${GRIDSHOT_BUILD_TIME:=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)}"
    export GRIDSHOT_GIT_SHA GRIDSHOT_BUILD_TIME
}

gridshot_compose_setup() {
    gridshot_pick_engine
    gridshot_make_mount_dirs
    gridshot_detect_user
    gridshot_set_build_info
}
