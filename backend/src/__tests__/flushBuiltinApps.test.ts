import fs from 'fs';
import os from 'os';
import path from 'path';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createCommonApp, getCommonApp, listCommonAppVersionHistory } from '../repositories/commonAppRepository';
import { flushBuiltinApps, compareVersions } from '../scripts/flush-builtin-apps';
import { storageService } from '../services/storage';
import { readZipEntry } from '../utils/zip';

describe('flush-builtin-apps script', () => {
  let sourceDir: string;

  function writeApp(folder: string, manifest: Record<string, unknown>): void {
    const dir = path.join(sourceDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, 'main.py'), 'print("builtin")');
  }

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  beforeEach(async () => {
    await cleanAllTables();
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-builtin-apps-'));
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  it('is a no-op when the source directory is missing', async () => {
    const summary = await flushBuiltinApps(path.join(sourceDir, 'does-not-exist'));
    expect(summary.sourceMissing).toBe(true);
    expect(summary).toMatchObject({ updated: 0, skipped: 0, notRegistered: 0, error: 0 });
  });

  it('is a no-op when the source directory is empty', async () => {
    const summary = await flushBuiltinApps(sourceDir);
    expect(summary.sourceMissing).toBe(false);
    expect(summary).toMatchObject({ updated: 0, skipped: 0, notRegistered: 0, error: 0 });
  });

  it('publishes newer repo versions, skips up-to-date and unregistered apps', async () => {
    await createCommonApp({ appKey: 'clean-workspace', name: 'Clean', version: '1.0.0', builtin: true });
    await createCommonApp({ appKey: 'same-version', name: 'Same', version: '2.0.0', builtin: true });

    writeApp('clean-workspace', { id: 'com.clawbench.builtin.clean-workspace', version: '1.1.0' });
    writeApp('same-version', { id: 'com.clawbench.builtin.same-version', version: '2.0.0' });
    writeApp('unregistered', { id: 'com.clawbench.builtin.unregistered', version: '1.0.0' });
    writeApp('broken', {});

    const summary = await flushBuiltinApps(sourceDir);
    expect(summary).toMatchObject({ updated: 1, skipped: 1, notRegistered: 1, error: 1 });

    const updated = await getCommonApp('clean-workspace');
    expect(updated?.version).toBe('1.1.0');
    expect(updated?.filePath).toBeTruthy();
    const archive = await storageService.readFile(updated!.filePath!);
    expect(JSON.parse(readZipEntry(archive, 'manifest.json')!).version).toBe('1.1.0');

    const history = await listCommonAppVersionHistory('clean-workspace', 10, 0);
    expect(history.items.some((h: any) => h.version === '1.1.0' && h.source === 'flush-script')).toBe(true);

    // second run is idempotent
    const again = await flushBuiltinApps(sourceDir);
    expect(again.updated).toBe(0);

    await storageService.deleteFile(updated!.filePath!);
  });
});
