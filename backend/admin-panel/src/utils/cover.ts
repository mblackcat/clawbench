import type { ApplicationResponse, ApplicationType } from '../types';

/**
 * Resolve the display cover image for a resource.
 *
 * Priority:
 * 1. metadata.coverUrl (explicit cover for all types)
 * 2. metadata.icon (link / legacy icon field)
 * 3. For link type: auto favicon derived from metadata.url
 */
export function resolveCoverUrl(app: Pick<ApplicationResponse, 'type' | 'metadata'>): string | null {
  const meta = app.metadata || {};
  const cover = typeof meta.coverUrl === 'string' ? meta.coverUrl.trim() : '';
  if (cover) return cover;

  const icon = typeof meta.icon === 'string' ? meta.icon.trim() : '';
  if (icon) return icon;

  if (app.type === 'link') {
    const url = typeof meta.url === 'string' ? meta.url.trim() : '';
    if (url) return faviconFromUrl(url);
  }

  return null;
}

/** Whether the cover is an auto-derived favicon (not explicitly set). */
export function isAutoFavicon(app: Pick<ApplicationResponse, 'type' | 'metadata'>): boolean {
  if (app.type !== 'link') return false;
  const meta = app.metadata || {};
  const cover = typeof meta.coverUrl === 'string' ? meta.coverUrl.trim() : '';
  const icon = typeof meta.icon === 'string' ? meta.icon.trim() : '';
  if (cover || icon) return false;
  const url = typeof meta.url === 'string' ? meta.url.trim() : '';
  return !!url;
}

export function faviconFromUrl(pageUrl: string): string | null {
  try {
    const host = new URL(pageUrl).hostname;
    if (!host) return null;
    // Google s2 favicon service — reliable CDN, no CORS issues for <img>
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return null;
  }
}

export function typeColor(type: ApplicationType | string): string {
  switch (type) {
    case 'app':
      return '#3b82f6';
    case 'ai-skill':
      return '#a855f7';
    case 'prompt':
      return '#22c55e';
    case 'link':
      return '#f59e0b';
    default:
      return '#71717a';
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatNumber(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '0';
  return n.toLocaleString();
}

export function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
