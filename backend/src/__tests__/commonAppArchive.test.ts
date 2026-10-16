import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from '../services/storage';

/**
 * 通用应用归档上传/下载（admin 覆盖发布 builtin app）API 测试
 *
 * 覆盖核心优先级语义：admin 发布后，common_apps 携带 version + 归档，
 * 客户端据此优先取服务端版本。首个 createUser 自动获得全局 admin。
 * ClawBench 默认空种子，因此测试先通过 POST /common-apps 创建通用应用。
 */
describe('Common App Archive API (admin publish / download)', () => {
  let app: any;
  let adminToken: string;
  let userToken: string;

  async function createUserWithToken(
    username: string,
    email: string
  ): Promise<{ userId: string; token: string }> {
    const user = await createUser({ username, email, password: 'password123' });
    const tokenId = uuidv4();
    const expiresAt = calculateExpiresAt();
    const token = generateToken({ userId: user.userId, tokenId });
    await createAuthToken(user.userId, token, expiresAt);
    return { userId: user.userId, token };
  }

  beforeAll(async () => {
    app = createApp();
    await database.connect();
    await initializeSchema();
    await cleanAllTables();
    await initializeSchema();

    const admin = await createUserWithToken('arcadmin', 'arcadmin@example.com');
    adminToken = admin.token;
    const user = await createUserWithToken('arcuser', 'arcuser@example.com');
    userToken = user.token;

    for (const appKey of ['env-check', 'clean-project']) {
      const res = await request(app)
        .post('/api/v1/common-apps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appKey, name: appKey, version: '1.0.0', builtin: true });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  it('common apps report hasArchive=false before any admin publish', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    const envCheck = res.body.data.commonApps.find((a: any) => a.appKey === 'env-check');
    expect(envCheck.hasArchive).toBe(false);
  });

  it('rejects upload by non-admin (403)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .field('version', '1.0.2')
      .attach('file', Buffer.from('not-a-zip'), 'env-check.clawbench-app');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects upload with invalid version (400)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', 'not-a-version')
      .attach('file', Buffer.from('not-a-zip'), 'env-check.clawbench-app');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects upload missing file (400)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', '1.0.2');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects upload for unknown appKey (404)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps/no-such-app/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', '1.0.2')
      .attach('file', Buffer.from('not-a-zip'), 'x.clawbench-app');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  let uploadedBytes: Buffer;
  it('allows admin to publish (overwrite) an archive and bumps version', async () => {
    uploadedBytes = Buffer.from('PK-env-check-1.0.2-archive-bytes');
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', '1.0.2')
      .field('changelog', 'fix installer')
      .attach('file', uploadedBytes, 'com.clawbench.builtin.env-check-1.0.2.clawbench-app');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe('1.0.2');
    expect(res.body.data.fileSize).toBe(uploadedBytes.length);
    expect(res.body.data.commonApp).toMatchObject({ appKey: 'env-check', hasArchive: true });
  });

  it('GET /common-apps reflects the new version + hasArchive', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps')
      .set('Authorization', `Bearer ${userToken}`);
    const envCheck = res.body.data.commonApps.find((a: any) => a.appKey === 'env-check');
    expect(envCheck.version).toBe('1.0.2');
    expect(envCheck.hasArchive).toBe(true);
  });

  it('re-publishing at the same version overwrites the archive (no 409)', async () => {
    const newBytes = Buffer.from('PK-env-check-1.0.2-overwritten');
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', '1.0.2')
      .attach('file', newBytes, 'env-check-1.0.2.clawbench-app');
    expect(res.status).toBe(200);
    uploadedBytes = newBytes;
  });

  it('downloads the published archive bytes for any logged-in user', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps/env-check/download')
      .set('Authorization', `Bearer ${userToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('builtin-env-check-1.0.2.clawbench-app');
    expect(res.body).toEqual(uploadedBytes);
  });

  it('download 404 for an app without a published archive', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps/clean-project/download')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('download 404 for unknown appKey', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps/no-such-app/download')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(404);
  });

  it('records a version-history entry on publish (admin events type=version)', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps/env-check/events?type=version&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const versions = res.body.data.items.map((i: any) => i.version);
    expect(versions).toContain('1.0.2');
  });

  it('rejects disallowed file types (400 INVALID_FILE_FORMAT)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps/env-check/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', '1.0.3')
      .attach('file', Buffer.from('MZ-not-an-archive'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_FORMAT');
  });

  it('download increments download_count and records a download event', async () => {
    const before = await request(app)
      .get('/api/v1/common-apps/env-check/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const beforeCount = before.body.data.downloadCount;

    await request(app)
      .get('/api/v1/common-apps/env-check/download')
      .set('Authorization', `Bearer ${userToken}`);
    // counters are updated fire-and-forget after the response
    await new Promise((r) => setTimeout(r, 50));

    const after = await request(app)
      .get('/api/v1/common-apps/env-check/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.downloadCount).toBe(beforeCount + 1);

    const events = await request(app)
      .get('/api/v1/common-apps/env-check/events?type=download&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(events.status).toBe(200);
    expect(events.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('deleting a common app removes its archive file', async () => {
    const list = await request(app)
      .get('/api/v1/common-apps')
      .set('Authorization', `Bearer ${userToken}`);
    expect(list.body.data.commonApps.find((a: any) => a.appKey === 'env-check').hasArchive).toBe(true);

    const { getCommonApp } = await import('../repositories/commonAppRepository');
    const stored = await getCommonApp('env-check');
    expect(stored?.filePath).toBeTruthy();
    expect(await storageService.fileExists(stored!.filePath!)).toBe(true);

    const del = await request(app)
      .delete('/api/v1/common-apps/env-check')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(await storageService.fileExists(stored!.filePath!)).toBe(false);
  });
});
