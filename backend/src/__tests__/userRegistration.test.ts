import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';

describe('User Registration API', () => {
  const app = createApp();

  beforeAll(async () => {
    // 连接数据库
    await database.connect();
    // 初始化数据库
    await initializeSchema();
  });

  beforeEach(async () => {
    // 清空数据
    await cleanAllTables();
  });

  afterAll(async () => {
    // 关闭数据库连接
    await database.close();
  });

  describe('POST /api/v1/users/register', () => {
    it('should register a new user with valid input', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data.username).toBe('testuser');
      expect(response.body.data.email).toBe('test@example.com');
      expect(response.body.data).toHaveProperty('createdAt');
      expect(response.body.data).toHaveProperty('updatedAt');
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(response.body.data).not.toHaveProperty('password');
    });

    it('should reject registration with missing username', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors).toContain('Username is required');
    });

    it('should allow registration without email', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('testuser');
    });

    it('should reject registration with missing password', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors).toContain('Password is required');
    });

    it('should reject registration with invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'invalid-email',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors).toContain('Invalid email format');
    });

    it('should reject registration with short username', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'ab',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors[0]).toContain('Username must be 3-30 characters');
    });

    it('should reject registration with long username', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'a'.repeat(31),
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with invalid username characters', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'test user!',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'short',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.errors).toContain('Password must be at least 8 characters');
    });

    it('should reject registration with duplicate username', async () => {
      // 先注册一个用户
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test1@example.com',
          password: 'password123',
        })
        .expect(201);

      // 尝试使用相同用户名注册
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test2@example.com',
          password: 'password123',
        })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ALREADY_EXISTS');
      expect(response.body.error.message).toBe('Username already exists');
      expect(response.body.error.details.field).toBe('username');
    });

    it('should reject registration with duplicate email', async () => {
      // 先注册一个用户
      await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser1',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      // 尝试使用相同邮箱注册
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser2',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ALREADY_EXISTS');
      expect(response.body.error.message).toBe('Email already exists');
      expect(response.body.error.details.field).toBe('email');
    });

    it('should accept valid username with underscores and hyphens', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'test_user-123',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('test_user-123');
    });

    it('should accept minimum valid username length', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'abc',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('abc');
    });

    it('should accept minimum valid password length', async () => {
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: '12345678',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('should generate unique user IDs for different users', async () => {
      const response1 = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser1',
          email: 'test1@example.com',
          password: 'password123',
        })
        .expect(201);

      const response2 = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser2',
          email: 'test2@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(response1.body.data.userId).not.toBe(response2.body.data.userId);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const beforeTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/users/register')
        .send({
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(201);

      const afterTime = Date.now();

      expect(response.body.data.createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(response.body.data.createdAt).toBeLessThanOrEqual(afterTime);
      expect(response.body.data.updatedAt).toBe(response.body.data.createdAt);
    });
  });
});
