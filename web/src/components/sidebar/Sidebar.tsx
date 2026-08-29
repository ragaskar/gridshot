import type { ReactNode } from "react";

/** Independently-scrollable, collapsible sidebar. Collapses to a narrow rail
 *  (toggle only) on its own side — left collapses toward the left edge,
 *  right toward the right — so the center canvas column can reclaim the
 *  width. Expects to sit inside a `flex` row whose own height is already
 *  bounded (e.g. `lg:h-[calc(100dvh_-_var(--app-nav-h,_64px))]` on the page
 *  shell) — this component just fills that row (`lg:h-full`) and scrolls
 *  internally, rather than computing a viewport height itself, so it stays
 *  correct regardless of how tall whatever's above the row is.
 *
 *  Below `lg`, both sidebars render full-width and unscrolled (matching the
 *  page's existing stacked mobile fallback) rather than introducing new
 *  collapse/rail behavior nothing asked for. */
export function Sidebar({
  side, collapsed, onToggleCollapse, children,
}: {
  side: "left" | "right";
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <div
        className={
          side === "left"
            ? "hidden shrink-0 flex-col items-center border-r border-line py-2 lg:flex lg:h-full lg:min-h-0"
            : "hidden shrink-0 flex-col items-center border-l border-line py-2 lg:flex lg:h-full lg:min-h-0"
        }
        style={{ width: 32 }}
      >
        <button
          type="button"
          className="btn btn-ghost !p-1 text-xs"
          aria-label={`Expand ${side} sidebar`}
          title={`Expand ${side} sidebar`}
          onClick={onToggleCollapse}
        >
          {side === "left" ? "▶" : "◀"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        side === "left"
          ? "w-full shrink-0 border-line lg:h-full lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:border-r"
          : "w-full shrink-0 border-line lg:h-full lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:border-l"
      }
    >
      <div className="hidden justify-end px-2 py-1 lg:flex">
        <button
          type="button"
          className="btn btn-ghost !p-1 text-xs"
          aria-label={`Collapse ${side} sidebar`}
          title={`Collapse ${side} sidebar`}
          onClick={onToggleCollapse}
        >
          {side === "left" ? "◀" : "▶"}
        </button>
      </div>
      <div className="space-y-1 px-1 pb-3">{children}</div>
    </div>
  );
}
