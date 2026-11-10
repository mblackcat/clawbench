import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getModelsHandler,
  streamChatHandler,
  generateTitleHandler,
  listSystemModelsHandler,
  reportUsageHandler,
} from '../controllers/aiController';

export const aiRouter = Router();

aiRouter.get('/models', authenticate, getModelsHandler);
aiRouter.post('/chat/stream', authenticate, streamChatHandler);
aiRouter.post('/chat/generate-title', authenticate, generateTitleHandler);
// 客户端「系统」模型分组 + 「自用」模型用量上报
aiRouter.get('/system-models', authenticate, listSystemModelsHandler);
aiRouter.post('/usage/report', authenticate, reportUsageHandler);
