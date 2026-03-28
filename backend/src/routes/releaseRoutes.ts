import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import {
  uploadReleaseHandler,
  listReleasesHandler,
  serveReleaseFileHandler,
  deleteReleaseFileHandler,
} from '../controllers/releaseController';

// Release artifacts can be large (DMG/EXE up to 500 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

export const releaseRouter = Router();

/**
 * POST /api/v1/releases/upload
 * Upload one or more release artifacts (requires auth)
 */
releaseRouter.post('/upload', authenticate, upload.array('files'), uploadReleaseHandler);

/**
 * GET /api/v1/releases
 * List all release files (requires auth)
 */
releaseRouter.get('/', authenticate, listReleasesHandler);

/**
 * GET /api/v1/releases/:filename
 * Serve a release file — public, no auth (electron-updater fetches directly)
 */
releaseRouter.get('/:filename', serveReleaseFileHandler);

/**
 * DELETE /api/v1/releases/:filename
 * Delete a release file (requires auth)
 */
releaseRouter.delete('/:filename', authenticate, deleteReleaseFileHandler);
