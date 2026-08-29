import type { ReactNode } from "react";
import { InfoTip } from "../InfoTip";

/** A foldable block nested inside a Section — same click-anywhere-to-toggle
 *  behavior as Section, but no triangle marker. `foldedSummary` renders
 *  inline in the header only while closed (e.g. Fingerhole showing its
 *  on/off value + a button on the folded line). */
export function Subsection({
  title, open, onToggle, disabled, tooltip, foldedSummary, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tooltip?: ReactNode;
  foldedSummary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details open={open} className="border-t border-line pt-2">
      <summary
        className="flex cursor-pointer select-none items-center gap-2 font-mono text-[10px] uppercase text-muted [&::-webkit-details-marker]:hidden"
        style={{ listStyle: "none" }}
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
      >
        <span className="flex-1">{title}</span>
        {tooltip && (
          <span onClick={(e) => e.stopPropagation()}>
            <InfoTip label={`${title} info`}>{tooltip}</InfoTip>
          </span>
        )}
        {!open && foldedSummary && (
          <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {foldedSummary}
          </span>
        )}
      </summary>
      <div
        aria-disabled={disabled || undefined}
        className={`mt-2 space-y-2 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      >
        {children}
      </div>
    </details>
  );
}
