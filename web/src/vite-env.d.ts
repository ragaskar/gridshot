/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Short git SHA of the commit this build was made from, baked in by
   *  docker/web.Dockerfile (falls back to "unknown" outside that build). */
  readonly VITE_GIT_SHA?: string;
  /** UTC timestamp of when this build ran, same source as VITE_GIT_SHA. */
  readonly VITE_BUILD_TIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
