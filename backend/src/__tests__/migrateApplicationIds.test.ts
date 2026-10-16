import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { createApplication } from '../repositories/applicationRepository';
import { createApplicationVersion } from '../repositories/applicationVersionRepository';
import { createExecutionError } from '../repositories/applicationExecutionErrorRepository';
import { runMigration } from '../scripts/migrate-application-ids';
import { config } from '../config';

describe('Application ID Migration Script', () => {
  const testStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-migrate-uploads-'));
  const origStoragePath = config.storage.path;

  beforeAll(async () => {
    config.storage.path = testStorageDir;
    await database.connect();
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
    await initializeSchema();
  });

  afterAll(async () => {
    config.storage.path = origStoragePath;
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
    await cleanAllTables();
    await database.close();
  });

  // runMigration prints a human-readable plan; keep test output quiet
  let logSpy: jest.SpyInstance;
  beforeAll(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => {
    logSpy.mockRestore();
  });

  beforeEach(async () => {
    await cleanAllTables();
  });

  // Helper to create a zip file with manifest.json
  async function createTestZip(destPath: string, manifest: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destPath);
      const archive = archiver('zip');
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
      archive.append('print("hello world")', { name: 'main.py' });
      void archive.finalize();
    });
  }

  it('dry-run should plan changes without modifying database or files', async () => {
    const user = await createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });

    const app = await createApplication(user.userId, {
      name: 'Data Cleaner',
    });

    // Create a zip with manifest.json id: cb.alice.data-cleaner
    const zipPath = path.join(testStorageDir, app.applicationId, '1.0.0.zip');
    await createTestZip(zipPath, {
      id: 'cb.alice.data-cleaner',
      name: 'Data Cleaner',
      version: '1.0.0',
    });

    await createApplicationVersion({
      applicationId: app.applicationId,
      version: '1.0.0',
      filePath: path.join(app.applicationId, '1.0.0.zip'),
      fileSize: 100,
    });

    const result = await runMigration({ apply: false });

    expect(result.total).toBe(1);
    expect(result.plans.length).toBe(1);
    expect(result.plans[0].newId).toBe('cb.alice.data-cleaner');
    expect(result.plans[0].source).toBe('manifest-zip');

    // Database row should still have original applicationId
    const dbApp = await database.get<{ application_id: string }>(
      'SELECT application_id FROM applications WHERE name = ?',
      ['Data Cleaner']
    );
    expect(dbApp?.application_id).toBe(app.applicationId);
  });

  it('should apply migration using manifest.id from uploaded zip and repoint child tables', async () => {
    const user = await createUser({
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
    });

    const app = await createApplication(user.userId, {
      name: 'Log Parser',
      description: 'Parses logs',
    });

    const oldZipRelPath = path.join(app.applicationId, '1.0.0_test.zip');
    const oldZipFullPath = path.join(testStorageDir, oldZipRelPath);
    await createTestZip(oldZipFullPath, {
      id: 'cb.bob.log-parser',
      name: 'Log Parser',
      version: '1.0.0',
    });

    const version = await createApplicationVersion({
      applicationId: app.applicationId,
      version: '1.0.0',
      filePath: oldZipRelPath,
      fileSize: 200,
    });

    await createExecutionError({
      applicationId: app.applicationId,
      userId: user.userId,
      version: '1.0.0',
      message: 'Test error',
    });

    // Run real migration
    const result = await runMigration({ apply: true });

    expect(result.migrated).toBe(1);
    expect(result.plans[0].newId).toBe('cb.bob.log-parser');

    // 1. applications table should have new ID, old ID should be gone
    const oldAppRow = await database.get(
      'SELECT * FROM applications WHERE application_id = ?',
      [app.applicationId]
    );
    expect(oldAppRow).toBeUndefined();

    const newAppRow = await database.get<{ application_id: string; name: string }>(
      'SELECT * FROM applications WHERE application_id = ?',
      ['cb.bob.log-parser']
    );
    expect(newAppRow).toBeDefined();
    expect(newAppRow?.name).toBe('Log Parser');

    // 2. application_versions table should be updated to new ID
    const updatedVersion = await database.get<{ application_id: string; file_path: string }>(
      'SELECT application_id, file_path FROM application_versions WHERE version_id = ?',
      [version.versionId]
    );
    expect(updatedVersion?.application_id).toBe('cb.bob.log-parser');
    expect(updatedVersion?.file_path).toContain('cb.bob.log-parser');

    // 3. application_execution_errors table should be updated to new ID
    const updatedError = await database.get<{ application_id: string }>(
      'SELECT application_id FROM application_execution_errors WHERE application_id = ?',
      ['cb.bob.log-parser']
    );
    expect(updatedError?.application_id).toBe('cb.bob.log-parser');

    // 4. File directory should be renamed
    const newDir = path.join(testStorageDir, 'cb.bob.log-parser');
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('should handle collision by appending suffix numbers', async () => {
    const user = await createUser({
      username: 'carol',
      email: 'carol@example.com',
      password: 'password123',
    });

    // App 1 with manifest.id cb.carol.tool
    const app1 = await createApplication(user.userId, { name: 'Tool 1' });
    const zipPath1 = path.join(testStorageDir, app1.applicationId, '1.0.0.zip');
    await createTestZip(zipPath1, { id: 'cb.carol.tool', name: 'Tool', version: '1.0.0' });
    await createApplicationVersion({
      applicationId: app1.applicationId,
      version: '1.0.0',
      filePath: path.join(app1.applicationId, '1.0.0.zip'),
      fileSize: 100,
    });

    // App 2 with colliding manifest.id cb.carol.tool
    const app2 = await createApplication(user.userId, { name: 'Tool 2' });
    const zipPath2 = path.join(testStorageDir, app2.applicationId, '1.0.0.zip');
    await createTestZip(zipPath2, { id: 'cb.carol.tool', name: 'Tool', version: '1.0.0' });
    await createApplicationVersion({
      applicationId: app2.applicationId,
      version: '1.0.0',
      filePath: path.join(app2.applicationId, '1.0.0.zip'),
      fileSize: 100,
    });

    const result = await runMigration({ apply: true });

    expect(result.migrated).toBe(2);
    const newIds = result.plans.map((p) => p.newId);
    expect(newIds).toEqual(['cb.carol.tool', 'cb.carol.tool-2']);

    const check1 = await database.get(
      'SELECT * FROM applications WHERE application_id = ?',
      ['cb.carol.tool']
    );
    const check2 = await database.get(
      'SELECT * FROM applications WHERE application_id = ?',
      ['cb.carol.tool-2']
    );
    expect(check1).toBeDefined();
    expect(check2).toBeDefined();
  });

  it('should fallback to cb.{username}.{slug} when application has no versions', async () => {
    const user = await createUser({
      username: 'dave',
      email: 'dave@example.com',
      password: 'password123',
    });

    const app = await createApplication(user.userId, {
      name: 'Custom Analyzer',
    });

    const result = await runMigration({ apply: true });

    expect(result.migrated).toBe(1);
    expect(result.plans[0].newId).toBe('cb.dave.custom-analyzer');
    expect(result.plans[0].source).toBe('derived');

    const newApp = await database.get<{ application_id: string }>(
      'SELECT application_id FROM applications WHERE application_id = ?',
      ['cb.dave.custom-analyzer']
    );
    expect(newApp?.application_id).toBe('cb.dave.custom-analyzer');
  });

  it('should skip applications whose application_id is already compliant', async () => {
    const user = await createUser({
      username: 'eve',
      email: 'eve@example.com',
      password: 'password123',
    });

    // Create app directly with manifest ID
    await createApplication(user.userId, {
      applicationId: 'cb.eve.already-good',
      name: 'Already Good',
    });

    const result = await runMigration({ apply: true });

    expect(result.total).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.migrated).toBe(0);
  });

  it('ignores an invalid manifest.id and derives a safe ID instead', async () => {
    const user = await createUser({
      username: 'mallory',
      email: 'mallory@example.com',
      password: 'password123',
    });
    const app = await createApplication(user.userId, { name: 'Sneaky App' });
    const zipRel = path.join(app.applicationId, '1.0.0.zip');
    await createTestZip(path.join(testStorageDir, zipRel), { id: '../../etc', version: '1.0.0' });
    await createApplicationVersion({
      applicationId: app.applicationId,
      version: '1.0.0',
      filePath: zipRel,
      fileSize: 100,
    });

    const result = await runMigration({ apply: false });
    expect(result.plans[0].newId).toBe('cb.mallory.sneaky-app');
    expect(result.plans[0].source).toBe('derived');
  });
});
