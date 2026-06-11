/// <reference types="electron-vite/node" />

// Project-specific env vars injected by electron-vite at build time
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_ENABLE_ACCOUNT_LOGIN?: string
  readonly VITE_ENABLE_LOCAL_MODE?: string
}
