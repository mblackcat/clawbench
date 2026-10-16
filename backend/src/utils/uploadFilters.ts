import type { Options as MulterOptions } from 'multer';
import { AppError } from '../middleware/errorHandler';
import { ErrorCode } from '../types/api';

type FileFilter = NonNullable<MulterOptions['fileFilter']>;

/**
 * Returns true when `fileName` ends with one of `extensions` (case-insensitive).
 * Supports multi-part extensions such as `.tar.gz`.
 */
export function hasAllowedExtension(fileName: string, extensions: readonly string[]): boolean {
  const lower = fileName.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
}

/**
 * Builds a multer fileFilter that accepts a file when its extension is whitelisted,
 * or (optionally) when its MIME type is whitelisted. Rejections surface as a 400
 * INVALID_FILE_FORMAT error through the global error handler.
 */
export function createUploadFileFilter(options: {
  extensions: readonly string[];
  mimeTypes?: readonly string[];
}): FileFilter {
  const mimes = new Set((options.mimeTypes ?? []).map((m) => m.toLowerCase()));
  return (_req, file, cb) => {
    const extOk = hasAllowedExtension(file.originalname || '', options.extensions);
    const mimeOk = mimes.has((file.mimetype || '').toLowerCase());
    if (!extOk && !mimeOk) {
      cb(
        new AppError(
          ErrorCode.INVALID_FILE_FORMAT,
          `Invalid file type. Allowed: ${options.extensions.join(', ')}`
        )
      );
      return;
    }
    cb(null, true);
  };
}

/** Application / common-app package archives (.clawbench-app is a zip). */
export const APP_PACKAGE_EXTENSIONS = ['.clawbench-app', '.zip', '.tar', '.tar.gz', '.tgz', '.gz'] as const;
export const APP_PACKAGE_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/x-gtar',
  'application/gzip',
  'application/x-gzip',
] as const;

/** Desktop release artifacts, incl. electron-updater metadata (.yml) and differential (.blockmap). */
export const RELEASE_ARTIFACT_EXTENSIONS = [
  '.dmg',
  '.pkg',
  '.exe',
  '.msi',
  '.zip',
  '.tar.gz',
  '.tgz',
  '.gz',
  '.appimage',
  '.deb',
  '.rpm',
  '.yml',
  '.yaml',
  '.blockmap',
] as const;

export const appPackageFileFilter = createUploadFileFilter({
  extensions: APP_PACKAGE_EXTENSIONS,
  mimeTypes: APP_PACKAGE_MIME_TYPES,
});

/** Release uploads are matched by extension only (MIME types for installers are unreliable). */
export const releaseArtifactFileFilter = createUploadFileFilter({
  extensions: RELEASE_ARTIFACT_EXTENSIONS,
});
