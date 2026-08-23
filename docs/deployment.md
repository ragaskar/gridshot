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

By default `scripts/up` binds the web port to `0.0.0.0`, so other machines on your
LAN can reach it directly over plain HTTP — `scripts/up` prints a best-effort guess
at your LAN IP in the startup banner. There's no additional auth in front of this
beyond whatever your network already provides — treat it the same as any other
unauthenticated service on your LAN.

For an HTTPS URL reachable from your phone anywhere on your tailnet instead, pass
`--tailscale`. This narrows the web port back to `127.0.0.1` (Tailscale Serve reaches
it over loopback) and publishes it through Tailscale:

```bash
scripts/up --tailscale
```

Want neither — loopback only, no Tailscale? Set `GRIDSHOT_BIND_ADDR=127.0.0.1` in
`.env` yourself; `scripts/up` doesn't have a flag for this since it's the same as
`--tailscale` minus the `tailscale serve` call.

For `HF_TOKEN` and the Hugging Face access requirement `scripts/up` checks before
starting, see [step 1 of the usage walkthrough](usage/README.md#1-hugging-face-access--starting-the-app).

## Splitting web/cli and segserver across hosts

`web` and `cli` are plain CPU services — FastAPI, the SPA, and a thin HTTP client to
segserver — with no GPU or CUDA dependency of their own; every GPU/CDI requirement in
`compose.yaml` is scoped to the `segserver` service. That means `web`/`cli` can run
on any Docker or Podman host, while `segserver` stays wherever the GPU is, as long as
they can reach each other over the network.

On the segserver host:

```bash
scripts/up --segserver
```

This builds and starts only `segserver`, and publishes its port on `0.0.0.0:8801`
instead of the compose-internal-only default — `scripts/up`'s normal, colocated mode
binds it to `127.0.0.1` since nothing outside the compose network needs to reach it
there. There's no auth in front of segserver's HTTP API either, so treat this the
same as the LAN-bound web port: fine on a trusted home/office LAN, not something to
expose past it without adding your own network boundary (a VPN, a firewall rule
scoped to the web host's IP, etc).

On the web/cli host, point at that address before starting:

```bash
echo 'GRIDSHOT_SEGSERVER_URL=http://192.168.1.50:8801' >> .env
scripts/up --frontend
```

`--frontend` builds and starts only `web`, and fails fast at startup if
`GRIDSHOT_SEGSERVER_URL` isn't set — the same fail-fast approach `scripts/up` already
takes for a missing `HF_TOKEN`, so a wiring mistake shows up immediately instead of as
a later inference error. `scripts/gridshot` (the CLI wrapper) reads the same
`GRIDSHOT_SEGSERVER_URL`, via the `cli` service's environment in `compose.yaml`, so no
separate configuration is needed for it.

Moving an existing single-host deployment onto two hosts, or to a fresh host
entirely: all persistent state is in the bind-mounted `config/` and `projects/`
directories (calibration, printer profiles, the tool library, segserver's downloaded
model cache, and capture projects) — nothing else to extract from a running
container. Copy both directories to the new host(s) and it picks up where it left
off; copying `config/`'s model cache over to a new segserver host also avoids
re-downloading models on first run.

## GPU selection

`segserver` requests one GPU via CDI (`GRIDSHOT_GPU_DEVICE`, default
`nvidia.com/gpu=0`) — set it in `.env` if you have more than one GPU and want
GridShot to use a specific one. Inference itself is serialized with a small request
queue (`GRIDSHOT_INFERENCE_QUEUE_SIZE`, default 2); see the main README's
[Operations](../README.md#operations) section for the health/capability probes that
expose current queue usage.
