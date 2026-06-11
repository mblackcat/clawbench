# Release Guide / 发布指南

How to produce signed, auto-updatable production builds of the ClawBench desktop app.

## 1. Update server (auto-update)

The app checks `<VITE_API_BASE_URL>/releases` (electron-updater generic provider) at runtime.

- The feed URL is baked in at **build time** from `VITE_API_BASE_URL` (set it in `frontend/.env.local` or CI env before `npm run build:mac` / `build:win`).
- If `VITE_API_BASE_URL` is not set, update checks are **disabled** in the packaged app (no localhost fallback, no startup errors).
- The backend serves artifacts via `/api/v1/releases` — upload with `npm run build:upload:mac`.
- The update server MUST be HTTPS in production; electron-updater downloads code from it.

## 2. Code signing

electron-builder picks up signing credentials from environment variables — no
changes to `package.json` are needed:

### macOS

| Env var | Meaning |
|---|---|
| `CSC_LINK` | Base64 or path of the `.p12` Developer ID Application certificate |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Required for notarization |

Notarization: add `"notarize": { "teamId": "<TEAM_ID>" }` under `build.mac` in
`frontend/package.json` once credentials are available. Without notarization,
macOS 13+ blocks the app on first launch (right-click → Open as workaround).

Note: `updater.service.ts` currently sets `verifyUpdateCodeSignature = false`
for ad-hoc builds. **Remove that line once real signing is in place**, otherwise
updates are not signature-verified.

### Windows

| Env var | Meaning |
|---|---|
| `CSC_LINK` | Path/base64 of the `.pfx` code-signing certificate |
| `CSC_KEY_PASSWORD` | Password for the `.pfx` |

Unsigned builds trigger SmartScreen "unknown publisher" warnings but still run.

## 3. Pre-release checklist

- [ ] `cd frontend && npm run typecheck && npm run lint`
- [ ] `cd backend && npm run typecheck && npm test`
- [ ] `VITE_API_BASE_URL` points at the production API
- [ ] Backend production env: `JWT_SECRET` set (server refuses to start with the
      default), `CORS_ORIGIN` set, Feishu credentials set
- [ ] Bump `frontend/package.json` version (drives the update feed)
