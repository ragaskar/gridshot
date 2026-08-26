<h1 align="center">GRID•SHOT</h1>

<p align="center"><strong>Calibrated phone photos → print-ready Gridfinity tool bins.</strong></p>

<p align="center">
  Local-first, GPU-accelerated capture for single tools, resumable batches, and a
  reusable tool library—without sending workshop photos to a hosted service.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#batch-processing-and-tool-library">Batch + library</a> ·
  <a href="#product-status">Product status</a> ·
  <a href="#operations">Operations</a> ·
  <a href="#changes-in-this-fork">Fork changes</a>
</p>

<p align="center">
  <img src="./assets/readme/gridshot-capture-flow.gif" width="720"
       alt="GridShot workflow showing two calibrated photos, RTX 5090 processing, outline review, and a generated Gridfinity tool bin">
</p>

<p align="center"><sub>Real GridShot capture: two photos → reviewed outline → generated 3D bin.</sub></p>

> [!IMPORTANT]
> GridShot is an accuracy-focused working prototype. Its software regression suite
> is extensive, but the full retained physical accuracy matrix is not complete yet.
> See [Product status](#product-status) for the current validation boundary.

## From photo evidence to printable geometry

<table>
  <tr>
    <td width="50%" align="center">
      <a href="./assets/readme/07-selection-editor.png">
        <img src="./assets/readme/07-selection-editor.png" width="100%" alt="GridShot photo-selection editor with calibration and readiness evidence">
      </a>
    </td>
    <td width="50%" align="center">
      <a href="./assets/readme/08-generated-bin.png">
        <img src="./assets/readme/08-generated-bin.png" width="100%" alt="GridShot result showing the corrected silhouette and generated 3D tool bin">
      </a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>Review the evidence.</strong><br>Inspect calibration, segmentation, cleanup, and the accepted physical outline before generation.</td>
    <td valign="top"><strong>Generate from one canonical outline.</strong><br>Preview the exact bin, adjust its geometry, and export 3MF, STL, SVG, or GLB.</td>
  </tr>
</table>

## Why GridShot is different

| Focus | What GridShot does |
| --- | --- |
| Calibrated measurement | Uses a verified ChArUco mat plus camera/lens profiles instead of treating a visually plausible trace as physical truth. |
| Height-aware correction | Separates silhouette-driving height, maximum tool height, and desired recess depth. A calibrated second photo can solve thickness automatically. |
| Local ownership | Runs the web app, segmentation models, projects, and tool library on your own machine. |
| Conservative automation | Calibration, segmentation, pairing, thickness, and generation can pass, request review, or block. Uncertain batch matches remain unmatched. |
| Reproducible geometry | Retains source photos, calibration, accepted outlines, settings, and printer compensation so a bin can be regenerated rather than retraced. |

## How it works

```text
phone photo(s) → calibrated silhouette → reviewed physical outline
                → canonical bin geometry → STL / 3MF / SVG / GLB
```

1. Print and verify the calibration mat.
2. Photograph one tool, or take a calibrated two-view pair to solve thickness.
3. Refine the segmentation in the shared photo editor.
4. Review or edit the reconstructed physical cutout.
5. Generate a bin immediately or save the tool for later composition.

The same accepted outline can produce three bin styles:

| Style | Result |
| --- | --- |
| **Pocket** | A conventional solid bin with a recessed tool cavity. |
| **Stackable corral** | A lighter bin with a thin tool shelf, full-height separator, standard feet, and stacking lip. |
| **Live grid** | The complete corral plus usable Gridfinity sockets wherever a full 42 mm socket safely fits. |

## Quick start

> New to GridShot? [docs/usage](docs/usage/README.md) is a full first-tool
> walkthrough — Hugging Face access, printing and verifying a mat, the empty-mat
> reference photo, camera calibration, and a ChArUco/camera-setup primer — written
> for someone who's never used the app before. See also
> [docs/deployment.md](docs/deployment.md) (Docker vs. rootless Podman, SELinux,
> LAN/remote access) and
> [docs/trace-tolerance-slice.md](docs/trace-tolerance-slice.md) (print-checking a
> pocket fit before committing to the full bin), and
> [docs/magnet-holes.md](docs/magnet-holes.md) (adding magnet holes to a bin's feet).

### Requirements

- Docker with Compose, or rootless Podman in Docker-compatibility mode
- NVIDIA Container Toolkit
- NVIDIA Ampere-generation or newer GPU with at least **8 GB VRAM**
- Tailscale CLI (optional) for the phone-friendly HTTPS endpoint used by `scripts/up`

The 8 GB minimum covers the core SAM 2.1 interactive capture workflow. **12 GB or
more is recommended** when using SAM 3 concept segmentation or RoMa dense matching,
because those optional models load on demand and remain resident alongside the
interactive model. The current container runs inference in BF16; CPU-only and
pre-Ampere GPUs are not supported configurations.

GridShot uses GPU 0 by default. On a multi-GPU host, choose a different NVIDIA CDI
device for the current launch:

```bash
GRIDSHOT_GPU_DEVICE=nvidia.com/gpu=1 scripts/up
```

#### Podman and other rootless engines

`scripts/up` and `scripts/gridshot` handle this for you — no setup needed. They
use `docker compose` when a `docker` binary exists (including podman-docker's
shim) and `podman compose` otherwise; `GRIDSHOT_COMPOSE` overrides the choice.

Bind mounts carry the `:z` SELinux shared label, which Docker ignores on hosts
without SELinux. The one thing that differs by engine is the container user:
rootless engines map container UID 0 to the host user, so `0:0` is what writes
files you own, while under rootful Docker it would mean real root. The scripts
ask the engine which it is and set `GRIDSHOT_USER` accordingly, warning rather
than guessing quietly when no daemon answers.

Driving compose directly instead? Set it yourself, in `.env` or the environment
(see `.env.example`):

```bash
GRIDSHOT_USER=0:0 podman compose up -d --build segserver web
```

### 1. Create and verify a calibration mat

Ready-to-print calibration mats are included for each supported paper size:

| Paper | Mat ID | Download |
| --- | --- | --- |
| A4 | `a4-7x9-5c8f11` | [PDF](calibration-mats/gridshot-mat-a4-7x9-5c8f11.pdf) |
| A3 | `a3-10x14-030735` | [PDF](calibration-mats/gridshot-mat-a3-10x14-030735.pdf) |
| US Letter | `letter-7x9-7dd4fa` | [PDF](calibration-mats/gridshot-mat-letter-7x9-7dd4fa.pdf) |

Register the selected board in your local GridShot configuration before verifying
it. This also generates the same board in the ignored `mats/` runtime directory:

```bash
scripts/gridshot mat new --paper a4
scripts/gridshot mat verify <mat-id> --measured-x <mm> --measured-y <mm>
```

Replace `a4` with `a3` or `letter` when using another bundled size.

Print the selected mat at **100% / Actual Size**. Measure the marked X and Y spans
with calipers and record both values. An unverified mat cannot be used for capture.

### 2. Start GridShot

```bash
scripts/up
```

This builds and starts both the web and segmentation services on this machine,
binding the web app to `http://localhost:8800` and, by default, to the LAN as well
(see [docs/deployment.md](docs/deployment.md) for remote access and multi-host
deploys). For the phone-friendly HTTPS endpoint instead:

```bash
scripts/up --tailscale
```

This publishes `https://<host>.<tailnet>.ts.net/` from a tailnet-connected phone, in
addition to `http://localhost:8800` on the workstation, and binds the web port to
`127.0.0.1` instead of the LAN.

### 3. Capture a tool

Take two photos from different camera positions for automatic thickness recovery,
or use one photo and enter the height at the tool's widest silhouette. The result
screen provides the corrected 1:1 outline, an orbitable 3D preview, and manufacturing
downloads.

## Batch processing and tool library

GridShot accepts a ZIP containing one or two photos per tool. Batch jobs are bounded,
cancellable, resumable, and checkpointed. Before anything enters the library, the
review screen shows proposed pairs, outlines, thickness results, warnings, and
readiness.

- Commit every reviewed tool, or explicitly commit only the ready subset.
- Keep unresolved tools as a draft for correction or recapture.
- Leave ambiguous image pairs unmatched instead of guessing.
- Retry safely without creating duplicate library entries.

Accepted tools become reusable local library records. Each record keeps the original
photo silhouette, corrected physical footprint, vertical measurements, calibration,
printer profile, settings, warnings, and non-destructive outline revisions.

From the library you can regenerate one tool, combine several tools into one bin, or
compose bins across a drawer. Cards, previews, and exports all use the same canonical
derivation path. Each card also has **"Re-open as current"**, which brings that
tool's full capture/calibration details and downloads back as the app's current
tool — useful after scanning something else has moved on from it, since the
current-tool view only ever holds one tool at a time.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="./assets/readme/10-batch-review-overlays.png">
        <img src="./assets/readme/10-batch-review-overlays.png" width="100%" alt="GridShot batch review with mask overlays, paired tools, and unmatched photos">
      </a>
    </td>
    <td width="50%" align="center">
      <a href="./assets/readme/14-drawer-preview.png">
        <img src="./assets/readme/14-drawer-preview.png" width="100%" alt="GridShot tool library with three selected tools and an exact 3D drawer preview">
      </a>
    </td>
  </tr>
  <tr>
    <td valign="top"><strong>Batch without guessing.</strong><br>Review mask overlays, proposed pairs, unmatched photos, thickness, and readiness before committing tools.</td>
    <td valign="top"><strong>Reuse accepted tools.</strong><br>Regenerate a bin, combine several tools, or compose separate bins across an exact drawer grid.</td>
  </tr>
</table>

## Printer compensation

GridShot can fit cavity compensation for a specific printer, material, nozzle, and
process. Print three independent copies of the long-baseline coupon, then repeat each
measurement option once per copy:

```bash
scripts/gridshot bench coupon --copies 3
scripts/gridshot bench record \
  --printer X1C --material PLA --nozzle-mm 0.4 --process standard \
  --a-x 124.3 --a-x 124.4 --a-x 124.3 \
  --a-y 24.7 --a-y 24.8 --a-y 24.7 \
  --b-x 24.7 --b-x 24.8 --b-x 24.7 \
  --b-y 7.7 --b-y 7.8 --b-y 7.7
scripts/gridshot bench printer-profiles
```

Profiles are immutable revisions. Measurements with borderline uncertainty are kept
for diagnosis but cannot become active; severe disagreement is rejected.

## Operations

GridShot stores capture sessions and generated artifacts in `projects/`. Calibration,
printer profiles, the tool library, and downloaded model caches live in `config/`.
Both directories are created automatically by `scripts/up`; back them up before
moving or upgrading a deployment.

Copy `.env.example` to `.env` for persistent GPU, model, queue, or Hugging Face token
settings. Use `scripts/prune --dry-run` to preview cleanup of old capture projects.

| Service | Port | GPU | Role |
| --- | ---: | --- | --- |
| `web` | `8800` | No | FastAPI, the React SPA, and the public API boundary |
| `segserver` | `8801` | Yes | SAM 2.1 interactive segmentation, SAM 3 concept segmentation, and dense matching |

Runtime probes are exposed through the web service:

| Probe | Meaning |
| --- | --- |
| `/api/health/live` | The web process is alive; performs no dependency work. |
| `/api/health/ready` | Storage and interactive segmentation are ready for capture traffic. |
| `/api/health/capabilities` | Detailed model state, verified mats, and inference-queue usage. |

GPU inference is serialized with two waiting slots by default. Set
`GRIDSHOT_INFERENCE_QUEUE_SIZE` to change the queue capacity. Saturated requests fail
quickly with HTTP `429` and `Retry-After` instead of building an unbounded backlog.

## Product status

Implemented today:

- Verified mat and immutable camera-profile calibration
- Interactive segmentation and non-destructive correction editors
- One-photo and calibrated two-photo capture
- Pocket, stackable-corral, and live-grid geometry
- Resumable batch review and fail-closed library commits
- Persistent tool library, multi-tool composition, and drawer export
- Versioned printer compensation and reproducible artifact provenance

Still gated on real evidence:

- The retained physical G1 accuracy matrix
- Production matcher thresholds selected and validated on a representative GridShot capture corpus
- Published first-print-fit and recapture-rate claims

## Changes in this fork

Features added on top of the original public release, newest last:

- Rootless Podman/SELinux support for the compose stack, alongside Docker
  (see [docs/deployment.md](docs/deployment.md))
- Batch calibration signature triage: reports every photo's mismatch in one pass
  instead of aborting at the first one that disagrees
- `scripts/up` binds the web UI to the LAN by default, with `--tailscale` to
  narrow it back to loopback behind Tailscale Serve instead
- `scripts/up` fails fast when `HF_TOKEN` is missing, instead of surfacing the
  failure later as an inference-time error
- Unhandled server errors return their real error text instead of a bare
  "Internal Server Error"
- Web UI for storing the empty-mat reference photo (previously CLI-only and
  undocumented)
- First-tool walkthrough doc for new users
- Downloadable 1mm trace-tolerance slice (STL/3MF) for single-tool bins,
  multi-tool combined bins, and drawer exports — print a small coupon through
  a tool's cutout to check fit before committing to the full bin (see
  [docs/trace-tolerance-slice.md](docs/trace-tolerance-slice.md))
- "Re-open as current" button on each library card, to bring a previously
  saved tool's full details and downloads back as the app's current tool
- Optional magnet holes (on/off, diameter, depth) at each foot corner,
  configurable wherever a bin is generated — single-tool, library, combine,
  and CLI (see [docs/magnet-holes.md](docs/magnet-holes.md))
- Per-tool clearance override in the multi-tool combine editor, independent
  of each tool's library-wide clearance (see
  [docs/combine-tool-overrides.md](docs/combine-tool-overrides.md))
- Fine control over finger-hole placement in the multi-tool combine editor —
  switch which side it's on, and slide its position along that side (see
  [docs/combine-finger-hole-position.md](docs/combine-finger-hole-position.md))
- Keyboard nudge for precise manual placement in the multi-tool combine
  editor — arrow keys move the selected tool by a configurable step,
  Shift+arrow for 10× (see
  [docs/combine-editor-nudge.md](docs/combine-editor-nudge.md))
- Adjustable trace-tolerance slice thickness (0.5mm up to the shallowest
  selected tool's own recess depth, default 1mm) when exporting a multi-tool
  combine bin's slice, via a dialog before export — an out-of-range value is
  flagged and blocks only that dialog's own Export button, as soon as you
  type it (see [docs/trace-tolerance-slice.md](docs/trace-tolerance-slice.md))
- Per-tool rotation lock for auto-pack in the multi-tool combine editor —
  keep a tool at its current angle while the rest re-pack around it (see
  [docs/combine-editor-rotation-lock.md](docs/combine-editor-rotation-lock.md))
- Force an exact bin footprint (gx×gy) for a multi-tool combine bin —
  auto-pack fits within it or reports a clear error and disables export
  (see [docs/combine-force-bin-size.md](docs/combine-force-bin-size.md))
- "⧉ Clone" button on each library card, to duplicate a tool under a new id
  so two of the same tool can go in one combine/compose bin (see
  [docs/library-clone-tool.md](docs/library-clone-tool.md))
- Multi-select (shift-click) in the multi-tool combine editor's 2D arrange view,
  with group drag/nudge — the foundation for align/distribute and bulk per-tool
  overrides (see
  [docs/combine-editor-multi-select.md](docs/combine-editor-multi-select.md))
- Align selected tools (left/center/right, top/middle/bottom) in the multi-tool
  combine editor (see [docs/combine-editor-align.md](docs/combine-editor-align.md))
- Bulk clearance and finger-access editing across a multi-tool-combine-editor
  selection (see [docs/combine-tool-overrides.md](docs/combine-tool-overrides.md))
- Bulk "Switch sides" and finger-hole position editing across a
  multi-tool-combine-editor selection (see
  [docs/combine-finger-hole-position.md](docs/combine-finger-hole-position.md))
- Per-tool (and multi-select) pocket-depth override in the multi-tool
  combine editor, at 0.01mm resolution (see
  [docs/combine-pocket-depth-override.md](docs/combine-pocket-depth-override.md))
- Distribute 3+ selected tools evenly (horizontally/vertically) in the
  multi-tool combine editor (see
  [docs/combine-editor-distribute.md](docs/combine-editor-distribute.md))
- Numeric field for finger-hole position, alongside the slider — 1mm
  step, but typeable to 0.01mm resolution (see
  [docs/combine-finger-hole-position.md](docs/combine-finger-hole-position.md))
- Bin Library: save a multi-tool combine-editor arrangement as a named,
  renameable entry — reopen it for further arranging, or export bin/slice
  directly, without redoing the layout (see [docs/bin-library.md](docs/bin-library.md))
- Deep-link URLs: every page, and the multi-tool combine editor, has a URL
  that reopens the same content on reload — including browser back/forward
  (see [docs/deep-link-urls.md](docs/deep-link-urls.md))
- Align finger holes: snap 2+ selected tools' finger-access holes onto one
  line in the multi-tool combine editor, the same way the existing
  bounding-box align buttons snap edges (see
  [docs/combine-editor-align-finger-holes.md](docs/combine-editor-align-finger-holes.md))
- Custom bin shape: cut individual gridfinity units out of a forced-size
  pocket-style bin (L-shapes, notches, rings), with rounded outer/notch
  corners and drag-over-a-removed-cell prevention (see
  [docs/combine-custom-bin-shape.md](docs/combine-custom-bin-shape.md))
- Tool Library: a compact List view alongside the original Tile view, plus
  select-all and shift-click range selection in both (see
  [docs/library-list-view.md](docs/library-list-view.md))
- Deep-link URLs now use path segments (`/library`, `/editor/<id>`) instead of query
  params, so they survive a full reload in every browser; the FastAPI static mount
  gained a proper SPA fallback route to match (see
  [docs/deep-link-urls.md](docs/deep-link-urls.md))
- Exported bin/slice files are named after the saved Bin Library entry, or the selected
  tools when not saved, instead of a generic `multitool-bin.3mf` (see
  [docs/bin-library.md](docs/bin-library.md))
- Undo/redo in the multi-tool combine editor — Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, plus
  toolbar buttons, with drags and nudge/rotate bursts collapsing to one undo step (see
  [docs/combine-editor-undo-redo.md](docs/combine-editor-undo-redo.md))
- Bin Profiles: named, reusable bin-style presets (lip, base geometry mode, magnet-hole
  defaults, allow-custom-shape, and advanced structural constants), managed on their own
  page with a live 3D preview, and selectable everywhere a bin style is picked — the
  combine editor, single-tool capture, the result page's regenerate flow, and a tool's
  per-tool default — replacing the old hardcoded Pocket/Corral/Live Grid buttons (see
  [docs/bin-profiles.md](docs/bin-profiles.md))
- Bin Profile editor: every field now sits in a visible section (Stacking Lip, Magnet
  Holes, Wall & Floor Thickness) instead of behind a collapsed "Advanced" accordion, and
  the previously-unwired `corral_edge_margin_mm` structural override is now editable
  (see [docs/bin-profiles.md](docs/bin-profiles.md))
- The multi-tool combine editor auto-applies the first Bin Profile when opening a fresh
  combine, and remembers which profile was applied on a saved bin so reopening it shows
  the same picker selection (see [docs/bin-profiles.md](docs/bin-profiles.md))
- "💾 Save" in the multi-tool combine editor now overwrites a reopened (or
  already-saved-this-session) Bin Library entry in place; "Save As…" keeps the old
  always-create-a-new-entry behavior (see [docs/bin-library.md](docs/bin-library.md))
- Saving a Bin Library entry now forks each tool into a private "bin tool" copy, frozen
  to its state at save time — editing or deleting the original Tool Library entry
  afterward no longer affects a bin already saved with it (see
  [docs/bin-library.md](docs/bin-library.md))
- "⧉ Duplicate" in the multi-tool combine editor — a second, independently-editable
  copy of the selected tool within the same bin, without touching the Tool Library;
  replaces the old workflow of cloning a whole library entry just to select it twice
  (see [docs/bin-library.md](docs/bin-library.md))
- Replaced the hardcoded Pocket/Corral/Live-Grid bin styles with two orthogonal
  parameters — `fill_height_pct` (0–100%) and `live_grid` — so a Bin Profile is no
  longer limited to three fixed presets; the Bin Profile editor now exposes a fill
  height slider and live grid checkbox instead of a 3-way style picker (see
  [docs/bin-profiles.md](docs/bin-profiles.md) and
  [docs/bin-profiles-v2-proposal.md](docs/bin-profiles-v2-proposal.md) for the design)
- Intermediate `fill_height_pct` values (between the old Pocket/Corral extremes) now
  build real geometry — a general floor fill that rises solid from the deck to a
  height scaled by the given percentage, everywhere outside each tool's own wall and
  any `live_grid` socket cell — instead of just falling back to `0`'s geometry (see
  [docs/bin-profiles.md](docs/bin-profiles.md))
- Mirror horizontal/mirror vertical toggle for a single selected tool in the multi-tool
  combine editor — a genuinely different transform from rotation, since a mirror can't
  be expressed as any rotation angle (see
  [docs/combine-editor-mirror.md](docs/combine-editor-mirror.md))
- Finger-hole position is now free-form: click a hole in Arrange 2D to select it, then
  drag it anywhere on the tool's own outline or nudge it with the arrow keys (Up/Down
  jump it across to the opposite side) — replacing the old "Switch sides" toggle and
  offset slider/number field (see
  [docs/combine-finger-hole-position.md](docs/combine-finger-hole-position.md))
- Per-tool finger-hole diameter override in the multi-tool combine editor — select a
  hole to resize it (0.1mm precision by typing, 1mm arrow-key steps), growing or
  shrinking around its current position on the outline (see
  [docs/combine-finger-hole-position.md](docs/combine-finger-hole-position.md))
- Finger-hole "span" — turn a hole into a two-lobe pill straddling both sides of the
  tool, with each focal point independently draggable/nudgeable and a click-to-switch
  slop radius between them (see
  [docs/combine-finger-hole-span.md](docs/combine-finger-hole-span.md))
- Align finger holes now understands span holes in a mixed selection — a span
  reference aligns every other span hole's second point too, on its own line (see
  [docs/combine-editor-align-finger-holes.md](docs/combine-editor-align-finger-holes.md))
- Copy finger-hole style: push one selected tool's hole type (off/single/span) and
  diameter onto the rest of a multi-tool selection, without moving any existing point
  (see [docs/combine-editor-copy-finger-hole-style.md](docs/combine-editor-copy-finger-hole-style.md))
- `scripts/up --frontend` / `--segserver` to run the web/cli services and the GPU
  segmentation service on separate hosts, instead of always colocated (see
  [docs/deployment.md](docs/deployment.md))
- The multi-tool combine editor now mints its own Bin Library entry immediately when
  a fresh session opens (forking every tool right away) and autosaves every change
  from then on, superseding the explicit "💾 Save"/"💾 Save to Bin Library" buttons;
  "Save As…" (fork an independent copy under a new name) is the only manual action
  left (see [docs/bin-library.md](docs/bin-library.md))
- Distance-to-next-tool annotation while nudging a single selected tool in the
  multi-tool combine editor — a line and 0.01mm gap label from its outline, in
  both the nudge direction and its opposite, to the next tool (or the grid's
  own edge, if nothing's closer) it would hit; bolded when both sides come out
  equal (see [docs/combine-editor-nudge.md](docs/combine-editor-nudge.md))
- Finger holes are now multi-selectable directly (shift-click, same gesture as tools) in
  the multi-tool combine editor; Align finger holes now requires selecting 2+ holes this
  way instead of 2+ tools, and Left/Right nudge (+ Shift ×10) works across that
  selection — Copy style stays gated on tool selection, since it's the one action that
  still needs to target a tool with no hole yet (see
  [docs/combine-editor-align-finger-holes.md](docs/combine-editor-align-finger-holes.md))
- The multi-tool combine editor's per-tool color palette no longer includes a
  red close enough to the boundary-overflow warning color to be confused with
  it, and the 3D-preview overlay's overflow message is now derived directly
  from the current arrangement instead of a separately-latched error state,
  so it can't outlive the condition that produced it

## License

GridShot is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md)
for personal and other noncommercial use. Commercial use, commercial services, and
commercial products require a separate written license from the copyright holder.
