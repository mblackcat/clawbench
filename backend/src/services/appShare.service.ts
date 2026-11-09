/**
 * App sharing service.
 *
 * Flow: desktop "Share" → copy a link to the public landing page
 * (`/open/app/:appId`) → paste it into any browser / IM (e.g. Feishu, Slack)
 * → the landing page tries `<scheme>://open-app?id=...` to bring up the
 * desktop client, and offers the installer download when nothing answers.
 *
 * Only apps the backend knows and that a recipient could actually install are
 * shareable: published marketplace apps (type `app`) and enabled builtin
 * common apps. Anything else resolves to `undefined` and is never reflected.
 */

import { config } from '../config';
import { getApplicationById } from '../repositories/applicationRepository';
import { getCommonApp } from '../repositories/commonAppRepository';
import { getLatestVersion } from '../repositories/applicationVersionRepository';

export const BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.';

/** Same charset as manifest / application ids; keeps ids safe to embed in URLs and HTML. */
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type ShareAppKind = 'market' | 'builtin';

export interface ShareAppInfo {
  appId: string;
  name: string;
  description: string | null;
  version: string | null;
  kind: ShareAppKind;
}

export function isValidShareAppId(appId: string): boolean {
  return APP_ID_PATTERN.test(appId);
}

/** Desktop client URL scheme (configurable via SHARE_CLIENT_SCHEME). */
export function getClientScheme(): string {
  return config.share.clientScheme;
}

/**
 * Resolve a shareable app: a published marketplace app or an enabled builtin.
 * Drafts, unpublished / disabled apps and non-`app` resources return undefined.
 */
export async function resolveShareApp(appId: string): Promise<ShareAppInfo | undefined> {
  if (!isValidShareAppId(appId)) return undefined;

  if (appId.startsWith(BUILTIN_APP_ID_PREFIX)) {
    const appKey = appId.slice(BUILTIN_APP_ID_PREFIX.length);
    const common = appKey ? await getCommonApp(appKey) : undefined;
    if (!common || !common.enabled) return undefined;
    return {
      appId,
      name: common.name,
      description: common.description,
      version: common.version,
      kind: 'builtin',
    };
  }

  const application = await getApplicationById(appId);
  if (!application || !application.published || application.type !== 'app') return undefined;
  const latest = await getLatestVersion(appId);
  return {
    appId,
    name: application.name,
    description: application.description,
    version: latest?.version ?? null,
    kind: 'market',
  };
}

/** Client protocol URL, handled by the desktop `open-app` command (navigate + preview, never run). */
export function buildOpenProtocolUrl(appId?: string): string {
  const base = `${getClientScheme()}://open-app`;
  return appId ? `${base}?id=${encodeURIComponent(appId)}` : base;
}

/** Landing page URL; `baseUrl` has no trailing slash. */
export function buildLandingUrl(baseUrl: string, appId: string): string {
  return `${baseUrl}/open/app/${encodeURIComponent(appId)}`;
}
