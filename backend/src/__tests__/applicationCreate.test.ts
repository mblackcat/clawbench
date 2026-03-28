import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { v4 as uuidv4 } from 'uuid';

/**
 * 应用创建 API 测试
 */

describe('POST /api/v1/applications - Create Application', () => {
  let app: any;
  let testUserId: string;
  let testToken: string;

  beforeAll(async () => {
    app = createApp();
    
    // 连接并初始化数据库
    await database.connect();
    await initializeSchema();
    
    // 创建测试用户
    const user = await createUser({
      username: 'testdev',
      email: 'testdev@example.com',
      password: 'password123',
    });
    testUserId = user.userId;

    // 生成测试令牌
    const tokenId = uuidv4();
    const expiresAt = calculateExpiresAt();
    testToken = generateToken({ userId: testUserId, tokenId });
    await createAuthToken(testUserId, testToken, expiresAt);
  });

  afterAll(async () => {
    // 清理测试数据
    await cleanAllTables();
    await database.close();
  });

  it('should create application with valid authentication and data', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: 'Test Application',
        description: 'A test application',
        category: 'productivity',
        metadata: { key: 'value' },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'Test Application',
      description: 'A test application',
      category: 'productivity',
      ownerId: testUserId,
      ownerName: 'testdev',
      published: false,
      downloadCount: 0,
    });
    expect(response.body.data.applicationId).toBeDefined();
    expect(response.body.data.metadata).toEqual({ key: 'value' });
  });

  it('should create application with only required fields', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: 'Minimal App',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'Minimal App',
      description: null,
      category: null,
      ownerId: testUserId,
      published: false,
      downloadCount: 0,
    });
  });

  it('should return 401 when no authentication token provided', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .send({
        name: 'Test Application',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });

  it('should return 401 when invalid token provided', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', 'Bearer invalid-token')
      .send({
        name: 'Test Application',
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should return 400 when name is missing', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        description: 'Missing name',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(response.body.error.message).toContain('name');
  });

  it('should return 400 when name is empty string', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
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
      .post('/api/v1/applications')
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
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: 'Test App',
        description: 123,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(response.body.error.message).toContain('Description');
  });

  it('should return 400 when category is not a string', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: 'Test App',
        category: 123,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(response.body.error.message).toContain('Category');
  });

  it('should return 400 when metadata is not an object', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: 'Test App',
        metadata: 'not an object',
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(response.body.error.message).toContain('Metadata');
  });

  it('should trim whitespace from name, description, and category', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        name: '  Trimmed App  ',
        description: '  Trimmed description  ',
        category: '  trimmed-category  ',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe('Trimmed App');
    expect(response.body.data.description).toBe('Trimmed description');
    expect(response.body.data.category).toBe('trimmed-category');
  });
});
