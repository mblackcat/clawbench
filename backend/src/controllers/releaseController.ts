import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { logger } from '../utils/logger';

const RELEASES_DIR = path.join(config.storage.path, 'releases');

// Ensure releases directory exists on module load
if (!fs.existsSync(RELEASES_DIR)) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  logger.info(`Created releases directory: ${RELEASES_DIR}`);
}

/**
 * Validate filename to prevent path traversal attacks
 */
function isSafeFilename(filename: string): boolean {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('..') &&
    /^[\w\-.\s]+$/.test(filename)
  );
}

/**
 * Upload release artifacts (DMG, ZIP, EXE, YML manifests, blockmap files)
 * POST /api/v1/releases/upload
 * Requires authentication. Accepts multipart/form-data with field name "files".
 */
export async function uploadReleaseHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'At least one file is required' } });
      return;
    }

    const savedFiles: { filename: string; size: number }[] = [];

    for (const file of files) {
      const filename = file.originalname;
      if (!isSafeFilename(filename)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: `Invalid filename: ${filename}` } });
        return;
      }

      const destPath = path.join(RELEASES_DIR, filename);
      await fs.promises.writeFile(destPath, file.buffer);
      savedFiles.push({ filename, size: file.size });
      logger.info(`Release artifact saved: ${filename} (${file.size} bytes) by user ${req.userId}`);
    }

    res.status(201).json({ success: true, data: { files: savedFiles } });
  } catch (error) {
    logger.error('Error uploading release:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}

/**
 * List all release files
 * GET /api/v1/releases
 * Requires authentication.
 */
export async function listReleasesHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const files = await fs.promises.readdir(RELEASES_DIR);
    const fileInfos = await Promise.all(
      files.map(async (filename) => {
        const stat = await fs.promises.stat(path.join(RELEASES_DIR, filename));
        return { filename, size: stat.size, updatedAt: stat.mtimeMs };
      })
    );

    // Sort by modification time descending
    fileInfos.sort((a, b) => b.updatedAt - a.updatedAt);

    res.json({ success: true, data: { files: fileInfos } });
  } catch (error) {
    logger.error('Error listing releases:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}

/**
 * Serve a release file (manifest YML or binary artifact)
 * GET /api/v1/releases/:filename
 * Public — no authentication required (electron-updater fetches without auth).
 */
export async function serveReleaseFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const { filename } = req.params;

    if (!isSafeFilename(filename)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
      return;
    }

    const filePath = path.join(RELEASES_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
      return;
    }

    // Set appropriate content type for manifest files
    if (filename.endsWith('.yml') || filename.endsWith('.yaml')) {
      res.setHeader('Content-Type', 'application/yaml');
    }

    res.sendFile(filename, { root: path.resolve(RELEASES_DIR) });
  } catch (error) {
    logger.error('Error serving release file:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}

/**
 * Delete a release file
 * DELETE /api/v1/releases/:filename
 * Requires authentication.
 */
export async function deleteReleaseFileHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const { filename } = req.params;

    if (!isSafeFilename(filename)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid filename' } });
      return;
    }

    const filePath = path.join(RELEASES_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
      return;
    }

    await fs.promises.unlink(filePath);
    logger.info(`Release file deleted: ${filename} by user ${req.userId}`);

    res.json({ success: true, data: { message: `${filename} deleted` } });
  } catch (error) {
    logger.error('Error deleting release file:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
}
