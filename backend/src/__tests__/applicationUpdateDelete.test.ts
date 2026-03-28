import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { createApplication } from '../repositories/applicationRepository';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { v4 as uuidv4 } from 'uuid';

describe('Application Update and Delete API', () => {
  const app = createApp();
  let testUserId: string;
  let otherUserId: string;
  let testToken: string;
  let otherToken: string;
  let testApplicationId: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // 清理测试数据
    await cleanAllTables();

    // 创建测试用户
    const user = await createUser({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
    });
    testUserId = user.userId;
    const testTokenId = uuidv4();
    testToken = generateToken({ userId: testUserId, tokenId: testTokenId });
    await createAuthToken(testUserId, testToken, calculateExpiresAt());

    // 创建另一个用户
    const otherUser = await createUser({
      username: 'otheruser',
      email: 'other@example.com',
      password: 'password123',
    });
    otherUserId = otherUser.userId;
    const otherTokenId = uuidv4();
    otherToken = generateToken({ userId: otherUserId, tokenId: otherTokenId });
    await createAuthToken(otherUserId, otherToken, calculateExpiresAt());

    // 创建测试应用
    const application = await createApplication(testUserId, {
      name: 'Test Application',
      description: 'Test description',
      category: 'productivity',
    });
    testApplicationId = application.applicationId;
  });

  describe('PUT /api/v1/applications/:applicationId', () => {
    it('should update application when owner makes request', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Updated Name',
          description: 'Updated description',
          category: 'tools',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Name');
      expect(response.body.data.description).toBe('Updated description');
      expect(response.body.data.category).toBe('tools');
      expect(response.body.data.applicationId).toBe(testApplicationId);
    });

    it('should update only specified fields', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Only Name Updated',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Only Name Updated');
      expect(response.body.data.description).toBe('Test description');
      expect(response.body.data.category).toBe('productivity');
    });

    it('should update metadata', async () => {
      const metadata = { version: '2.0', author: 'Updated Author' };
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          metadata,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.metadata).toEqual(metadata);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .send({
          name: 'Updated Name',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 403 when non-owner tries to update', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'Unauthorized Update',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toBe('Only application owner can perform this action');
    });

    it('should return 404 when application does not exist', async () => {
      const response = await request(app)
        .put('/api/v1/applications/non-existent-id')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Updated Name',
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when name is empty string', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: '   ',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when name is not a string', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 123,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when description is not a string', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          description: 123,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when metadata is not an object', async () => {
      const response = await request(app)
        .put(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          metadata: 'not an object',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('DELETE /api/v1/applications/:applicationId', () => {
    it('should delete application when owner makes request', async () => {
      const response = await request(app)
        .delete(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Application deleted successfully');

      // 验证应用已被删除
      const getResponse = await request(app)
        .get(`/api/v1/applications/${testApplicationId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .delete(`/api/v1/applications/${testApplicationId}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 403 when non-owner tries to delete', async () => {
      const response = await request(app)
        .delete(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toBe('Only application owner can perform this action');
    });

    it('should return 404 when application does not exist', async () => {
      const response = await request(app)
        .delete('/api/v1/applications/non-existent-id')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should not allow deleting same application twice', async () => {
      // 第一次删除
      const firstResponse = await request(app)
        .delete(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`);
      expect(firstResponse.status).toBe(200);

      // 第二次删除
      const secondResponse = await request(app)
        .delete(`/api/v1/applications/${testApplicationId}`)
        .set('Authorization', `Bearer ${testToken}`);
      expect(secondResponse.status).toBe(404);
    });
  });

  describe('Ownership verification', () => {
    it('should verify ownership correctly for update', async () => {
      // 创建另一个用户的应用
      const otherApp = await createApplication(otherUserId, {
        name: 'Other User App',
      });

      // testUser 尝试更新 otherUser 的应用
      const response = await request(app)
        .put(`/api/v1/applications/${otherApp.applicationId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          name: 'Hacked Name',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      // 验证应用未被修改
      const getResponse = await request(app)
        .get(`/api/v1/applications/${otherApp.applicationId}`);
      expect(getResponse.body.data.name).toBe('Other User App');
    });

    it('should verify ownership correctly for delete', async () => {
      // 创建另一个用户的应用
      const otherApp = await createApplication(otherUserId, {
        name: 'Other User App',
      });

      // testUser 尝试删除 otherUser 的应用
      const response = await request(app)
        .delete(`/api/v1/applications/${otherApp.applicationId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');

      // 验证应用未被删除
      const getResponse = await request(app)
        .get(`/api/v1/applications/${otherApp.applicationId}`);
      expect(getResponse.status).toBe(200);
      expect(getResponse.body.data.name).toBe('Other User App');
    });
  });
});
