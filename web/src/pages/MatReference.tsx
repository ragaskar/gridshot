import { useEffect, useMemo, useState } from "react";
import {
  getMats,
  matReferencePhotoUrl,
  uploadMatReference,
  type Mat,
  type MatReferenceResult,
} from "../api";
import { useApp } from "../state";
import { Guide } from "../components/Guide";

export function MatReference() {
  const reset = useApp((state) => state.reset);
  const [mats, setMats] = useState<Mat[]>([]);
  const [matId, setMatId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatReferenceResult | null>(null);
  // Bump after every successful upload so the <img> below re-fetches instead
  // of showing the browser's cached copy of the old reference photo.
  const [previewVersion, setPreviewVersion] = useState(0);

  useEffect(() => {
    getMats()
      .then((values) => {
        const verified = values.filter((mat) => mat.verified);
        setMats(verified);
        setMatId((current) => current || verified[0]?.mat_id || "");
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const selected = useMemo(
    () => mats.find((mat) => mat.mat_id === matId) ?? null,
    [mats, matId],
  );

  async function submit() {
    if (!matId || !file) return;
    setBusy(true);
    setError(null);
    try {
      const value = await uploadMatReference(matId, file);
      setResult(value);
      setPreviewVersion((v) => v + 1);
      setMats((current) =>
        current.map((mat) =>
          mat.mat_id === matId ? { ...mat, has_reference: true } : mat,
        ),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-container px-6 py-12">
      <header className="mb-10">
        <div className="specline border-y border-line py-3 mb-8 flex items-center gap-6">
          <span>Accuracy setup · Empty-mat reference</span>
          <button className="ml-auto text-teal hover:underline" onClick={reset}>
            ← Back to trace
          </button>
        </div>
        <div className="grp-label mb-2">One-time-per-mat capture setup</div>
        <h1 className="titledev text-3xl leading-none">
          <span className="text-teal">MAT</span>
          <span>REFERENCE</span>
        </h1>
        <p className="font-body text-lg max-w-[66ch] mt-4">
          Store a photo of the mat with nothing on it. Trace diffs every
          capture against this to locate the tool; without it, trace falls
          back to slower, less reliable detection.
        </p>
      </header>

      {error && (
        <div className="panel mb-8 border-orange" role="alert">
          <div className="grp-label text-orange-text mb-2">
            Reference upload failed
          </div>
          <p className="font-mono text-sm">{error}</p>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel">
          <div className="grp-label mb-4">01 · Photograph the empty mat</div>
          <ol className="space-y-5">
            <Guide n="A" title="Verify the mat first">
              A reference can only be stored for a mat whose printed scale has
              been measured. Run{" "}
              <code className="font-mono">
                scripts/gridshot mat verify &lt;mat-id&gt;
              </code>{" "}
              first — this one step isn't available in the web UI.
            </Guide>
            <Guide n="B" title="Clear the mat">
              Tape it down exactly as you will for real captures, then remove
              every tool, hand, and shadow from the frame.
            </Guide>
            <Guide n="C" title="Match your usual lighting">
              Shoot from directly above, in the lighting you'll actually use.
              The camera doesn't need to match later captures exactly — every
              photo is independently rectified to the mat — but consistent
              lighting makes the diff more reliable.
            </Guide>
          </ol>
          <div className="mt-6 border-t border-line pt-5 font-mono text-xs text-muted">
            Uploading again for the same mat replaces its existing reference.
          </div>
        </section>

        <section className="panel">
          <div className="grp-label mb-4">02 · Store reference</div>
          <div className="space-y-5">
            <label className="block">
              <span className="font-mono text-xs block mb-1">
                Verified mat
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
                    {mat.has_reference ? " · has reference" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="font-mono text-xs block mb-1">
                Empty-mat photo
              </span>
              <input
                className="mono-input file:font-mono file:text-xs"
                type="file"
                accept="image/*,.heic,.heif"
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            {selected?.has_reference && (
              <div className="border border-line bg-paper-2 p-3">
                <span className="font-mono text-xs text-muted block mb-2">
                  Current reference
                </span>
                <img
                  src={`${matReferencePhotoUrl(matId)}?v=${previewVersion}`}
                  alt={`Empty-mat reference for ${matId}`}
                  className="max-h-64 w-auto border border-line"
                />
              </div>
            )}

            <button
              className="btn btn-primary"
              disabled={busy || !matId || !file}
              onClick={submit}
            >
              {busy
                ? "Storing…"
                : selected?.has_reference
                  ? "Replace reference photo"
                  : "Store reference photo"}
            </button>
          </div>
        </section>
      </div>

      {result && (
        <section className="panel mt-8 border-teal" aria-live="polite">
          <div className="flex flex-wrap items-start gap-4 mb-6">
            <div>
              <div className="grp-label mb-1">Reference stored</div>
              <h2 className="font-display font-bold text-xl">
                {result.mat_id}
              </h2>
            </div>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <table className="dtable">
              <tbody>
                <tr>
                  <td>Corners detected</td>
                  <td>{result.n_corners}</td>
                </tr>
                <tr>
                  <td>Reprojection RMS</td>
                  <td>{result.reproj_rms_px.toFixed(3)} px</td>
                </tr>
              </tbody>
            </table>
            <table className="dtable">
              <tbody>
                <tr>
                  <td>Camera</td>
                  <td>
                    {[
                      result.capture_signature.device_make,
                      result.capture_signature.device_model,
                    ]
                      .filter(Boolean)
                      .join(" ") || "Camera metadata unavailable"}
                  </td>
                </tr>
                <tr>
                  <td>Lens</td>
                  <td>{result.capture_signature.lens_model || "—"}</td>
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
          <div className="mt-6">
            <span className="font-mono text-xs text-muted block mb-2">
              Stored canonical reference
            </span>
            <img
              src={`${matReferencePhotoUrl(result.mat_id)}?v=${previewVersion}`}
              alt={`Empty-mat reference for ${result.mat_id}`}
              className="max-h-96 w-auto border border-line"
            />
          </div>
          <button className="btn btn-ghost mt-6" onClick={reset}>
            Trace a tool
          </button>
        </section>
      )}
    </div>
  );
}
