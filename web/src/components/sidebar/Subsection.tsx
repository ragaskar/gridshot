import type { ReactNode } from "react";
import { InfoTip } from "../InfoTip";

/** A foldable block nested inside a Section — same click-anywhere-to-toggle
 *  behavior as Section, with its own (lighter-weight) chevron: ▾ closed, ▴
 *  open. `relevant` (default true) bolds the title to signal it applies to
 *  the current selection — set it false to visually de-emphasize a
 *  subsection that doesn't currently apply, without hiding or disabling it.
 *  `headerExtra` renders right after the title, in both the open and closed
 *  states — for controls (like an on/off toggle) that need a fixed spot in
 *  the header regardless of fold state, unlike the body it doesn't move
 *  when the subsection opens. */
export function Subsection({
  title, open, onToggle, disabled, relevant = true, tooltip, headerExtra, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  relevant?: boolean;
  tooltip?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details open={open} className="border-t border-line pt-2">
      <summary
        className="group flex cursor-pointer select-none items-center gap-2 rounded-sm px-1 py-0.5 font-mono text-[10px] uppercase text-muted transition-colors hover:bg-paper-2 [&::-webkit-details-marker]:hidden"
        style={{ listStyle: "none" }}
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block shrink-0 text-[9px] transition-[font-weight] group-hover:font-bold"
        >
          {open ? "▴" : "▾"}
        </span>
        <span className={relevant ? "font-bold" : undefined}>{title}</span>
        {headerExtra && (
          <span onClick={(e) => e.stopPropagation()}>{headerExtra}</span>
        )}
        <span className="flex-1" />
        {tooltip && (
          <span onClick={(e) => e.stopPropagation()}>
            <InfoTip label={`${title} info`}>{tooltip}</InfoTip>
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
