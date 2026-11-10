import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser, getUserById, updateUserLastLoginIp } from '../repositories/userRepository';
import * as feishuAuthService from '../services/feishuAuthService';

const app = createApp();

/** supertest connects over loopback; getClientIp normalizes ::ffff:127.0.0.1 */
const LOOPBACK = '127.0.0.1';

async function login(username: string, password: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/users/login')
    .set('X-Client-IP', '6.6.6.6')
    .set('X-Forwarded-For', '7.7.7.7')
    .send({ username, password, ...extra });
  expect(res.status).toBe(200);
  return res.body.data.token as string;
}

describe('Admin user IP + login session sync', () => {
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await cleanAllTables();
    // First registered user becomes the global admin
    const admin = await createUser({ username: 'admin', email: 'admin@example.com', password: 'password123' });
    adminId = admin.userId;
    adminToken = await login('admin', 'password123');
  });

  it('records the server-observed IP on login and ignores client-supplied IPs', async () => {
    // body `ip`, X-Client-IP and X-Forwarded-For (TRUST_PROXY off) must all be ignored
    await login('admin', 'password123', { ip: '1.2.3.4' });
    const user = await getUserById(adminId);
    expect(user?.lastLoginIp).toBe(LOOPBACK);
  });

  it('exposes lastLoginIp only in the admin user list', async () => {
    const dev = await createUser({ username: 'dev_user', email: 'dev@example.com', password: 'password123' });
    await updateUserLastLoginIp(dev.userId, '10.8.0.42');

    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const listed = res.body.data.users.find((u: any) => u.username === 'dev_user');
    expect(listed.lastLoginIp).toBe('10.8.0.42');

    // The user's own profile does not carry the IP
    const devToken = await login('dev_user', 'password123');
    const me = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${devToken}`).expect(200);
    expect(JSON.stringify(me.body)).not.toContain('lastLoginIp');

    // Non-admins cannot list users
    await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${devToken}`).expect(403);
  });

  it('filters the admin user list by IP', async () => {
    const a = await createUser({ username: 'user_a', email: 'a@example.com', password: 'password123' });
    const b = await createUser({ username: 'user_b', email: 'b@example.com', password: 'password123' });
    await updateUserLastLoginIp(a.userId, '192.0.2.5');
    await updateUserLastLoginIp(b.userId, '198.51.100.8');

    const res = await request(app)
      .get('/api/v1/admin/users?search=192.0.2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].username).toBe('user_a');
    expect(res.body.data.total).toBe(1);
  });

  it('POST /users/report-ip records the observed IP and requires auth', async () => {
    await updateUserLastLoginIp(adminId, '203.0.113.1');
    await request(app).post('/api/v1/users/report-ip').send({ ip: '9.9.9.9' }).expect(401);

    const res = await request(app)
      .post('/api/v1/users/report-ip')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ip: '9.9.9.9' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect((await getUserById(adminId))?.lastLoginIp).toBe(LOOPBACK);
  });

  it('does not bump updatedAt when only the IP changes', async () => {
    const before = (await getUserById(adminId))!.updatedAt;
    await updateUserLastLoginIp(adminId, '203.0.113.9');
    expect((await getUserById(adminId))!.updatedAt).toBe(before);
  });

  describe('POST /auth/feishu/refresh-token', () => {
    beforeEach(() => {
      jest.spyOn(feishuAuthService, 'refreshFeishuUserToken').mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 7200,
      } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('updates the IP when called with a valid JWT', async () => {
      await updateUserLastLoginIp(adminId, '203.0.113.1');
      const res = await request(app)
        .post('/api/v1/auth/feishu/refresh-token')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refreshToken: 'old', ip: '9.9.9.9' })
        .expect(200);
      expect(res.body.data.accessToken).toBe('new-access');
      expect((await getUserById(adminId))?.lastLoginIp).toBe(LOOPBACK);
    });

    it('still works anonymously without touching any user IP', async () => {
      await updateUserLastLoginIp(adminId, '203.0.113.1');
      await request(app).post('/api/v1/auth/feishu/refresh-token').send({ refreshToken: 'old' }).expect(200);
      expect((await getUserById(adminId))?.lastLoginIp).toBe('203.0.113.1');
    });
  });
});
