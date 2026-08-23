# Using GridShot: a first-tool walkthrough

This is a practical, start-to-finish guide for someone who has never used GridShot
before. It assumes you know roughly what Gridfinity bins are and nothing else — not
what a ChArUco board is, not what "calibrated" means here, and not which of the three
setup steps has to happen before which other one.

For the marketing-level overview, screenshots, and batch/library features, see the
[main README](../../README.md). This doc is the sequence to actually follow the first
time.

## The four things you have to do, in order

1. **Get Hugging Face access and start the app.** GridShot downloads a segmentation
   model on first use, and one of the models it can fall back to is gated — you need
   an approved token before `scripts/up` will do anything useful.
2. **Create and print a calibration mat, then verify it.** This is the physical
   object every measurement is anchored to. Nothing else works without a verified mat.
3. **Take a photo of the empty mat (and, ideally, calibrate your camera).** These are
   two separate, optional-but-you-really-want-them steps that make tool detection and
   measurement accurate. Skipping them still works, just worse.
4. **Photograph a tool and generate a bin.**

Steps 1–3 are one-time setup per mat/camera. Step 4 is what you'll repeat for every
tool afterward.

---

## 1. Hugging Face access + starting the app

### Why you need a token at all

GridShot's segmentation service (`segserver`) downloads model weights from Hugging
Face the first time it needs them, into a local cache (`config/cache/hf`) so it only
happens once. `scripts/up` now refuses to start without `HF_TOKEN` set, specifically
because of what happens without one:

- The default interactive model, **SAM 2.1**, is open-weight — no approval needed.
- But the very first tool you trace, before you've done step 3 below, has no
  empty-mat reference photo to diff against. In that situation GridShot automatically
  falls back to **SAM 3's "concept detection"** (find-the-tool-by-description) to
  locate the tool. That fallback path always uses `facebook/sam3`, regardless of
  which interactive model you've configured — and `facebook/sam3` is a **gated**
  model on Hugging Face. Meta requires a manual access request before you can
  download it.

In other words: even a brand-new setup using every default touches a gated model on
its very first trace, unless you set up the empty-mat reference first (step 3 largely
avoids needing SAM 3 at all, but the fallback path still exists and segserver still
needs permission to load it if it's ever hit).

### Getting a token

1. Create a Hugging Face account if you don't have one: <https://huggingface.co>.
2. Go to <https://huggingface.co/facebook/sam3> and request access. Meta reviews
   these manually — approval isn't always instant, so do this before you plan to
   use the app, not the day of.
3. Once approved, create a **read** token at
   <https://huggingface.co/settings/tokens>.
4. Copy `.env.example` to `.env` and set:

   ```bash
   HF_TOKEN=hf_your_token_here
   ```

If you're confident you'll never need SAM 3 (for example, you always store an
empty-mat reference before your first trace on a mat) and just want to skip the
startup check, `scripts/up` also accepts a bypass:

```bash
DISABLE_TOKEN_CHECK=1 scripts/up
```

This does not download anything for you — it only skips the pre-flight check. If a
request genuinely needs a model you haven't got access to, segserver will still fail
that specific request with a real error message (see [Troubleshooting](#troubleshooting)).

### Starting GridShot

```bash
scripts/up
```

or, for an HTTPS URL reachable from your phone anywhere on your tailnet:

```bash
scripts/up --tailscale
```

The first `scripts/up` builds containers and, on segserver's first real request,
downloads model weights — this can take a while depending on your connection. Once
running:

- `http://localhost:8800` on the machine running it
- reachable from other machines on your LAN by default; add `--tailscale` instead
  for the HTTPS tailnet URL (see [docs/deployment.md](../deployment.md) for both, and
  for splitting the web app and segserver across hosts)

Check `http://localhost:8800/api/health/capabilities` (or watch the "Segserver"
status badge on the app's own capture page) to confirm the segmentation service is
actually up before you start capturing.

---

## 2. Create and verify a calibration mat

The mat is a printed [ChArUco board](#what-is-a-charuco-board-and-why-does-it-matter)
— every photo you take of a tool also has to see this mat, because it's how GridShot
converts pixels into real millimeters.

### Generate it

Ready-made PDFs for A4, A3, and US Letter already exist in `calibration-mats/` (see
the main README's table) — you can print one of those directly. To generate one
yourself instead:

```bash
scripts/gridshot mat new --paper a4
```

This prints a mat ID (e.g. `a4-7x9-5c8f11`) and writes a PDF to `mats/`. Use `--paper
a3` or `--paper letter` for the other sizes.

### Print it correctly

- Print at **100% / Actual Size**. Explicitly turn off "fit to page," "shrink to fit,"
  or similar — printer drivers default to this and it silently rescales the whole
  board, which is exactly what the next step catches.
- **Matte paper**, not glossy or laminated. A glossy surface creates specular
  highlights under normal room lighting that hide the corner pattern from detection.
- The PDF includes two black caliper bars (X and Y) with their expected length
  printed next to them — that's what you measure next.

### Mount it flat and rigid

The whole calibration model assumes the mat is a perfectly flat plane. Tape all four
corners down to a rigid, flat surface (a clipboard, foam board, or a table with the
paper taped flat all around works). Any curl, especially near the edges, will bend
the corner grid there and quietly degrade the geometry for tools placed near that
edge.

### Measure and verify

Caliper both black bars precisely and record them:

```bash
scripts/gridshot mat verify <mat-id> --measured-x <mm> --measured-y <mm>
```

An unverified mat cannot be used for anything else — capture, calibration, or a
reference photo will all refuse until this step succeeds. The check:

- Accepts up to **±2%** deviation from the expected length per axis. Beyond that, the
  printer almost certainly rescaled the page ("fit to printable area" hiding behind a
  100% label); reprint rather than fight it. `--force` exists to accept a bad print
  anyway, but the warning that triggers it explicitly recommends against that — a
  driver that rescales once may do it differently the *next* print.
- Also checks the two axes don't disagree with each other by more than **0.3%** —
  non-uniform (anisotropic) scaling, which "fit to page" often produces.

Optional sanity check, before or after verifying: point `mat verify` at an actual
phone photo of the printed mat and it'll report corner count, reprojection error, and
camera tilt without needing the mat verified yet:

```bash
scripts/gridshot mat verify <mat-id> --photo /path/to/test-photo.jpg
```

---

## 3. Empty-mat reference photo + camera calibration

These are two independent steps, both optional, both strongly recommended, and
people mix them up constantly (understandably — the web UI's "Calibration" page is
about the *camera*, not the mat). Here's the difference and the order:

| Step | What it does | Requires | Web UI |
| --- | --- | --- | --- |
| **Camera calibration** | Measures your phone's lens distortion once per camera/lens/zoom/orientation combo | A **verified** mat; 8–20 photos of it from varied angles | "Calibration" page |
| **Empty-mat reference** | Stores one photo of the bare mat, so tool photos can be diffed against it to find the tool | A **verified** mat (camera calibration is *not* required, though recommended) | "Mat Reference" page |

Neither depends on the other, but **mat verify has to happen before either.** If you
want a suggested order: calibrate the camera first (it makes the reference photo
itself slightly more accurate), then store the reference. In practice doing the
reference first won't break anything.

### Why the reference photo matters

Without one, GridShot has no idea what "empty" looks like, so trace falls back to
segmenting the tool by asking a general-purpose model "where's the tool-shaped
thing" — which, on top of a busy checkerboard pattern, sometimes grabs a chunk of the
mat along with the tool. The fix is a literal diff: rectify the empty-mat photo and
the tool photo into the same coordinate frame, subtract them, and only the pixels
that actually changed become segmentation prompts. The checkerboard pattern is
identical in both photos, so it disappears from the diff regardless of how much of it
is in frame.

**Go to the "Mat Reference" page**, pick your verified mat, and upload one photo of
the mat with absolutely nothing on it — no tools, no hands, no shadows falling across
it that won't also be there for real captures.

Two things that surprise people:

- **Framing doesn't need to match your later tool photos.** Every photo — reference
  or trace — gets its own independent corner detection and gets rectified into the
  same real-world millimeter space before diffing. A closer or more angled reference
  shot is fine as long as the whole board is visible and sharp.
- **Lighting does need to roughly match.** The diff is a literal per-pixel
  brightness/color comparison (with a tolerance threshold). A reference shot in
  bright daylight compared against a trace shot under a warm lamp can leave shadow or
  tint differences that register as false "changes" even with nothing actually
  different on the mat. Shoot the reference in the lighting you'll actually use.

You can re-upload a reference for the same mat at any time — it just replaces the old
one (e.g. if you move the tape, change your light, or move the whole station).

### Why camera calibration matters

Phone lenses distort — straight lines near the frame edges bow slightly, especially
on ultra-wide "main" cameras. GridShot can operate without a device profile (it falls
back to an EXIF-derived focal-length guess), but a real calibration measurably
improves the parallax/thickness correction, especially for anything but very thin,
very flat tools.

On the **Calibration** page: pick your verified mat, shoot **8–20 photos** of it (8 is
the hard minimum, 12+ recommended), and upload them together. Two rules that matter
a lot here, opposite of what you might assume:

- **Lock the capture setup** — same physical camera, lens, orientation, resolution,
  and zoom for every one of the 8–20 photos. GridShot fingerprints each photo's EXIF
  capture signature and will tell you which ones don't match the majority before you
  calibrate; a mismatched photo (different zoom, cropped, edited) gets excluded
  rather than silently corrupting the fit.
- **Vary everything else aggressively** — distance, angle, and position across the
  set. Camera calibration mathematically separates lens distortion from viewing
  pose, and it can only do that if it sees the board from meaningfully different
  poses. Twelve photos of the mat dead-center from directly above are much worse
  than eight photos from varied angles and distances.

Profiles are immutable — recalibrating the same physical setup creates a new
revision rather than overwriting, and tools you already traced keep the revision they
were captured with.

---

## What is a ChArUco board, and why does it matter?

A ChArUco board is a checkerboard pattern with small ArUco (binary square) markers
embedded in it. The combination is what GridShot's calibration is built on, and
knowing roughly how it works explains most of the "why" behind the tips above:

- Each ArUco marker has a unique, unambiguous ID, so the software can identify
  *which* square of the board it's looking at even from a steep angle or with most of
  the board hidden — which matters because your tool will be sitting in the middle
  of it, occluding a chunk of the pattern.
- Checkerboard corners (where four squares meet) can be located to sub-pixel
  precision, which is what actually gives the accurate pixel↔millimeter mapping
  (technically a homography from image pixels to the flat mat plane). More visible
  corners means a more accurate, more robust fit.
- GridShot needs at least 20 detected corners to trust a calibration at all, and
  warns above 1.5 px of reprojection error (a hard stop exists later at 3.0 px,
  used when deciding whether a tool is even ready to generate). Camera tilt beyond
  15° also triggers a warning to hold the phone flatter — extreme oblique angles
  foreshorten the pattern and hurt corner accuracy.

### Setting up a capture station

- **Overhead, not handheld-angled.** A phone arm, small tripod, or even a shelf
  above the mat gives you a repeatable, close-to-perpendicular shot for actual tool
  captures. (Camera *calibration* photos are the deliberate exception — vary those.)
- **Even, diffuse lighting; no glare, no hard shadows.** A single point light source
  or direct sun creates a bright hotspot in the reflection and dark falloff at the
  edges — both hurt corner detection and, worse, can register as "changes" against
  your empty-mat reference. A softbox, ring light, or just diffuse daylight from a
  window works well; avoid single bare bulbs pointed straight down.
- **Matte print, flat and rigid**, as covered above.
- **Turn off computational-photography extras.** HDR fusion, "portrait" / depth
  modes, and multi-frame night modes can locally warp geometry near edges or object
  boundaries in ways a simple lens model doesn't expect. Plain photo mode is what
  this pipeline is built and tested against.
- **Lock digital zoom at 1×, and never change it mid-batch.** GridShot matches
  photos to a device profile using an exact capture signature — camera, lens,
  resolution, orientation, and zoom ratio. A photo shot at a different zoom than your
  calibration set won't match, and falls back to a less accurate estimate. Don't
  crop or edit photos either, for the same reason.
- **Avoid motion blur.** Brace the phone with both hands (or better, an actual
  mount) — a blurred edge undermines the sub-pixel corner accuracy the whole system
  depends on.
- **Keep the whole board in frame.** You need enough visible corners (20+) —
  filling the frame with the board is good, but not at the cost of cropping off an
  edge.

---

## 4. Photograph a tool and generate a bin

This is the step you repeat for every tool, once setup is done.

On the **Capture** page:

1. **Angle 1** (required): a photo of the tool sitting on the calibrated mat.
2. **Angle 2** (optional but recommended): the same tool from a different position.
   Two photos let GridShot solve the tool's thickness automatically ("Auto
   thickness" badge appears once both are picked); with only one photo, you enter a
   height manually.
3. If you're on one photo, **"Widest-outline height"** is the number that matters —
   it's the tool's thickness *at the part that forms most of its outline*, not its
   overall height. The in-app tooltip breaks this down by tool shape (flat tools:
   full thickness; stepped tools like calipers: the long beam, not the tall display;
   rounded tools like a tape measure: roughly half the total height). If you can't
   estimate it confidently, that's exactly what the second photo is for.
4. Pick a bin style (**Pocket**, **Stackable corral**, or **Live grid**) and adjust
   clearance/depth/height if the defaults don't fit your case — see the main
   README's [How it works](../../README.md#how-it-works) table for what each style
   produces. Optional magnet holes (diameter/depth) are available here too — see
   [docs/magnet-holes.md](../magnet-holes.md).
5. Submit, then review/correct the segmentation in the editor before generating —
   the point of GridShot's whole pipeline is that you see and can fix the evidence
   rather than trust a black box.

Before committing to a full print, download the small trace-tolerance slice next to
the bin's STL/3MF and print just that — it's a 1mm coupon through the tool's cutout
that shows you the actual fit in minutes instead of the full bin's print time. See
[docs/trace-tolerance-slice.md](../trace-tolerance-slice.md).

**One easy-to-miss gotcha:** the basic Capture page doesn't have a mat picker. It
requires exactly one verified mat to exist; if you've verified more than one, it'll
error asking you to specify which. Keep a single verified mat around for the simple
web flow, or use the CLI instead, which takes a mat id explicitly:

```bash
scripts/gridshot trace photo1.jpg photo2.jpg --mat <mat-id> --style pocket
```

---

## Troubleshooting

- **"Internal Server Error" with no detail** — shouldn't happen anymore; GridShot's
  error responses now include the real exception text. If you still see a bare
  message, check the container logs (`podman logs gridshot-web-1` or the Docker
  equivalent) for the full traceback.
- **Trace outline includes a chunk of the mat** — you're almost certainly missing an
  empty-mat reference photo (or it needs to be retaken under your current lighting).
  See [step 3](#why-the-reference-photo-matters).
- **`no empty-mat reference for '<mat-id>' — using concept detection`** warning on a
  successful trace — informational, not fatal; same fix as above if you don't like
  the result.
- **`mat '<mat-id>' has no measured print scale`** — you skipped or failed
  `mat verify`. Go back to [step 2](#measure-and-verify).
- **`N verified mats — specify one`** — you have more than one verified mat and used
  a flow (like the basic Capture page) that doesn't let you choose. Either
  unverify/remove the extras or use a flow that accepts an explicit mat ID.
- **High reprojection RMS / "camera tilt > 15°" warnings** — reshoot flatter, more
  overhead, better lit, and braced against motion blur.
- **Tool is too tight or too loose in the printed pocket** — print the small
  [trace-tolerance slice](../trace-tolerance-slice.md) instead of the whole bin while
  you dial this in. If it's consistently off in the same direction, that's usually
  printer shrink, not a bad trace — see
  [Printer compensation](../../README.md#printer-compensation) in the main README.
- **A request fails with a Hugging Face / gated-model error** — you're hitting SAM 3
  concept detection without approved access. Revisit
  [step 1](#getting-a-token).
- **A `huggingface_hub` warning about not being able to reach the Hub** in segserver's
  logs — not fatal by itself. Once a model has downloaded, segserver's own startup
  only needs `huggingface.co` reachable to check for a *newer* version; if that
  check fails but the model is already cached, `huggingface_hub` logs a warning and
  uses the cached copy rather than failing (this is upstream default behavior, not
  something GridShot has to opt into). If capture actually stops working, check
  `/api/health/capabilities` — a segmentation lane in `"status": "error"` means the
  cache itself is missing or corrupt, not just an update check that failed.
