/**
 * Share landing page (server-rendered single HTML page, independent of the
 * admin-panel build).
 *
 * Behaviour:
 * 1. On load it tries `<scheme>://open-app?id=...` to bring up the desktop
 *    client (plus a manual "Open" button). The client only navigates to and
 *    previews the app — it never runs anything without the user confirming.
 * 2. If the page is not blurred / hidden within ~2.5s the client is assumed
 *    missing and the download section is shown (platform picked from the UA).
 * 3. Unknown / non-shareable apps still offer to open the workbench home.
 *
 * Every user-controlled value (app name, description, version) is HTML-escaped;
 * values embedded in the inline script go through `jsonForScript`. The page is
 * served with a nonce-based CSP so no other script can run.
 */

import type { ShareAppInfo } from './appShare.service';

export type ShareLang = 'zh' | 'en';

const TEXT: Record<ShareLang, Record<string, string>> = {
  zh: {
    pageTitle: 'ClawBench · 应用分享',
    brand: 'ClawBench',
    opening: '正在唤起 ClawBench…',
    openHint: '如果浏览器弹出"打开 ClawBench"的确认框，请选择允许。',
    openBtn: '打开工作台',
    notFound: '该应用不存在、未发布或已下线，你仍可以打开工作台浏览其它应用。',
    entryDesc: '在桌面端打开 ClawBench，运行与发布 Python 小应用。',
    noDesc: '暂无描述',
    version: '版本',
    notInstalledTitle: '未检测到 ClawBench 客户端',
    notInstalledDesc: '请先下载并安装客户端，安装完成后回到本页点击"打开工作台"。',
    downloadMac: '下载 macOS 版',
    downloadWin: '下载 Windows 版',
    recommended: '推荐',
    latest: '最新版本',
    noRelease: '暂无可下载的安装包，请联系管理员。',
    loadingRelease: '正在获取下载信息…',
    installedHint: '已安装但仍无法打开？请先手动启动一次客户端，再点击"打开工作台"。',
  },
  en: {
    pageTitle: 'ClawBench · Shared app',
    brand: 'ClawBench',
    opening: 'Opening ClawBench…',
    openHint: 'If your browser asks to open "ClawBench", please allow it.',
    openBtn: 'Open Workbench',
    notFound: 'This app does not exist or is no longer published. You can still open the workbench.',
    entryDesc: 'Open ClawBench on your desktop to run and publish Python mini-apps.',
    noDesc: 'No description',
    version: 'Version',
    notInstalledTitle: 'ClawBench was not detected',
    notInstalledDesc: 'Download and install the client, then come back and click "Open Workbench".',
    downloadMac: 'Download for macOS',
    downloadWin: 'Download for Windows',
    recommended: 'Recommended',
    latest: 'Latest version',
    noRelease: 'No installer is available yet. Please contact your administrator.',
    loadingRelease: 'Loading download options…',
    installedHint: 'Installed but still not opening? Launch the client once manually, then click "Open Workbench".',
  },
};

export function resolveLandingLang(acceptLanguage: string | undefined): ShareLang {
  const first = (acceptLanguage || '').split(',')[0].trim().toLowerCase();
  return first.startsWith('en') ? 'en' : 'zh';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for an inline <script>: escape `<`, `>`, `&` (no `</script>` / `<!--` breakout) and U+2028/2029. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** CSP for the landing page: only the nonce'd inline style/script, same-origin fetch. */
export function buildLandingCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function renderShareLandingPage(input: {
  app: ShareAppInfo | undefined;
  protocolUrl: string;
  /** Scheme prefix the auto-launch is restricted to (e.g. `clawbench`). */
  scheme: string;
  lang: ShareLang;
  nonce: string;
  /** Generic workbench entry page (no specific app). */
  entry?: boolean;
}): string {
  const t = TEXT[input.lang];
  const { app } = input;
  const nonce = escapeHtml(input.nonce);

  const appBlock = app
    ? `<div class="app">
        <div class="icon">${escapeHtml(Array.from(app.name.trim())[0] || '?')}</div>
        <div class="meta">
          <div class="name">${escapeHtml(app.name)}</div>
          ${app.version ? `<div class="ver">${t.version} ${escapeHtml(app.version)}</div>` : ''}
        </div>
      </div>
      <p class="desc">${escapeHtml(app.description || t.noDesc)}</p>`
    : input.entry
      ? `<p class="desc">${t.entryDesc}</p>`
      : `<p class="desc warn">${t.notFound}</p>`;

  return `<!doctype html>
<html lang="${input.lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(app ? `${app.name} · ${t.brand}` : t.pageTitle)}</title>
<style nonce="${nonce}">
  :root { --bg:#f5f6f8; --card:#fff; --text:#1f2329; --sub:#646a73; --border:#e4e6eb; --primary:#3370ff; --primary-text:#fff; --warn:#d46b08; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --card:#1f1f1f; --text:#e8e8e8; --sub:#a6a6a6; --border:#303030; --primary:#4c7dff; --warn:#e89a3c; }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px;
    background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .card { width:100%; max-width:440px; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:28px 24px; }
  .brand { font-size:12px; color:var(--sub); letter-spacing:.04em; margin-bottom:16px; }
  .app { display:flex; gap:12px; align-items:center; }
  .icon { width:44px; height:44px; flex:none; border-radius:10px; background:var(--primary); color:var(--primary-text);
    display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:600; }
  .name { font-size:17px; font-weight:600; word-break:break-word; }
  .ver { font-size:12px; color:var(--sub); }
  .desc { color:var(--sub); margin:12px 0 0; word-break:break-word; white-space:pre-line; }
  .desc.warn { color:var(--warn); }
  .status { margin-top:20px; font-weight:500; }
  .hint { font-size:12px; color:var(--sub); margin:4px 0 0; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:38px; padding:0 18px; border-radius:8px;
    border:1px solid var(--border); background:var(--card); color:var(--text); text-decoration:none; font-size:14px; cursor:pointer; }
  .btn.primary { background:var(--primary); border-color:var(--primary); color:var(--primary-text); }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
  #download { display:none; margin-top:24px; padding-top:20px; border-top:1px solid var(--border); }
  #download h2 { font-size:15px; margin:0 0 4px; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">${t.brand}</div>
  ${appBlock}
  <div class="status" id="status">${t.opening}</div>
  <p class="hint">${t.openHint}</p>
  <div class="actions">
    <a class="btn primary" id="open-btn" href="${escapeHtml(input.protocolUrl)}">${t.openBtn}</a>
  </div>
  <section id="download">
    <h2>${t.notInstalledTitle}</h2>
    <p class="hint">${t.notInstalledDesc}</p>
    <div id="release" class="hint">${t.loadingRelease}</div>
    <div class="actions" id="release-actions"></div>
    <p class="hint">${t.installedHint}</p>
  </section>
</main>
<script nonce="${nonce}">
(function () {
  var T = ${jsonForScript(t)};
  var PROTOCOL_URL = ${jsonForScript(input.protocolUrl)};
  var PROTOCOL = ${jsonForScript(input.scheme)};
  var fallbackTimer = null;
  var releaseLoaded = false;

  function cancelFallback() {
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }
  window.addEventListener('blur', cancelFallback);
  window.addEventListener('pagehide', cancelFallback);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelFallback(); });

  function launch() {
    cancelFallback();
    document.getElementById('status').textContent = T.opening;
    try { window.location.href = PROTOCOL_URL; } catch (e) { /* ignore */ }
    fallbackTimer = setTimeout(showDownload, 2500);
  }

  function isMac() { return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent); }

  // Only same-origin paths or http(s) URLs may become download links.
  function safeHref(url) {
    if (typeof url !== 'string') return null;
    if (url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\\\') return url;
    return /^https?:\\/\\//i.test(url) ? url : null;
  }

  function addButton(container, href, label, recommended) {
    var a = document.createElement('a');
    a.className = 'btn' + (recommended ? ' primary' : '');
    a.href = href;
    a.rel = 'noopener noreferrer';
    a.textContent = recommended ? label + ' (' + T.recommended + ')' : label;
    container.appendChild(a);
  }

  function showDownload() {
    fallbackTimer = null;
    document.getElementById('status').textContent = T.notInstalledTitle;
    document.getElementById('download').style.display = 'block';
    if (releaseLoaded) return;
    releaseLoaded = true;
    var info = document.getElementById('release');
    var actions = document.getElementById('release-actions');
    fetch('/api/v1/releases/latest', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (res) {
      var data = res && res.data;
      var latest = (data && data.latest) || {};
      var mac = latest.mac && safeHref(latest.mac.url);
      var win = latest.windows && safeHref(latest.windows.url);
      if (!mac && !win) { info.textContent = T.noRelease; return; }
      info.textContent = data.version ? (T.latest + ': ' + data.version) : '';
      var preferMac = isMac();
      var items = [];
      if (mac) items.push({ url: mac, label: T.downloadMac, rec: preferMac });
      if (win) items.push({ url: win, label: T.downloadWin, rec: !preferMac });
      items.sort(function (a, b) { return (b.rec ? 1 : 0) - (a.rec ? 1 : 0); });
      items.forEach(function (it) { addButton(actions, it.url, it.label, it.rec); });
    }).catch(function () { info.textContent = T.noRelease; });
  }

  document.getElementById('open-btn').addEventListener('click', function (e) {
    e.preventDefault();
    launch();
  });

  if (PROTOCOL_URL.indexOf(PROTOCOL + '://') === 0) launch();
})();
</script>
</body>
</html>`;
}
