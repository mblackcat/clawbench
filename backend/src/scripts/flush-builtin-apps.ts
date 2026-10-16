/**
 * Builtin app version flush (server SOP: `sop.sh -flush-builtin`; also run, non-fatally,
 * at the end of `sop.sh -start` / `-restart`).
 *
 * Builtin apps have two independent distribution channels:
 *   1. bundled in the desktop installer (`frontend/builtin-apps`, effective with a new client);
 *   2. a server-side archive on the `common_apps` row (admin upload), which installed clients
 *      can pull via "update" without reinstalling the desktop app.
 *
 * This script treats `frontend/builtin-apps` in the repository as the source of truth: for
 * every app directory it reads `manifest.json`, compares the version with the one recorded in
 * `common_apps`, and when the repository is newer it packs the directory, stores the archive
 * and bumps the version (version history source = `flush-script`).
 *
 * Idempotent: up-to-date apps are skipped; app keys that are not registered in `common_apps`
 * are skipped too (register them first via the admin panel / POST /api/v1/common-apps).
 * A missing or empty source directory is a no-op (exit code 0).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { database } from '../database';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { getCommonApp, updateCommonApp } from '../repositories/commonAppRepository';
import { zipDirectory } from '../utils/zip';

export const BUILTIN_ID_PREFIX = 'com.clawbench.builtin.';

interface BuiltinManifest {
  id?: string;
  version?: string;
  name?: string;
}

export type FlushOutcome = 'updated' | 'skipped' | 'not-registered' | 'error';

export interface FlushSummary {
  sourceDir: string;
  sourceMissing: boolean;
  updated: number;
  skipped: number;
  notRegistered: number;
  error: number;
}

/** Semantic-ish version compare; > 0 means `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.');
  const pb = String(b || '0').split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0;
    const nb = parseInt(pb[i] || '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function resolveSourceDir(): string {
  const override = process.env.BUILTIN_APPS_SOURCE_DIR;
  if (override) return path.resolve(override);
  // src|dist/scripts -> backend/ -> repo root -> frontend/builtin-apps
  return path.resolve(__dirname, '../../../frontend/builtin-apps');
}

function readManifest(dir: string): BuiltinManifest | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function appKeyFromManifest(manifest: BuiltinManifest, folderName: string): string {
  const id = manifest.id || '';
  return id.startsWith(BUILTIN_ID_PREFIX) ? id.slice(BUILTIN_ID_PREFIX.length) : folderName;
}

async function flushOne(appKey: string, sourceDir: string, repoVersion: string): Promise<FlushOutcome> {
  const existing = await getCommonApp(appKey);
  if (!existing) {
    logger.warn(
      `[flush-builtin] "${appKey}" is not registered in common_apps, skipping (register it in the admin panel first)`
    );
    return 'not-registered';
  }

  if (compareVersions(repoVersion, existing.version || '0') <= 0) {
    logger.info(
      `[flush-builtin] "${appKey}" up to date (repo ${repoVersion} <= server ${existing.version || '(none)'})`
    );
    return 'skipped';
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-flush-builtin-'));
  const zipPath = path.join(tmpDir, `${appKey}-${repoVersion}.zip`);
  try {
    await zipDirectory(sourceDir, zipPath);
    const buffer = fs.readFileSync(zipPath);

    // storageService.saveFile only uses originalname/size/buffer; the rest are placeholders.
    const fakeFile = {
      fieldname: 'file',
      originalname: `${appKey}-${repoVersion}.clawbench-app`,
      encoding: '7bit',
      mimetype: 'application/zip',
      size: buffer.length,
      buffer,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as unknown as Express.Multer.File;

    const { filePath, fileSize } = await storageService.saveFile(
      fakeFile,
      `builtin-${appKey.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      repoVersion
    );

    const updated = await updateCommonApp(appKey, {
      version: repoVersion,
      filePath,
      fileSize,
      changedBy: null,
      source: 'flush-script',
    });
    if (!updated) {
      logger.error(`[flush-builtin] "${appKey}" failed to update common_apps`);
      return 'error';
    }

    if (existing.filePath && existing.filePath !== filePath) {
      await storageService.deleteFile(existing.filePath).catch(() => undefined);
    }

    logger.info(
      `[flush-builtin] "${appKey}" ${existing.version || '(none)'} -> ${repoVersion} packed and published`
    );
    return 'updated';
  } catch (err) {
    logger.error(
      `[flush-builtin] "${appKey}" pack/upload failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return 'error';
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Flushes every app directory under `sourceDir` into common_apps.
 * Assumes the database is already connected.
 */
export async function flushBuiltinApps(sourceDir: string = resolveSourceDir()): Promise<FlushSummary> {
  const summary: FlushSummary = {
    sourceDir,
    sourceMissing: false,
    updated: 0,
    skipped: 0,
    notRegistered: 0,
    error: 0,
  };

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    logger.info(`[flush-builtin] source directory not found, nothing to do: ${sourceDir}`);
    summary.sourceMissing = true;
    return summary;
  }

  // Dirent.isDirectory() is false for symlinks even when they point at a directory.
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).filter((e) => {
    if (e.name.startsWith('.')) return false;
    if (e.isDirectory()) return true;
    if (e.isSymbolicLink()) {
      try {
        return fs.statSync(path.join(sourceDir, e.name)).isDirectory();
      } catch {
        return false;
      }
    }
    return false;
  });

  if (entries.length === 0) {
    logger.info(`[flush-builtin] no app directories under ${sourceDir}, nothing to do`);
    return summary;
  }

  logger.info(
    `[flush-builtin] found ${entries.length} app dir(s) under ${sourceDir}: ${entries.map((e) => e.name).join(', ')}`
  );

  for (const entry of entries) {
    const dir = path.join(sourceDir, entry.name);
    const manifest = readManifest(dir);
    if (!manifest || !manifest.version) {
      logger.warn(`[flush-builtin] "${entry.name}" has no valid manifest.json/version, skipping`);
      summary.error++;
      continue;
    }

    const appKey = appKeyFromManifest(manifest, entry.name);
    const outcome = await flushOne(appKey, dir, manifest.version);
    if (outcome === 'updated') summary.updated++;
    else if (outcome === 'skipped') summary.skipped++;
    else if (outcome === 'not-registered') summary.notRegistered++;
    else summary.error++;
  }

  logger.info(
    `[flush-builtin] done: updated ${summary.updated}, skipped ${summary.skipped}, not registered ${summary.notRegistered}, failed ${summary.error}`
  );
  return summary;
}

async function main(): Promise<void> {
  await database.connect();
  try {
    const summary = await flushBuiltinApps();
    if (summary.error > 0) process.exitCode = 1;
  } catch (err) {
    logger.error(`[flush-builtin] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  void main();
}
