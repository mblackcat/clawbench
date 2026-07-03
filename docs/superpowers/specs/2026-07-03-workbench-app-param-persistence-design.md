# Workbench App Param Persistence Design

## Goal

Workbench app runs should remember the user's last submitted parameter values locally per app, then reuse those values on later runs instead of always falling back to `manifest.json` defaults.

## Current Behavior

`InstalledAppsPage` builds direct-run params from `manifest.params[].default` every time. `ParamDrawer` also resets to manifest defaults whenever it opens. The main process only executes the params passed by the renderer, so the lost state originates in the renderer path.

## Design

Add a small renderer utility for app parameter values. It will:

- Build initial params from manifest defaults, coercing booleans and numbers to the control-friendly JS types already expected by `ParamDrawer`.
- Load locally persisted values from `localStorage` using a per-app key.
- Merge defaults with saved values, where saved values win and new manifest defaults fill any missing keys.
- Save submitted params back to `localStorage` after the user executes from the drawer.
- Ignore persisted keys that are no longer present in the current manifest params, so removed parameters are not sent to apps forever.

`InstalledAppsPage` will use the merged values for no-required-params direct runs and pass the same values to `ParamDrawer` for form initialization. `ParamDrawer` will accept optional `initialValues` and keep its existing rendering/validation behavior.

## Error Handling

Malformed local values are ignored and the app falls back to manifest defaults. Failed `localStorage` writes are swallowed after a console warning because a run should not be blocked by persistence failure.

## Testing

Add unit tests for the utility covering:

- Saved values override manifest defaults.
- New manifest defaults are still included when absent from saved values.
- Stale saved keys are dropped.
- Bad stored JSON falls back to defaults.

