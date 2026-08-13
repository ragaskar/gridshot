import { useEffect, useMemo, useRef, useState } from "react";
import {
  calibrateIntrinsics,
  deleteAllDeviceProfiles,
  deleteDeviceProfile,
  getDeviceProfiles,
  getMats,
  inspectCalibrationSignatures,
  type CaptureSignature,
  type DeviceProfileSummary,
  type IntrinsicsCalibrationResult,
  type Mat,
  type SignatureReport,
  type SignatureRow,
} from "../api";
import { useApp } from "../state";

const MIN_VIEWS = 8;
const RECOMMENDED_VIEWS = 12;

export function Calibration() {
  const reset = useApp((state) => state.reset);
  const [mats, setMats] = useState<Mat[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfileSummary[]>([]);
  const [matId, setMatId] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<SignatureReport | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [result, setResult] = useState<IntrinsicsCalibrationResult | null>(
    null,
  );
  // Only the newest selection's report may land: a large batch inspected
  // before a small one would otherwise overwrite it out of order.
  const inspectToken = useRef(0);

  useEffect(() => {
    Promise.all([getMats(), getDeviceProfiles()])
      .then(([matValues, profileValues]) => {
        const verified = matValues.filter((mat) => mat.verified);
        setMats(verified);
        setProfiles(profileValues);
        setMatId((current) => current || verified[0]?.mat_id || "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const captureSummary = useMemo(() => {
    if (!result) return null;
    const signature = result.capture_signature;
    const camera = [signature.device_make, signature.device_model]
      .filter(Boolean)
      .join(" ");
    return {
      camera: camera || "Camera metadata unavailable",
      lens: signature.lens_model || "Lens metadata unavailable",
      resolution: `${signature.image_size[0]} × ${signature.image_size[1]}`,
      orientation: `${signature.orientation_deg}°`,
      zoom:
        signature.digital_zoom_ratio == null
          ? "Metadata unavailable"
          : `${signature.digital_zoom_ratio.toFixed(2)}×`,
    };
  }, [result]);

  const minViews = report?.min_views ?? MIN_VIEWS;
  const matchingFiles = useMemo(() => {
    if (!report) return files;
    return report.rows
      .filter((row) => row.matches)
      .map((row) => files[row.index - 1])
      .filter((file): file is File => file != null);
  }, [report, files]);

  async function selectFiles(chosen: File[]) {
    setFiles(chosen);
    setReport(null);
    setInspectError(null);
    const token = ++inspectToken.current;
    if (chosen.length === 0) return;
    setInspecting(true);
    try {
      const value = await inspectCalibrationSignatures(chosen);
      if (token === inspectToken.current) setReport(value);
    } catch (reason) {
      if (token === inspectToken.current) {
        setInspectError((reason as Error).message);
      }
    } finally {
      if (token === inspectToken.current) setInspecting(false);
    }
  }

  async function runCalibration() {
    if (!matId || matchingFiles.length < minViews) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = await calibrateIntrinsics(matchingFiles, matId, name);
      setResult(value);
      setProfiles((current) => [
        value.profile,
        ...current.filter(
          (profile) => profile.device_id !== value.profile.device_id,
        ),
      ]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: DeviceProfileSummary) {
    const confirmed = window.confirm(
      `Delete camera profile "${profile.device_id}"? Existing saved traces ` +
        "will keep their recorded calibration, but new captures will stop " +
        "using this profile.",
    );
    if (!confirmed) return;

    setDeleting(profile.device_id);
    setError(null);
    try {
      await deleteDeviceProfile(profile.device_id);
      setProfiles((current) =>
        current.filter((item) => item.device_id !== profile.device_id),
      );
      if (result?.profile.device_id === profile.device_id) {
        setResult(null);
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  async function removeAllProfiles() {
    const confirmed = window.confirm(
      `Delete all ${profiles.length} camera profiles? Existing saved traces ` +
        "will keep their recorded calibration, but new captures will use " +
        "estimated intrinsics until you recalibrate.",
    );
    if (!confirmed) return;

    setDeleting("all");
    setError(null);
    try {
      await deleteAllDeviceProfiles();
      setProfiles([]);
      setResult(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-container px-6 py-12">
      <header className="mb-10">
        <div className="specline border-y border-line py-3 mb-8 flex items-center gap-6">
          <span>Accuracy setup · Camera intrinsics</span>
          <button className="ml-auto text-teal hover:underline" onClick={reset}>
            ← Back to trace
          </button>
        </div>
        <div className="grp-label mb-2">One-time capture setup</div>
        <h1 className="titledev text-3xl leading-none">
          <span className="text-teal">CALIBRATE</span>
          <span>CAMERA</span>
        </h1>
        <p className="font-body text-lg max-w-[66ch] mt-4">
          Measure the lens distortion for one exact camera, lens, orientation,
          resolution, and zoom. GridShot will select this profile automatically
          and will abstain when a later photo does not match.
        </p>
      </header>

      {error && (
        <div className="panel mb-8 border-orange" role="alert">
          <div className="grp-label text-orange-text mb-2">
            Calibration failed
          </div>
          <p className="font-mono text-sm">{error}</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel">
          <div className="grp-label mb-4">01 · Photograph the mat</div>
          <ol className="space-y-5">
            <Guide n="A" title="Lock one capture setup">
              Use the same rear camera, lens, orientation, resolution, and zoom
              for every photo. Do not crop, edit, or mix camera modes.
            </Guide>
            <Guide n="B" title="Shoot 12–20 varied views">
              Move around the flat verified mat. Include centered, edge, near,
              far, and gently tilted views so the board covers the whole frame.
            </Guide>
            <Guide n="C" title="Keep every view usable">
              Keep the board sharp and fully visible, avoid glare, and do not
              change zoom after the first shot. More varied views beat repeated
              photos from one position.
            </Guide>
          </ol>
          <div className="mt-6 border-t border-line pt-5 font-mono text-xs text-muted">
            Profiles are immutable. Recalibrating the same capture setup creates
            a new revision; prior traces retain the revision they used.
          </div>
        </section>

        <section className="panel">
          <div className="grp-label mb-4">02 · Build profile</div>
          <div className="space-y-5">
            <label className="block">
              <span className="font-mono text-xs block mb-1">
                Verified calibration mat
              </span>
              <select
                className="mono-input"
                value={matId}
                onChange={(event) => setMatId(event.target.value)}
                disabled={busy}
              >
                {mats.length === 0 && (
                  <option value="">No verified mat available</option>
                )}
                {mats.map((mat) => (
                  <option key={mat.mat_id} value={mat.mat_id}>
                    {mat.mat_id} · {mat.paper.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="font-mono text-xs block mb-1">
                Profile label <span className="text-muted">(optional)</span>
              </span>
              <input
                className="mono-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. shop phone main camera"
                disabled={busy}
              />
            </label>

            <label className="block">
              <span className="font-mono text-xs block mb-1">
                Calibration photos
              </span>
              <input
                className="mono-input file:font-mono file:text-xs"
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                disabled={busy}
                onChange={(event) =>
                  void selectFiles(Array.from(event.target.files ?? []))
                }
              />
              <span className="font-mono text-xs text-muted block mt-2">
                {files.length} selected · {minViews} minimum ·{" "}
                {RECOMMENDED_VIEWS}+ recommended
              </span>
            </label>

            {inspecting && (
              <p className="font-mono text-xs text-muted">
                Reading capture settings…
              </p>
            )}

            {inspectError && (
              <p className="font-mono text-xs text-orange-text" role="alert">
                Could not read capture settings: {inspectError}. Calibration
                will still check them when it runs.
              </p>
            )}

            {files.length > 0 && !inspecting && !report && (
              <div className="border border-line bg-paper-2 px-3 py-2 max-h-36 overflow-auto">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="font-mono text-xs py-1 flex gap-3"
                  >
                    <span className="text-muted w-6">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate">{file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {report && <SignatureTable report={report} />}

            <button
              className="btn btn-primary"
              disabled={
                busy ||
                inspecting ||
                !matId ||
                matchingFiles.length < minViews
              }
              onClick={runCalibration}
            >
              {busy
                ? "Calibrating…"
                : report && report.matching_count < report.total
                  ? `Calibrate with ${matchingFiles.length} matching photos`
                  : "Create camera profile"}
            </button>
          </div>
        </section>
      </div>

      {result && captureSummary && (
        <section className="panel mt-8 border-teal" aria-live="polite">
          <div className="flex flex-wrap items-start gap-4 mb-6">
            <div>
              <div className="grp-label mb-1">Profile ready</div>
              <h2 className="font-display font-bold text-xl">
                {result.profile.device_id}
              </h2>
            </div>
            <span className="badge text-teal border-teal ml-auto">
              Revision {result.profile.revision}
            </span>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <table className="dtable">
              <tbody>
                <tr>
                  <td>Camera</td>
                  <td>{captureSummary.camera}</td>
                </tr>
                <tr>
                  <td>Lens</td>
                  <td>{captureSummary.lens}</td>
                </tr>
                <tr>
                  <td>Resolution</td>
                  <td>{captureSummary.resolution}</td>
                </tr>
                <tr>
                  <td>Orientation</td>
                  <td>{captureSummary.orientation}</td>
                </tr>
                <tr>
                  <td>Digital zoom</td>
                  <td>{captureSummary.zoom}</td>
                </tr>
              </tbody>
            </table>
            <table className="dtable">
              <tbody>
                <tr>
                  <td>Views used</td>
                  <td>
                    {result.views_used} / {result.views_uploaded}
                  </td>
                </tr>
                <tr>
                  <td>Reprojection RMS</td>
                  <td>{result.profile.reproj_rms_px.toFixed(3)} px</td>
                </tr>
                <tr>
                  <td>Mat</td>
                  <td>{result.profile.mat_id}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {result.warnings.length > 0 && (
            <ul className="mt-5 font-mono text-xs text-orange-text list-disc pl-5">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <button className="btn btn-ghost mt-6" onClick={reset}>
            Trace a tool
          </button>
        </section>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-center gap-4">
          <div className="grp-label">Saved camera profiles</div>
          {profiles.length > 0 && (
            <button
              className="ml-auto font-mono text-xs uppercase text-orange-text hover:underline disabled:opacity-40"
              disabled={deleting !== null}
              onClick={removeAllProfiles}
            >
              {deleting === "all" ? "Deleting…" : "Delete all"}
            </button>
          )}
        </div>
        {profiles.length === 0 ? (
          <p className="font-mono text-xs text-muted">
            No calibrated capture setups yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {profiles.map((profile) => (
              <div
                key={profile.device_id}
                className="border border-line p-4 flex items-start gap-4"
              >
                <div>
                  <div className="font-mono text-sm">{profile.device_id}</div>
                  <div className="specline mt-1">
                    {profile.image_size[0]}×{profile.image_size[1]} ·{" "}
                    {profile.orientation_deg}° · RMS{" "}
                    {profile.reproj_rms_px.toFixed(3)} px
                  </div>
                </div>
                <div className="ml-auto flex flex-col items-end gap-2">
                  <span className="badge">R{profile.revision}</span>
                  <button
                    className="font-mono text-xs uppercase text-orange-text hover:underline disabled:opacity-40"
                    disabled={deleting !== null}
                    onClick={() => removeProfile(profile)}
                  >
                    {deleting === profile.device_id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function text(value: string | null): string {
  return value && value.trim() ? value : "—";
}

function number(value: number | null, digits: number, unit = ""): string {
  return value == null ? "—" : `${value.toFixed(digits)}${unit}`;
}

const SIGNATURE_COLUMNS: {
  key: string;
  label: string;
  value: (signature: CaptureSignature) => string;
}[] = [
  { key: "device_make", label: "Make", value: (s) => text(s.device_make) },
  { key: "device_model", label: "Model", value: (s) => text(s.device_model) },
  { key: "lens_model", label: "Lens", value: (s) => text(s.lens_model) },
  {
    key: "image_size",
    label: "Size",
    value: (s) => `${s.image_size[0]}×${s.image_size[1]}`,
  },
  {
    key: "orientation_deg",
    label: "Orient",
    value: (s) => `${s.orientation_deg}°`,
  },
  { key: "mirrored", label: "Mirror", value: (s) => (s.mirrored ? "yes" : "no") },
  { key: "focal_mm", label: "Focal", value: (s) => number(s.focal_mm, 2, "mm") },
  {
    key: "focal_35mm",
    label: "35mm eq",
    value: (s) => number(s.focal_35mm, 1, "mm"),
  },
  {
    key: "digital_zoom_ratio",
    label: "Zoom",
    value: (s) => number(s.digital_zoom_ratio, 2, "×"),
  },
];

function SignatureTable({ report }: { report: SignatureReport }) {
  const allMatch = report.matching_count === report.total;
  return (
    <div>
      <div
        className={`font-mono text-xs mb-2 ${
          report.can_calibrate ? "text-olive" : "text-red"
        }`}
        role="status"
      >
        {allMatch
          ? `All ${report.total} photos share one capture setup.`
          : `${report.matching_count} of ${report.total} photos share the ` +
            "majority capture setup."}
        {!report.can_calibrate &&
          ` Calibration needs ${report.min_views}; replace the mismatched ` +
            "photos and reselect."}
      </div>
      <div className="border border-line bg-paper-2 max-h-64 overflow-auto">
        <table className="w-full font-mono text-xs border-collapse">
          <thead>
            <tr className="text-muted text-left">
              <th className="px-2 py-1 font-normal">#</th>
              <th className="px-2 py-1 font-normal">Photo</th>
              <th className="px-2 py-1 font-normal">Match</th>
              {SIGNATURE_COLUMNS.map((column) => (
                <th key={column.key} className="px-2 py-1 font-normal">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <SignatureTableRow key={row.index} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-xs text-muted mt-2">
        Photos match field by field, within tolerance (focal ±0.05 mm, 35 mm eq
        ±0.5 mm, zoom ±0.01×); there is no single signature value to compare.
        Differing fields are underlined.
      </p>
    </div>
  );
}

function SignatureTableRow({ row }: { row: SignatureRow }) {
  const differing = new Set(row.mismatch_fields);
  return (
    <tr
      className={`border-t border-line ${
        row.matches ? "text-olive" : "text-red"
      }`}
      title={row.reason || undefined}
    >
      <td className="px-2 py-1">{String(row.index).padStart(2, "0")}</td>
      <td className="px-2 py-1 max-w-[14ch] truncate" title={row.name}>
        {row.name}
      </td>
      <td className="px-2 py-1 whitespace-nowrap">
        {row.matches ? "● match" : "● differs"}
      </td>
      {SIGNATURE_COLUMNS.map((column) => (
        <td
          key={column.key}
          className={`px-2 py-1 whitespace-nowrap ${
            differing.has(column.key) ? "underline decoration-dotted" : ""
          }`}
        >
          {column.value(row.signature)}
        </td>
      ))}
    </tr>
  );
}

function Guide({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="font-mono text-xs text-teal border border-teal w-8 h-8 flex items-center justify-center">
        {n}
      </span>
      <div>
        <div className="font-mono text-sm mb-1">{title}</div>
        <p className="font-body text-sm text-muted">{children}</p>
      </div>
    </li>
  );
}
