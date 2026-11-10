import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { registerClientSSE } from '../services/clientEvents.service';
import {
  heartbeatHandler,
  pullTasksHandler,
  reportHandler,
  updateStatusHandler,
} from '../controllers/clientTaskController';

export const clientRouter = Router();

clientRouter.get('/events', authenticate, (req: AuthRequest, res) => {
  registerClientSSE(req.userId!, req, res);
});

clientRouter.post('/tasks/pull', authenticate, pullTasksHandler);
clientRouter.post('/tasks/:taskId/status', authenticate, updateStatusHandler);
clientRouter.post('/tasks/:taskId/heartbeat', authenticate, heartbeatHandler);
clientRouter.post('/tasks/:taskId/report', authenticate, reportHandler);
