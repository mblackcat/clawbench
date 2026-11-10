import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
  dispatchTaskHandler,
  getTaskExecutionsHandler,
  listTasksHandler,
  revokeTaskHandler,
  updateAppDispatchableHandler,
} from '../controllers/adminTaskController';

export const adminTaskRouter = Router();

adminTaskRouter.use(authenticate, requireAdmin);

adminTaskRouter.post('/tasks/dispatch', dispatchTaskHandler);
adminTaskRouter.post('/tasks/:taskId/revoke', revokeTaskHandler);
adminTaskRouter.get('/tasks', listTasksHandler);
adminTaskRouter.get('/tasks/:taskId/executions', getTaskExecutionsHandler);
adminTaskRouter.patch('/applications/:applicationId/dispatchable', updateAppDispatchableHandler);
