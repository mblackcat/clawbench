import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listMemories,
  getMemory,
  upsertMemory,
} from '../repositories/agentMemoryRepository';
import { logger } from '../utils/logger';

const VALID_FILES = ['soul.md', 'memory.md', 'user.md', 'tools.md', 'agents.md', 'stats.json'];

/**
 * GET /api/v1/agent/memory
 * List all memory files for the current user
 */
export async function listMemoriesHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const memories = await listMemories(req.userId);
    const result: Record<string, { content: string; updatedAt: number }> = {};
    for (const m of memories) {
      result[m.filename] = { content: m.content, updatedAt: m.updated_at };
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('List memories error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
}

/**
 * GET /api/v1/agent/memory/:filename
 * Read a single memory file
 */
export async function getMemoryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { filename } = req.params;
    if (!VALID_FILES.includes(filename)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE', message: `Invalid filename: ${filename}` },
      });
      return;
    }

    const memory = await getMemory(req.userId, filename);
    res.json({
      success: true,
      data: {
        filename,
        content: memory?.content || '',
        updatedAt: memory?.updated_at || null,
      },
    });
  } catch (error: any) {
    logger.error('Get memory error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
}

/**
 * PUT /api/v1/agent/memory/:filename
 * Update a memory file
 */
export async function updateMemoryHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const { filename } = req.params;
    if (!VALID_FILES.includes(filename)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE', message: `Invalid filename: ${filename}` },
      });
      return;
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CONTENT', message: 'content must be a string' },
      });
      return;
    }

    await upsertMemory(req.userId, filename, content);
    logger.info(`Updated agent memory ${filename} for user ${req.userId}`);

    res.json({ success: true, data: { filename, updated: true } });
  } catch (error: any) {
    logger.error('Update memory error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  }
}
