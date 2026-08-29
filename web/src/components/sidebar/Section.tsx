import type { ReactNode } from "react";
import { InfoTip } from "../InfoTip";

/** A top-level, foldable block within a Sidebar — triangle fold indicator on
 *  the left, click anywhere on the header to open/close. `disabled` keeps the
 *  section visible and its fold state togglable (per-field disabling still
 *  happens on the individual controls) — it just dims the body and makes it
 *  inert, rather than hiding a non-applicable section outright. */
export function Section({
  title, open, onToggle, disabled, tooltip, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tooltip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details open={open} className="border-b border-line">
      <summary
        className="group flex cursor-pointer select-none items-center gap-2 px-3 py-2 font-mono text-xs uppercase text-teal transition-colors hover:bg-paper-2 [&::-webkit-details-marker]:hidden"
        style={{ listStyle: "none", letterSpacing: "0.14em" }}
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block shrink-0 text-[10px] transition-transform group-hover:font-bold"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>
        <span className="flex-1">{title}</span>
        {tooltip && (
          <span onClick={(e) => e.stopPropagation()}>
            <InfoTip label={`${title} info`}>{tooltip}</InfoTip>
          </span>
        )}
      </summary>
      <div
        aria-disabled={disabled || undefined}
        className={`space-y-3 px-3 pb-3 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      >
        {children}
      </div>
    </details>
  );
}
