import { Request, Response, NextFunction } from 'express';
import { generateAuthUrl, handleCallback, refreshFeishuUserToken } from '../services/feishuAuthService';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * 飞书 OAuth 授权入口
 * GET /api/v1/auth/feishu
 * 生成飞书授权 URL 并 302 重定向
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

    const { url } = await generateAuthUrl();
    logger.info(`Feishu OAuth: redirecting to authorization URL`);
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
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).send(errorHtml('Missing authorization code or state parameter'));
      return;
    }

    const loginResponse = await handleCallback(code as string, state as string);

    // 成功：通过 custom protocol 将 JWT + Feishu UAT 传递给 Electron 客户端
    const params = new URLSearchParams({
      token: loginResponse.token,
      uat: loginResponse.feishuAccessToken,
      urt: loginResponse.feishuRefreshToken,
      uexp: String(loginResponse.feishuTokenExpiresIn),
    });
    const redirectUrl = `clawbench://auth/callback?${params.toString()}`;
    logger.info(`Feishu OAuth callback successful, redirecting to custom protocol`);

    // 返回一个 HTML 页面，先尝试 custom protocol 跳转，再显示成功信息
    res.status(200).send(successHtml(redirectUrl));
  } catch (error: any) {
    logger.error('Feishu OAuth callback error:', error);
    res.status(400).send(errorHtml(error.message || 'Authentication failed'));
  }
}

/**
 * 生成成功 HTML 页面
 */
function successHtml(redirectUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>登录成功</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h2 { color: #52c41a; margin-bottom: 16px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2>登录成功</h2>
    <p>正在跳转到 ClawBench 应用...</p>
    <p style="font-size: 12px; color: #999; margin-top: 16px;">如果没有自动跳转，请手动返回 ClawBench 应用</p>
  </div>
  <script>
    window.location.href = ${JSON.stringify(redirectUrl)};
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
