import type { ReactNode } from "react";

// calc() needs spaces around its operator; Tailwind arbitrary values encode
// them as underscores.
const FULL_HEIGHT_LG = "lg:h-[calc(100dvh_-_var(--app-nav-h,_64px))]";

/** Independently-scrollable, collapsible sidebar. Collapses to a narrow rail
 *  (toggle only) on its own side — left collapses toward the left edge,
 *  right toward the right — so the center canvas column can reclaim the
 *  width. Sizes itself against --app-nav-h (published by AppNavigation) so
 *  it fills the viewport below the sticky nav without either scrolling the
 *  whole page or hardcoding the nav's height.
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
            ? `hidden shrink-0 flex-col items-center border-r border-line py-2 lg:flex lg:min-h-0 ${FULL_HEIGHT_LG}`
            : `hidden shrink-0 flex-col items-center border-l border-line py-2 lg:flex lg:min-h-0 ${FULL_HEIGHT_LG}`
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
          ? `w-full shrink-0 border-line lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:border-r ${FULL_HEIGHT_LG}`
          : `w-full shrink-0 border-line lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:border-l ${FULL_HEIGHT_LG}`
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
