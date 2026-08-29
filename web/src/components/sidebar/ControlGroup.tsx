import type { ReactNode } from "react";

/** A labeled (or unlabeled) cluster of controls — the atom sections and
 *  subsections are built from. Not foldable; just a title + content block. */
export function ControlGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      {title && <span className="block font-mono text-[10px] uppercase text-muted">{title}</span>}
      {children}
    </div>
  );
}
