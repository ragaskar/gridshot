/** Tiny build stamp so it's obvious from the running app whether a rebuild
 *  actually picked up the latest code — sha and build time are baked in at
 *  image-build time (see docker/web.Dockerfile + scripts/lib-compose.sh),
 *  not read at runtime, so a stale footer means a stale image. The build
 *  time is baked in as UTC but shown in whatever timezone the browser is
 *  set to, since that's the one a human reading it actually thinks in. */
function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function BuildFooter() {
  const sha = import.meta.env.VITE_GIT_SHA || "unknown";
  const builtAt = formatLocal(import.meta.env.VITE_BUILD_TIME || "");
  return (
    <footer className="mx-auto max-w-container px-6 py-3 font-mono text-[10px] text-muted">
      gridshot build {sha} ({builtAt})
    </footer>
  );
}
