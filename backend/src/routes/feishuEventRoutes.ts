import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  handleFeishuEventPayload,
  subscribeEdits,
  getRecentEdits,
} from '../services/feishuDriveEventService';
import { logger } from '../utils/logger';
import { config } from '../config';

export const feishuEventRouter = Router();

/**
 * Feishu open platform event callback (no user JWT).
 * Configure this URL on the platform app for drive file edit events.
 * Also handles URL verification challenge.
 */
feishuEventRouter.post('/callback', (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    // URL verification
    if (body.type === 'url_verification' || body.challenge) {
      res.json({ challenge: body.challenge });
      return;
    }

    // Optional encrypt token check could go here
    handleFeishuEventPayload(body);
    res.json({ code: 0 });
  } catch (err) {
    logger.error('Feishu event callback error', err);
    res.status(500).json({ code: -1, msg: 'internal error' });
  }
});

/**
 * SSE stream for authenticated desktop clients.
 * GET /api/v1/feishu/events/stream
 * Authorization: Bearer <jwt>
 */
feishuEventRouter.get('/events/stream', authenticate, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Hello
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  // Replay recent
  for (const evt of getRecentEdits()) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  const unsub = subscribeEdits((evt) => {
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch {
      /* closed */
    }
  });

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      /* closed */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsub();
  });
});

/**
 * Dev/test: publish a fake edit (non-production only)
 */
if (config.nodeEnv !== 'production') {
  feishuEventRouter.post('/events/test-publish', authenticate, (req: Request, res: Response) => {
    const token = String((req.body as { token?: string })?.token || '');
    if (!token) {
      res.status(400).json({ success: false, error: { message: 'token required' } });
      return;
    }
    handleFeishuEventPayload({ type: 'spreadsheet_edited', token });
    res.json({ success: true, data: { token } });
  });
}
