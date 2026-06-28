/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only Google Maps key prefill (from gitignored .env.local). Never shipped. */
  readonly VITE_GOOGLE_MAPS_KEY?: string
  /** Dev default route start (defaults to "Tokyo Station"). */
  readonly VITE_MAPS_START?: string
  /** Dev default route end (defaults to "Osaka Station"). */
  readonly VITE_MAPS_END?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
