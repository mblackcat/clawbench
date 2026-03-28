import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { createApplication, setApplicationPublished } from '../repositories/applicationRepository';
import { Application } from 'express';

describe('Application Query API', () => {
  let app: Application;
  let testUserId: string;
  let testToken: string;
  let otherUserId: string;
  let otherToken: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
    app = createApp();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // 清理测试数据
    await cleanAllTables();

    // 创建测试用户1
    const user1 = await createUser({
      username: 'testuser1',
      email: 'test1@example.com',
      password: 'password123',
    });
    testUserId = user1.userId;

    // 登录获取令牌
    const loginRes1 = await request(app)
      .post('/api/v1/users/login')
      .send({ username: 'testuser1', password: 'password123' });
    
    if (loginRes1.body.data) {
      testToken = loginRes1.body.data.token;
    }

    // 创建测试用户2
    const user2 = await createUser({
      username: 'testuser2',
      email: 'test2@example.com',
      password: 'password123',
    });
    otherUserId = user2.userId;

    // 登录获取令牌
    const loginRes2 = await request(app)
      .post('/api/v1/users/login')
      .send({ username: 'testuser2', password: 'password123' });
    
    if (loginRes2.body.data) {
      otherToken = loginRes2.body.data.token;
    }
  });

  describe('GET /api/v1/applications', () => {
    it('should return empty list when no published applications', async () => {
      const res = await request(app).get('/api/v1/applications');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applications).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });

    it('should return only published applications', async () => {
      // 创建已发布应用
      const app1 = await createApplication(testUserId, {
        name: 'Published App',
        description: 'This is published',
      });
      await setApplicationPublished(app1.applicationId, true);

      // 创建未发布应用
      await createApplication(testUserId, {
        name: 'Unpublished App',
        description: 'This is not published',
      });

      const res = await request(app).get('/api/v1/applications');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applications).toHaveLength(1);
      expect(res.body.data.applications[0].name).toBe('Published App');
      expect(res.body.data.applications[0].published).toBe(true);
      expect(res.body.data.total).toBe(1);
    });

    it('should include owner name in response', async () => {
      const app1 = await createApplication(testUserId, {
        name: 'Test App',
      });
      await setApplicationPublished(app1.applicationId, true);

      const res = await request(app).get('/api/v1/applications');

      expect(res.status).toBe(200);
      expect(res.body.data.applications[0].ownerName).toBe('testuser1');
    });

    it('should filter by category', async () => {
      const app1 = await createApplication(testUserId, {
        name: 'Productivity App',
        category: 'productivity',
      });
      const app2 = await createApplication(testUserId, {
        name: 'Game App',
        category: 'games',
      });
      await setApplicationPublished(app1.applicationId, true);
      await setApplicationPublished(app2.applicationId, true);

      const res = await request(app)
        .get('/api/v1/applications')
        .query({ category: 'productivity' });

      expect(res.status).toBe(200);
      expect(res.body.data.applications).toHaveLength(1);
      expect(res.body.data.applications[0].name).toBe('Productivity App');
      expect(res.body.data.total).toBe(1);
    });

    it('should search by name or description', async () => {
      const app1 = await createApplication(testUserId, {
        name: 'Search Test App',
        description: 'A test application',
      });
      const app2 = await createApplication(testUserId, {
        name: 'Other App',
        description: 'Contains search keyword',
      });
      const app3 = await createApplication(testUserId, {
        name: 'Unrelated App',
        description: 'No matching keywords',
      });
      await setApplicationPublished(app1.applicationId, true);
      await setApplicationPublished(app2.applicationId, true);
      await setApplicationPublished(app3.applicationId, true);

      const res = await request(app)
        .get('/api/v1/applications')
        .query({ search: 'search' });

      expect(res.status).toBe(200);
      expect(res.body.data.applications).toHaveLength(2);
      expect(res.body.data.total).toBe(2);
    });

    it('should support pagination with limit and offset', async () => {
      // 创建5个已发布应用
      for (let i = 1; i <= 5; i++) {
        const app = await createApplication(testUserId, {
          name: `App ${i}`,
        });
        await setApplicationPublished(app.applicationId, true);
      }

      // 获取第一页（2个应用）
      const res1 = await request(app)
        .get('/api/v1/applications')
        .query({ limit: 2, offset: 0 });

      expect(res1.status).toBe(200);
      expect(res1.body.data.applications).toHaveLength(2);
      expect(res1.body.data.total).toBe(5);
      expect(res1.body.data.limit).toBe(2);
      expect(res1.body.data.offset).toBe(0);

      // 获取第二页
      const res2 = await request(app)
        .get('/api/v1/applications')
        .query({ limit: 2, offset: 2 });

      expect(res2.status).toBe(200);
      expect(res2.body.data.applications).toHaveLength(2);
      expect(res2.body.data.total).toBe(5);

      // 确保两页的应用不同
      const app1Ids = res1.body.data.applications.map((a: any) => a.applicationId);
      const app2Ids = res2.body.data.applications.map((a: any) => a.applicationId);
      expect(app1Ids).not.toEqual(app2Ids);
    });

    it('should use default pagination values', async () => {
      const res = await request(app).get('/api/v1/applications');

      expect(res.status).toBe(200);
      expect(res.body.data.limit).toBe(20);
      expect(res.body.data.offset).toBe(0);
    });

    it('should reject invalid limit', async () => {
      const res = await request(app)
        .get('/api/v1/applications')
        .query({ limit: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    });

    it('should reject limit out of range', async () => {
      const res1 = await request(app)
        .get('/api/v1/applications')
        .query({ limit: 0 });

      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .get('/api/v1/applications')
        .query({ limit: 101 });

      expect(res2.status).toBe(400);
    });

    it('should reject negative offset', async () => {
      const res = await request(app)
        .get('/api/v1/applications')
        .query({ offset: -1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/applications/:applicationId', () => {
    it('should return application detail', async () => {
      const app1 = await createApplication(testUserId, {
        name: 'Test App',
        description: 'Test description',
        category: 'productivity',
        metadata: { author: 'Test Author' },
      });

      const res = await request(app).get(`/api/v1/applications/${app1.applicationId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applicationId).toBe(app1.applicationId);
      expect(res.body.data.name).toBe('Test App');
      expect(res.body.data.description).toBe('Test description');
      expect(res.body.data.category).toBe('productivity');
      expect(res.body.data.ownerId).toBe(testUserId);
      expect(res.body.data.ownerName).toBe('testuser1');
      expect(res.body.data.metadata).toEqual({ author: 'Test Author' });
      expect(res.body.data.published).toBe(false);
      expect(res.body.data.downloadCount).toBe(0);
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
    });

    it('should return both published and unpublished applications', async () => {
      const app1 = await createApplication(testUserId, {
        name: 'Unpublished App',
      });

      const res = await request(app).get(`/api/v1/applications/${app1.applicationId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.published).toBe(false);
    });

    it('should return 404 for non-existent application', async () => {
      const res = await request(app).get('/api/v1/applications/non-existent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe('Application not found');
    });
  });

  describe('GET /api/v1/users/me/applications', () => {
    it('should return current user applications', async () => {
      // 创建用户1的应用
      await createApplication(testUserId, { name: 'User1 App 1' });
      await createApplication(testUserId, { name: 'User1 App 2' });

      // 创建用户2的应用
      await createApplication(otherUserId, { name: 'User2 App' });

      const res = await request(app)
        .get('/api/v1/users/me/applications')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applications).toHaveLength(2);
      expect(res.body.data.applications[0].ownerName).toBe('testuser1');
      expect(res.body.data.applications[1].ownerName).toBe('testuser1');
      
      const appNames = res.body.data.applications.map((a: any) => a.name);
      expect(appNames).toContain('User1 App 1');
      expect(appNames).toContain('User1 App 2');
      expect(appNames).not.toContain('User2 App');
    });

    it('should return both published and unpublished applications', async () => {
      const app1 = await createApplication(testUserId, { name: 'Published App' });
      await setApplicationPublished(app1.applicationId, true);
      
      await createApplication(testUserId, { name: 'Unpublished App' });

      const res = await request(app)
        .get('/api/v1/users/me/applications')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.applications).toHaveLength(2);
    });

    it('should return empty array when user has no applications', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/applications')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.applications).toEqual([]);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/v1/users/me/applications');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/users/me/applications')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return applications ordered by updated_at DESC', async () => {
      const app1 = await createApplication(testUserId, { name: 'App 1' });
      
      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const app2 = await createApplication(testUserId, { name: 'App 2' });

      const res = await request(app)
        .get('/api/v1/users/me/applications')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.applications).toHaveLength(2);
      // 最新的应该在前面
      expect(res.body.data.applications[0].name).toBe('App 2');
      expect(res.body.data.applications[1].name).toBe('App 1');
    });
  });
});
