import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getShareInfoHandler } from '../controllers/shareController';

export const shareRouter = Router();

/**
 * GET /api/v1/share/apps/:appId
 * Share info for a shareable app: landing page URL + client protocol URL
 */
shareRouter.get('/apps/:appId', authenticate, getShareInfoHandler);
