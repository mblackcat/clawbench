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

  it('should create application with specified applicationId (manifest ID)', async () => {
    const customId = 'cb.testdev.data-analyzer';
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ applicationId: customId, name: 'Data Analyzer', description: 'Analyzes data' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationId).toBe(customId);
    expect(response.body.data.name).toBe('Data Analyzer');
  });

  it('should accept `id` as an alias for applicationId and trim it', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ id: '  cb.testdev.alias_app-1  ', name: 'Alias App', type: 'ai-skill' });

    expect(response.status).toBe(201);
    expect(response.body.data.applicationId).toBe('cb.testdev.alias_app-1');
    // multi-type support is preserved
    expect(response.body.data.type).toBe('ai-skill');
  });

  it('should fall back to a uuid when no applicationId is given', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Uuid App' });

    expect(response.status).toBe(201);
    expect(response.body.data.applicationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('should reject creating application with duplicate applicationId', async () => {
    const duplicateId = 'cb.testdev.duplicate-app';
    const first = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ applicationId: duplicateId, name: 'First App' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ applicationId: duplicateId, name: 'Second App' });
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('should reject invalid applicationId formats', async () => {
    for (const badId of ['invalid id with spaces!', '..', '.hidden', '../escape', 'a/b', '', '   ', 'x'.repeat(256), 123]) {
      const response = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ applicationId: badId, name: 'Invalid ID App' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('should accept free-text categories (no whitelist)', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ name: 'Free Category App', category: 'productivity' });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe('productivity');
  });

  describe('POST /api/v1/applications/:id/executions', () => {
    let execAppId: string;

    beforeEach(async () => {
      const created = await request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ name: 'Exec App' });
      execAppId = created.body.data.applicationId;
    });

    async function errorCount(): Promise<number> {
      const row = await database.get<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM application_execution_errors WHERE application_id = ?',
        [execAppId]
      );
      return Number(row?.cnt ?? 0);
    }

    it('records a failure with an error log', async () => {
      const res = await request(app)
        .post(`/api/v1/applications/${execAppId}/executions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ success: false, errorMessage: 'boom', version: '1.0.0' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ recorded: true, cancelled: false });
      expect(await errorCount()).toBe(1);
    });

    it('records a cancelled run without an error log and echoes cancelled', async () => {
      const res = await request(app)
        .post(`/api/v1/applications/${execAppId}/executions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ success: false, cancelled: true, errorMessage: 'cancelled by user' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ recorded: true, cancelled: true });
      expect(await errorCount()).toBe(0);

      const row = await database.get<{ execution_count: number }>(
        'SELECT execution_count FROM applications WHERE application_id = ?',
        [execAppId]
      );
      expect(Number(row?.execution_count)).toBe(1);
    });
  });
});
