# Running the stack: Docker, rootless Podman, and remote access

This covers the container-runtime side of GridShot — which engine to run it under,
what actually differs between them, and how to reach it from somewhere other than
`localhost`. For everything else (getting a Hugging Face token, printing/verifying a
mat, taking your first tool photo), see the [usage walkthrough](usage/README.md).

## Docker vs. rootless Podman

`scripts/up` and `compose.yaml` work under either:

- **Docker with Compose** — the straightforward case, runs as whatever user the
  daemon runs as (root, unless you've set up rootless Docker separately).
- **Rootless Podman**, in Docker-compatibility mode (`podman-docker`, or `podman
  compose` directly) — the common setup on Fedora/SELinux workstations.

Two things specifically had to be handled for rootless Podman to work out of the box,
rather than failing with permission errors on first run:

### File ownership: `GRIDSHOT_USER`

Every service in `compose.yaml` runs as `${GRIDSHOT_USER:-1000:1000}`. Under
**rootless** Podman (or rootless Docker), container UID `0` maps back to the host
user who started it — so `0:0` is what makes files written inside the container
(traced tools, generated bins, cached models) come out owned by *you* on the host.
Under **rootful** Docker, UID `0` is real root, so the default has to stay `1000:1000`
there instead.

`scripts/lib-compose.sh` asks whichever engine is actually in use whether it's
rootless and sets `GRIDSHOT_USER` accordingly — you don't need to figure this out
yourself. It also falls through correctly when `docker` on your `PATH` is actually
`podman-docker`'s compatibility shim (which can't answer that question itself), and
creates `config/` and `projects/` before Compose does, so the bind-mount targets
belong to you rather than to whoever the daemon runs as.

If detection can't reach either engine's socket at all, it warns and assumes `0:0`
rather than silently guessing wrong and letting it surface later as a confusing
permission error. Set `GRIDSHOT_USER` explicitly yourself (environment or `.env`) to
override the detected value.

### SELinux bind-mount labels

On an SELinux-enforcing host (Fedora and friends), every bind mount in
`compose.yaml` carries the `:z` label. This tells the container runtime to relabel
the host path so the container's SELinux context is allowed to read/write it —
without it, every write from inside the container fails with a permission error even
though the Unix file permissions look fine.

It's `:z` (shared) rather than `:Z` (private) deliberately: all three services
(`web`, `segserver`, `cli`) are one application under one user, and `config/` really
is mounted by more than one of them. A private `:Z` label gets re-applied per
container on every run, so two services sharing the same path lock each other out.
`z`/`Z` are part of the Compose spec itself; the Docker daemon just ignores them off
SELinux, so this doesn't affect a plain Docker setup at all.

## Reaching GridShot from somewhere other than `localhost`

By default the web port only binds `127.0.0.1` — the assumption is you're either on
the same machine or using Tailscale Serve (the default behavior of `scripts/up`,
which sets up an HTTPS URL reachable from anywhere on your tailnet).

If you're on a home LAN without Tailscale, pass `--public-bind` to bind `0.0.0.0`
instead, so other machines on the network can reach it directly over plain HTTP:

```bash
scripts/up --public-bind
```

`scripts/up` prints a best-effort guess at your LAN IP in the startup banner when you
use this flag. There's no additional auth in front of a `--public-bind` server beyond
whatever your network already provides — treat it the same as any other unauthenticated
service on your LAN.

For `HF_TOKEN` and the Hugging Face access requirement `scripts/up` checks before
starting, see [step 1 of the usage walkthrough](usage/README.md#1-hugging-face-access--starting-the-app).

## GPU selection

`segserver` requests one GPU via CDI (`GRIDSHOT_GPU_DEVICE`, default
`nvidia.com/gpu=0`) — set it in `.env` if you have more than one GPU and want
GridShot to use a specific one. Inference itself is serialized with a small request
queue (`GRIDSHOT_INFERENCE_QUEUE_SIZE`, default 2); see the main README's
[Operations](../README.md#operations) section for the health/capability probes that
expose current queue usage.
