import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  resolveShareApp,
  buildOpenProtocolUrl,
  buildLandingUrl,
  getClientScheme,
  type ShareAppInfo,
} from '../services/appShare.service';
import {
  renderShareLandingPage,
  resolveLandingLang,
  buildLandingCsp,
} from '../services/shareLandingPage';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * App sharing controller: share info API + public landing pages.
 */

function sendErrorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/** Public base URL of the landing page: PUBLIC_BASE_URL, else the (proxy-aware) request origin. */
function resolvePublicBaseUrl(req: Request): string {
  if (config.share.publicBaseUrl) return config.share.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Share info for an app (landing page URL + client protocol URL).
 * GET /api/v1/share/apps/:appId
 */
export async function getShareInfoHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const appId = String(req.params.appId || '').trim();
    const app = await resolveShareApp(appId);
    if (!app) {
      sendErrorResponse(res, 404, 'APP_NOT_SHAREABLE', 'App not found or not shareable');
      return;
    }
    res.status(200).json({
      success: true,
      data: {
        app,
        landingUrl: buildLandingUrl(resolvePublicBaseUrl(req), appId),
        protocolUrl: buildOpenProtocolUrl(appId),
      },
    });
  } catch (error) {
    logger.error('Error getting share info:', error);
    sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

function sendLandingPage(
  req: Request,
  res: Response,
  status: number,
  app: ShareAppInfo | undefined,
  protocolUrl: string,
  entry = false
): void {
  const nonce = randomBytes(16).toString('base64');
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', buildLandingCsp(nonce));
  res
    .status(status)
    .type('html')
    .send(
      renderShareLandingPage({
        app,
        protocolUrl,
        scheme: getClientScheme(),
        lang: resolveLandingLang(req.get('accept-language')),
        nonce,
        entry,
      })
    );
}

/**
 * Share landing page (public, no login).
 * GET /open/app/:appId
 */
export async function shareLandingPageHandler(req: Request, res: Response): Promise<void> {
  const appId = String(req.params.appId || '').trim();
  let app: ShareAppInfo | undefined;
  try {
    app = await resolveShareApp(appId);
  } catch (error) {
    logger.error('Error resolving share landing app:', error);
  }
  // Unknown / malformed ids are never reflected: fall back to opening the workbench home.
  sendLandingPage(req, res, app ? 200 : 404, app, buildOpenProtocolUrl(app ? appId : undefined));
}

/**
 * Generic workbench entry page (public, no login), e.g. an IM workbench app's desktop homepage.
 * GET /open
 */
export function workbenchLandingPageHandler(req: Request, res: Response): void {
  sendLandingPage(req, res, 200, undefined, buildOpenProtocolUrl(), true);
}
