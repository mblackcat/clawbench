import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';

/**
 * 用户认证 API 测试
 * 测试登录、注销和获取当前用户信息的端点
 */

const app = createApp();

describe('User Authentication API', () => {
  beforeAll(async () => {
    // 连接数据库
    await database.connect();
    // 初始化数据库
    await initializeSchema();
  });

  beforeEach(async () => {
    // 清空数据库
    await cleanAllTables();
  });

  afterAll(async () => {
    await database.close();
  });

  describe('POST /api/v1/users/login', () => {
    it('should login user with valid credentials', async () => {
      // 先注册一个用户
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      // 登录
      const response = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(typeof response.body.data.token).toBe('string');
      expect(response.body.data.token.length).toBeGreaterThan(0);
    });

    it('should reject login with non-existent username', async () => {
      const response = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'nonexistent',
          password: 'password123',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login with incorrect password', async () => {
      // 先注册一个用户
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      // 使用错误密码登录
      const response = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login with missing username', async () => {
      const response = await request(app)
        .post('/api/v1/users/login')
        .send({
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
    });

    it('should reject login with missing password', async () => {
      const response = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
    });
  });

  describe('POST /api/v1/users/logout', () => {
    it('should logout user with valid token', async () => {
      // 注册并登录
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      const loginResponse = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = loginResponse.body.data.token;

      // 注销
      const response = await request(app)
        .post('/api/v1/users/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.success).toBe(true);
    });

    it('should reject logout without token', async () => {
      const response = await request(app)
        .post('/api/v1/users/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject logout with invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/users/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should invalidate token after logout', async () => {
      // 注册并登录
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      const loginResponse = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = loginResponse.body.data.token;

      // 注销
      await request(app)
        .post('/api/v1/users/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // 尝试使用已注销的令牌访问受保护资源
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('GET /api/v1/users/me', () => {
    it('should return current user info with valid token', async () => {
      // 注册并登录
      const registerResponse = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      const loginResponse = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = loginResponse.body.data.token;

      // 获取当前用户信息
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('username', 'testuser');
      expect(response.body.data).toHaveProperty('email', 'test@example.com');
      expect(response.body.data).toHaveProperty('createdAt');
      expect(response.body.data).toHaveProperty('updatedAt');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should reject request with expired token', async () => {
      // 注册并登录
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        });

      const loginResponse = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        });

      const token = loginResponse.body.data.token;

      // 注销令牌
      await request(app)
        .post('/api/v1/users/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // 尝试使用已注销的令牌
      const response = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('Authentication Flow', () => {
    it('should complete full authentication flow', async () => {
      // 1. 注册
      const registerResponse = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(registerResponse.body.success).toBe(true);
      const userId = registerResponse.body.data.userId;

      // 2. 登录
      const loginResponse = await request(app)
        .post('/api/v1/users/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.userId).toBe(userId);
      const token = loginResponse.body.data.token;

      // 3. 访问受保护资源
      const meResponse = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(meResponse.body.success).toBe(true);
      expect(meResponse.body.data.userId).toBe(userId);
      expect(meResponse.body.data.username).toBe('testuser');

      // 4. 注销
      const logoutResponse = await request(app)
        .post('/api/v1/users/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(logoutResponse.body.success).toBe(true);

      // 5. 验证令牌已失效
      await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });
});
