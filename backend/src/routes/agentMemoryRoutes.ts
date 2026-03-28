import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listMemoriesHandler,
  getMemoryHandler,
  updateMemoryHandler,
} from '../controllers/agentMemoryController';

export const agentMemoryRouter = Router();

/**
 * GET /api/v1/agent/memory
 * List all memory files for current user
 */
agentMemoryRouter.get('/memory', authenticate, listMemoriesHandler);

/**
 * GET /api/v1/agent/memory/:filename
 * Read one memory file
 */
agentMemoryRouter.get('/memory/:filename', authenticate, getMemoryHandler);

/**
 * PUT /api/v1/agent/memory/:filename
 * Update one memory file
 */
agentMemoryRouter.put('/memory/:filename', authenticate, updateMemoryHandler);
