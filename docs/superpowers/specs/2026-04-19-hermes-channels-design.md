# Hermes Channel Configuration Expansion

**Date:** 2026-04-19  
**Scope:** Expand the Hermes `Channels` tab to cover the full current Hermes gateway platform surface, replace the current 4-platform schema with a new complete channel schema, and verify that saved configuration is written correctly and does not break Hermes gateway startup.

---

## Summary

The current Hermes `Channels` tab only exposes Telegram, Discord, Slack, and Signal, while the local Hermes source and docs show a much broader gateway platform surface.

This change upgrades the desktop Hermes integration from a partial channel configurator into a full official-platform configurator by:

- expanding the visible channel list from 4 to 16 supported gateway platforms
- modeling each platform with its minimum required fields only
- writing secrets and credentials to `~/.hermes/.env`
- keeping only enablement state in `~/.hermes/config.yaml`
- replacing the old 4-platform schema instead of preserving compatibility shims
- validating both config persistence and gateway startup behavior after the change

This is a channel configuration redesign, not a full setup wizard for every external platform.

---

## Goals

1. Make the Hermes `Channels` tab reflect the current official gateway platform surface.
2. Keep the UI focused on the minimum required fields for enabling each platform.
3. Store credentials only in `.env` unless Hermes requires otherwise.
4. Replace the old partial channel schema with a single complete schema.
5. Verify that saving config produces the expected `config.yaml` + `.env` state.
6. Verify that the new configuration mapping does not break Hermes gateway startup.

---

## Non-Goals

- No advanced per-platform options in this iteration
- No QR pairing flow implementation inside the desktop app
- No external bridge/daemon lifecycle management for platform-specific dependencies
- No migration layer for the old 4-platform channel schema
- No broad redesign of other Hermes tabs beyond what is needed for consistency

---

## Current State

### Renderer

`frontend/src/renderer/src/pages/Hermes/HermesPage.tsx` currently hardcodes 4 channel cards directly in the tab body.

Current limitations:

- only 4 platforms are visible
- card rendering is hand-written and repetitive
- channel metadata is embedded inline in the page component
- only the old narrow channel shape is supported
- platform-specific external dependency caveats are not surfaced

### Types and Persistence

`frontend/src/renderer/src/types/hermes.ts` currently defines a narrow `HermesConfig.channels` shape covering only:

- telegram
- discord
- slack
- signal

`frontend/src/main/services/hermes.service.ts` reads and writes only those 4 platforms by mapping `_ui.channels` plus selected `.env` variables.

This is too limited for the actual Hermes platform surface shown by the local source tree.

---

## Source of Truth for Scope

The local Hermes source at `/Users/joeyzhao/Documents/github/hermes-agent` shows the gateway currently supports these relevant platform keys:

- `telegram`
- `discord`
- `slack`
- `signal`
- `whatsapp`
- `matrix`
- `mattermost`
- `homeassistant`
- `dingtalk`
- `feishu`
- `wecom`
- `weixin`
- `sms`
- `email`
- `bluebubbles`
- `qqbot`

This redesign should expose all 16 of these in the desktop UI.

---

## Design

## 1. Channel Scope and Product Behavior

The `Channels` tab will become the canonical platform configuration surface for all current Hermes gateway channels.

The page will expose all 16 platforms as first-class cards in the same section.

Each card will follow the existing visual pattern:

- icon
- title
- one-line description
- enabled toggle
- expanded editable fields when enabled

The desktop app will only expose the minimum required field set for each platform.

This keeps the tab compact and avoids turning the page into a full platform setup wizard.

### External Dependency Positioning

Some platforms cannot be considered fully usable based on credentials alone because Hermes depends on an external bridge, daemon, webhook endpoint, or pairing flow.

For those platforms, the UI should still allow configuration, but the card description or helper copy must explicitly state that extra external setup is required.

The desktop app should not pretend it can complete those external steps itself.

---

## 2. Target Channel List and Minimum Field Set

The new schema will expose the following minimum fields.

### Simple credential-based platforms

#### Telegram
- `enabled`
- `token`

Env mapping:
- `TELEGRAM_BOT_TOKEN`

#### Discord
- `enabled`
- `token`

Env mapping:
- `DISCORD_BOT_TOKEN`

#### Slack
- `enabled`
- `bot_token`
- `app_token`

Env mapping:
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`

#### Mattermost
- `enabled`
- `url`
- `token`

Env mapping:
- `MATTERMOST_URL`
- `MATTERMOST_TOKEN`

#### DingTalk
- `enabled`
- `client_id`
- `client_secret`

Env mapping:
- `DINGTALK_CLIENT_ID`
- `DINGTALK_CLIENT_SECRET`

#### Feishu
- `enabled`
- `app_id`
- `app_secret`

Env mapping:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

#### WeCom
- `enabled`
- `bot_id`
- `secret`

Env mapping:
- `WECOM_BOT_ID`
- `WECOM_SECRET`

#### QQ Bot
- `enabled`
- `app_id`
- `client_secret`

Env mapping:
- `QQ_APP_ID`
- `QQ_CLIENT_SECRET`

### Platforms that need operator-supplied service endpoints

#### Signal
- `enabled`
- `http_url`
- `account`

Env mapping:
- `SIGNAL_HTTP_URL`
- `SIGNAL_ACCOUNT`

#### Matrix
- `enabled`
- `homeserver`
- `access_token`

Env mapping:
- `MATRIX_HOMESERVER`
- `MATRIX_ACCESS_TOKEN`

#### Home Assistant
- `enabled`
- `url`
- `token`

Env mapping:
- `HASS_URL`
- `HASS_TOKEN`

#### Email
- `enabled`
- `address`
- `password`
- `imap_host`
- `smtp_host`

Env mapping:
- `EMAIL_ADDRESS`
- `EMAIL_PASSWORD`
- `EMAIL_IMAP_HOST`
- `EMAIL_SMTP_HOST`

#### SMS
- `enabled`
- `account_sid`
- `auth_token`
- `phone_number`
- `webhook_url`

Env mapping:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `SMS_WEBHOOK_URL`

#### BlueBubbles
- `enabled`
- `server_url`
- `password`

Env mapping:
- `BLUEBUBBLES_SERVER_URL`
- `BLUEBUBBLES_PASSWORD`

### Platforms with additional external runtime or pairing expectations

#### WhatsApp
- `enabled`

Env mapping:
- `WHATSAPP_ENABLED`

The minimum UI surface is enablement only. The card copy must explain that WhatsApp still requires external bridge/pairing outside this page.

#### Weixin
- `enabled`
- `token`
- `account_id`

Env mapping:
- `WEIXIN_TOKEN`
- `WEIXIN_ACCOUNT_ID`

The card copy must explain that Weixin setup depends on the external platform-side flow.

---

## 3. Storage Rules

### `config.yaml`

`config.yaml` will continue to hold only UI-level channel enablement state under `_ui.channels`.

Example target shape:

```yaml
_ui:
  channels:
    telegram: true
    discord: false
    slack: true
    signal: false
    whatsapp: false
    matrix: false
    mattermost: false
    homeassistant: false
    dingtalk: false
    feishu: false
    wecom: false
    weixin: false
    sms: false
    email: false
    bluebubbles: false
    qqbot: false
```

This keeps the desktop app’s own page state compact and avoids duplicating secrets in YAML.

### `.env`

All platform credentials and connection fields in scope for this redesign will be written to `~/.hermes/.env`.

If a channel is disabled, its stored env values may remain present after save. This is acceptable for this iteration because the app is a config editor, not a secret garbage collector.

The important guarantee is that enabled state comes from `_ui.channels`, while field values remain available for later re-enable.

---

## 4. Config Model Replacement

The old `HermesConfig.channels` shape should be replaced, not extended through compatibility shims.

### Target Type Shape

```ts
channels: {
  telegram: { enabled: boolean; token: string }
  discord: { enabled: boolean; token: string }
  slack: { enabled: boolean; bot_token: string; app_token: string }
  signal: { enabled: boolean; http_url: string; account: string }
  whatsapp: { enabled: boolean }
  matrix: { enabled: boolean; homeserver: string; access_token: string }
  mattermost: { enabled: boolean; url: string; token: string }
  homeassistant: { enabled: boolean; url: string; token: string }
  dingtalk: { enabled: boolean; client_id: string; client_secret: string }
  feishu: { enabled: boolean; app_id: string; app_secret: string }
  wecom: { enabled: boolean; bot_id: string; secret: string }
  weixin: { enabled: boolean; token: string; account_id: string }
  sms: { enabled: boolean; account_sid: string; auth_token: string; phone_number: string; webhook_url: string }
  email: { enabled: boolean; address: string; password: string; imap_host: string; smtp_host: string }
  bluebubbles: { enabled: boolean; server_url: string; password: string }
  qqbot: { enabled: boolean; app_id: string; client_secret: string }
}
```

### Design Consequence

Existing logic that assumes only 4 platforms should be removed and replaced with the new complete structure.

This includes:

- default config creation
- config read normalization
- config save normalization
- UI rendering assumptions

No migration layer is required.

---

## 5. Renderer Structure

The current inline JSX block for channel cards should be replaced by a data-driven renderer.

### Channel Registry

A dedicated schema definition should describe, for each platform:

- `id`
- `titleKey`
- `descriptionKey`
- `icon`
- `requiresExternalSetup`
- `fields`
- per-field label key
- per-field input type
- per-field placeholder

This registry may live either in a new Hermes helper file or near other Hermes page helper metadata, but it should not remain as one long hardcoded JSX list in `HermesPage.tsx`.

### Why

A registry-driven renderer:

- keeps `HermesPage.tsx` focused on composition
- reduces repeated card boilerplate
- makes the 16-platform surface maintainable
- makes future additions or removals localized

---

## 6. Copy and UX

The UI should remain concise.

Each platform gets:

- a name
- a one-line description
- optional extra note for platforms needing external services or pairing

### Required extra-note cases

The following channels should include short helper copy about external setup expectations:

- `whatsapp`
- `signal`
- `bluebubbles`
- `sms`
- `weixin`
- `homeassistant`

These notes should be one short sentence each, not long documentation blocks.

The intent is to prevent false expectations while keeping the card compact.

---

## 7. Persistence Logic Changes

`frontend/src/main/services/hermes.service.ts` should be updated in three places.

### Config Read

`readHermesConfigFromSources()` should:

- initialize the new full channel shape
- read `_ui.channels` enablement for all 16 platforms
- read all supported env vars into the matching fields

### Config Normalize for Save

`normalizeHermesConfigForSave()` should:

- emit `_ui.channels` for all 16 platforms
- emit the full `.env` mapping for all minimum fields in scope

### Config Save

`saveConfig()` should continue to merge with existing `.env` contents, but the generated Hermes channel mapping should come entirely from the new schema.

The old narrow 4-channel assumptions should be removed.

---

## 8. Validation and Verification Strategy

Validation for this redesign has two layers.

### A. Config Persistence Validation

After editing fields in the UI and saving:

1. re-fetch config through the existing IPC/store path
2. confirm the UI state matches what was saved
3. inspect `~/.hermes/config.yaml`
4. inspect `~/.hermes/.env`
5. confirm that `_ui.channels` and env variables match the edited values

### B. Gateway Startup Validation

Run a representative save-and-start verification pass.

The minimum requirement is:

1. save config from the desktop app
2. stop Hermes gateway if running
3. start Hermes gateway
4. confirm Hermes does not fail because of the new config mapping itself

Interpretation of success:

- if a platform requires an external daemon, bridge, webhook, or pairing flow, lack of that external dependency is not treated as a desktop-app config bug
- if Hermes fails immediately because the desktop app wrote the wrong key names or wrong shape, that is a failure of this redesign

Representative channels should include at least:

- one simple token platform
- one dual-token platform
- one endpoint-plus-token platform
- one external-setup platform

This ensures the mapping is exercised across the main platform categories.

---

## 9. Files Expected to Change

### Types
- `frontend/src/renderer/src/types/hermes.ts`

### Renderer
- `frontend/src/renderer/src/pages/Hermes/HermesPage.tsx`
- new Hermes channel helper/registry file if needed

### Main process
- `frontend/src/main/services/hermes.service.ts`

### i18n
- `frontend/src/renderer/src/i18n/index.ts`

Tests may be added if a low-friction place already exists, but the minimum expectation is verified manual persistence and startup validation.

---

## 10. Risks

### UI Density Risk

Sixteen platforms can make the Channels tab feel crowded.

Mitigation:
- keep each card compact
- only expand fields when enabled
- keep field count to the minimum required set

### External Dependency Confusion

Some channels cannot be considered fully ready from config alone.

Mitigation:
- add one-line helper copy for those channels
- keep validation language precise

### Incorrect Env Mapping Risk

The main failure mode is writing the wrong env variable names.

Mitigation:
- verify mappings against the local Hermes source before implementation
- inspect the actual written `.env` after saving
- run gateway startup validation after writing representative configs

---

## Implementation Direction

Implement the redesign as a straight replacement of the old channel schema and rendering logic.

Do not preserve legacy 4-channel assumptions. Do not add migration code. Keep the UI focused on the minimum required fields and explicit external-setup caveats.
