# Bundled builtin apps

Directories placed here are shipped with the desktop app (`extraResources` →
`<resources>/builtin-apps`) and seeded into the user-apps directory on startup
by `src/main/services/builtin-apps.service.ts`.

Each app is a normal sub-app folder (`manifest.json` + entry file). Its
`manifest.id` **must** start with `com.clawbench.builtin.` — the rest of the id
is the `appKey` used by the server's common-apps registry
(`/api/v1/common-apps/:appKey`).

Seeding rules:

- missing apps are installed; installed copies are upgraded when the bundled
  `version` is newer (local `data/` etc. are preserved); never downgraded
- users can reset a builtin to the bundled copy (`subapp:reset-builtin`)
- when an admin publishes a newer archive to the server, clients update from
  the server copy instead (server > bundled)
- when the client is online, a builtin that is not registered/enabled in the
  server's common-apps registry is reported as disabled

ClawBench ships no builtin apps by default; this directory may stay empty.
