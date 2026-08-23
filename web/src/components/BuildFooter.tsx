/** Tiny build stamp so it's obvious from the running app whether a rebuild
 *  actually picked up the latest code — sha and build time are baked in at
 *  image-build time (see docker/web.Dockerfile + scripts/lib-compose.sh),
 *  not read at runtime, so a stale footer means a stale image. */
export function BuildFooter() {
  const sha = import.meta.env.VITE_GIT_SHA || "unknown";
  const builtAt = import.meta.env.VITE_BUILD_TIME || "unknown";
  return (
    <footer
      className="mx-auto max-w-container px-6 py-3 font-mono text-[10px] text-muted"
      title={`built ${builtAt}`}
    >
      gridshot build {sha}
    </footer>
  );
}
