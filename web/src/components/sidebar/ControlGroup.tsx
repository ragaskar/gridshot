import type { ReactNode } from "react";

/** A labeled (or unlabeled) cluster of controls — the atom sections and
 *  subsections are built from. Not foldable; a bordered box with a bold
 *  title sets it apart from a plain label. */
export function ControlGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded border border-line p-2">
      {title && <span className="block font-mono text-[10px] font-bold uppercase text-muted">{title}</span>}
      {children}
    </div>
  );
}
