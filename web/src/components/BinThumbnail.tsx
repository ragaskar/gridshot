import { useEffect, useState } from "react";
import type { SavedBin } from "../api";
import { binPreviewHash, getBinPreview } from "../binPreviewCache";
import { placed } from "../geometry/placement";

const PAL = ["#9ec850", "#5ab478", "#548cd6", "#e6be46", "#c85ac8", "#50c8c8", "#e69646", "#a050d6"];

/** A small static "snap" of the multi-tool combine editor's 2D arrange
 *  view for one Bin Library entry — bin footprint, grid lines, and each
 *  tool's placed outline, no interactivity. Lazily fetches (or reuses a
 *  cached) preview on mount; see `binPreviewCache.ts` for the hash-keyed
 *  cache this reads/writes. */
export function BinThumbnail({ bin }: { bin: SavedBin }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getBinPreview>> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setFailed(false);
    getBinPreview(bin)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bin.id, binPreviewHash(bin)]);

  if (failed) {
    return (
      <div className="aspect-square w-full bg-field flex items-center justify-center" style={{ borderRadius: 2 }}>
        <span className="font-mono text-[9px] text-muted">no preview</span>
      </div>
    );
  }

  if (!preview) {
    return <div className="aspect-square w-full bg-field animate-pulse" style={{ borderRadius: 2 }} />;
  }

  const polys = preview.tools.map((t) => placed(t.stamp, t.tx, t.ty, t.rot, t.mirror_x, t.mirror_y));
  // A forced-size bin's footprint is centered on world origin (0,0), same as
  // the interactive editor's own locked branch — the server never re-centers
  // it on the tools, so neither should this (a tool parked off to one side
  // of a forced footprint is a real, deliberate arrangement, not a case to
  // paper over by centering the frame on the tools instead of the bin).
  const forced = bin.force_gx != null && bin.force_gy != null;
  const xs = polys.flat().map(([x]) => x);
  const ys = polys.flat().map(([, y]) => y);
  const cx = forced ? 0 : xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const cy = forced ? 0 : ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const { outer_w: ow, outer_d: od, gx, gy, pitch } = preview;
  const pad = Math.max(ow, od) * 0.08;

  return (
    <div className="aspect-square w-full bg-field overflow-hidden" style={{ borderRadius: 2 }}>
      <svg
        viewBox={`${cx - ow / 2 - pad} ${-(cy + od / 2) - pad} ${ow + 2 * pad} ${od + 2 * pad}`}
        className="w-full h-full"
      >
        {/* World y increases toward the back of the bin, same convention as
         *  the interactive arrange view — mirror once for display only. */}
        <g transform="scale(1,-1)">
          <rect
            x={cx - ow / 2} y={cy - od / 2} width={ow} height={od}
            fill="#00000022" stroke="#6b7280" strokeWidth={ow * 0.012} rx={ow * 0.02}
          />
          {Array.from({ length: gx - 1 }, (_, i) => {
            const x = cx - ow / 2 + (i + 1) * pitch;
            return <line key={"v" + i} x1={x} y1={cy - od / 2} x2={x} y2={cy + od / 2} stroke="#3a4046" strokeWidth={ow * 0.005} />;
          })}
          {Array.from({ length: gy - 1 }, (_, i) => {
            const y = cy - od / 2 + (i + 1) * pitch;
            return <line key={"h" + i} x1={cx - ow / 2} y1={y} x2={cx + ow / 2} y2={y} stroke="#3a4046" strokeWidth={ow * 0.005} />;
          })}
          {preview.tools.map((t, i) => (
            <polygon
              key={t.id}
              points={polys[i].map(([x, y]) => `${x},${y}`).join(" ")}
              fill={PAL[i % PAL.length] + "aa"}
              stroke={PAL[i % PAL.length]}
              strokeWidth={ow * 0.008}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
