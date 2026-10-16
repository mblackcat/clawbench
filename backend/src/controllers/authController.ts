import { Request, Response, NextFunction } from 'express';
import { generateAuthUrl, handleCallback, refreshFeishuUserToken } from '../services/feishuAuthService';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * 飞书 OAuth 授权入口
 * GET /api/v1/auth/feishu
 * 生成飞书授权 URL 并 302 重定向
 * Query params: source=web (redirect to admin panel) | 默认 electron
 */
export async function feishuAuthorize(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      res.status(500).json({
        success: false,
        error: {
          code: 'FEISHU_NOT_CONFIGURED',
          message: 'Feishu OAuth is not configured on the server',
        },
      });
      return;
    }

    const source = req.query.source === 'web' ? 'web' : 'electron';
    const { url } = await generateAuthUrl(source);
    logger.info(`Feishu OAuth: redirecting to authorization URL (source=${source})`);
    res.redirect(url);
  } catch (error) {
    next(error);
  }
}

/**
 * 飞书 OAuth 回调
 * GET /api/v1/auth/feishu/callback
 * 处理飞书回调，成功后重定向到 clawbench:// custom protocol
 */
export async function feishuCallback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code, state, error, error_description } = req.query;
    const firstString = (v: unknown): string =>
      typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '';

    // 用户在飞书授权页取消 / 拒绝授权时，飞书会带 error(+error_description) 回调
    if (error) {
      const errMsg = firstString(error_description) || firstString(error) || '飞书授权已取消或被拒绝';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(errorHtml(`授权失败: ${errMsg}`));
      return;
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(errorHtml('缺少授权码或 state 参数，请返回客户端重试'));
      return;
    }

    const loginResponse = await handleCallback(code, state);

    // 根据 source 决定重定向目标：web → admin panel，electron → custom protocol
    if (loginResponse.source === 'web') {
      // Web admin panel: redirect to /admin/auth/callback with token
      const params = new URLSearchParams({
        token: loginResponse.token,
        userId: loginResponse.userId,
        feishuAccessToken: loginResponse.feishuAccessToken,
      });
      const redirectUrl = `/admin/auth/callback?${params.toString()}`;
      logger.info(`Feishu OAuth callback: redirecting to admin panel`);
      res.redirect(redirectUrl);
      return;
    }

    // Electron: 通过 custom protocol 将 JWT + Feishu UAT 传递给 Electron 客户端
    // appId is public (used by desktop lark-cli); app_secret never leaves the server
    const params = new URLSearchParams({
      token: loginResponse.token,
      uat: loginResponse.feishuAccessToken,
      urt: loginResponse.feishuRefreshToken,
      uexp: String(loginResponse.feishuTokenExpiresIn),
      appId: config.feishu.appId || '',
    });
    const redirectUrl = `clawbench://auth/callback?${params.toString()}`;
    logger.info(`Feishu OAuth callback successful, redirecting to custom protocol`);

    // 返回一个 HTML 页面，先尝试 custom protocol 跳转，再显示成功信息
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(successHtml(redirectUrl));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    logger.error('Feishu OAuth callback error:', error);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(errorHtml(message || 'Authentication failed'));
  }
}

/**
 * 生成成功 HTML 页面
 *
 * 浏览器打开 custom protocol 时会弹出「是否打开应用」确认框。
 * 若在用户点确认/取消前就自动关页，协议跳转会被中断导致登录失败。
 * 因此：先尝试拉起客户端，等用户在本页点「打开应用」或「关闭页面」后，
 * 才开始 3 秒自动关闭倒计时。
 */
function successHtml(redirectUrl: string): string {
  const safeUrl = JSON.stringify(redirectUrl);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>登录成功</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 420px; }
    h2 { color: #52c41a; margin-bottom: 16px; }
    p { color: #666; line-height: 1.6; }
    .hint { font-size: 13px; color: #999; margin-top: 8px; }
    .actions { margin-top: 24px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    button { cursor: pointer; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; line-height: 1.4; }
    .btn-primary { background: #1677ff; color: #fff; }
    .btn-primary:hover { background: #4096ff; }
    .btn-default { background: #f0f0f0; color: #333; }
    .btn-default:hover { background: #e0e0e0; }
    #countdown { font-size: 12px; color: #999; margin-top: 16px; min-height: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>登录成功</h2>
    <p>正在打开 ClawBench 应用…</p>
    <p class="hint">若浏览器弹出「是否打开应用」提示，请先选择<strong>打开</strong>或<strong>取消</strong>。确认后再关闭本页，避免登录中断。</p>
    <div class="actions">
      <button type="button" class="btn-primary" id="btn-open">打开应用</button>
      <button type="button" class="btn-default" id="btn-close">关闭页面</button>
    </div>
    <p id="countdown"></p>
  </div>
  <script>
    (function () {
      var redirectUrl = ${safeUrl};
      var closeTimer = null;
      var countdownTimer = null;
      var decided = false;
      var countdownEl = document.getElementById('countdown');

      function openApp() {
        try {
          window.location.href = redirectUrl;
        } catch (e) {
          console.error('Launch protocol failed:', e);
        }
      }

      function clearTimers() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      }

      function startAutoClose() {
        if (decided) return;
        decided = true;
        clearTimers();
        var remaining = 3;
        countdownEl.textContent = '本页面将在 ' + remaining + ' 秒后自动关闭，如未关闭可手动关闭';
        countdownTimer = setInterval(function () {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            countdownEl.textContent = '如页面未自动关闭，请手动关闭此标签页';
            return;
          }
          countdownEl.textContent = '本页面将在 ' + remaining + ' 秒后自动关闭，如未关闭可手动关闭';
        }, 1000);
        // Browsers block window.close() on tabs not opened by script — best-effort only.
        closeTimer = setTimeout(function () {
          try { window.close(); } catch (e) {}
        }, 3000);
      }

      document.getElementById('btn-open').addEventListener('click', function () {
        openApp();
        startAutoClose();
      });
      document.getElementById('btn-close').addEventListener('click', function () {
        startAutoClose();
        try { window.close(); } catch (e) {}
      });

      // First attempt: open client immediately so user sees the protocol prompt.
      // Do NOT auto-close until they click 打开应用 / 关闭页面.
      openApp();
    })();
  </script>
</body>
</html>`;
}

/**
 * 生成错误 HTML 页面
 */
function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>登录失败</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h2 { color: #ff4d4f; margin-bottom: 16px; }
    p { color: #666; }
    .error { color: #999; font-size: 12px; margin-top: 16px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <h2>登录失败</h2>
    <p>飞书认证过程中发生错误，请关闭此页面并重试</p>
    <p class="error">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

/**
 * 公开的平台飞书 App 信息（不含 secret）
 * GET /api/v1/auth/feishu/public-config
 * 供桌面端 lark-cli 注入 LARKSUITE_CLI_APP_ID
 */
export async function feishuPublicConfig(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.json({
      success: true,
      data: {
        appId: config.feishu.appId || '',
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * 刷新飞书 User Access Token
 * POST /api/v1/auth/feishu/refresh-token
 */
export async function feishuRefreshToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_REFRESH_TOKEN', message: 'refreshToken is required' },
      });
      return;
    }

    const result = await refreshFeishuUserToken(refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
      },
    });
  } catch (error: any) {
    logger.error('Feishu token refresh error:', error);
    res.status(401).json({
      success: false,
      error: { code: 'REFRESH_FAILED', message: error.message || 'Token refresh failed' },
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
