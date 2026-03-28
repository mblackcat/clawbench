import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getModelsHandler, streamChatHandler, generateTitleHandler } from '../controllers/aiController';

export const aiRouter = Router();

aiRouter.get('/models', authenticate, getModelsHandler);
aiRouter.post('/chat/stream', authenticate, streamChatHandler);
aiRouter.post('/chat/generate-title', authenticate, generateTitleHandler);
