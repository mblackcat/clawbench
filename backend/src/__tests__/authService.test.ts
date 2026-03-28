import { loginUser, logoutUser } from '../services/authService';
import { createUser } from '../repositories/userRepository';
import { getAuthTokenByToken } from '../repositories/authTokenRepository';
import { initializeSchema } from '../database/schema';
import { database } from '../database';
import { cleanAllTables } from './helpers/db-cleanup';

/**
 * 认证服务单元测试
 */

describe('Auth Service', () => {
  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await cleanAllTables();
  });

  describe('loginUser', () => {
    it('should login user with valid credentials', async () => {
      const user = await createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      const result = await loginUser('testuser', 'password123');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(user.userId);
      expect(result?.token).toBeDefined();
      expect(result?.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should return null for non-existent username', async () => {
      const result = await loginUser('nonexistent', 'password123');
      expect(result).toBeNull();
    });

    it('should return null for incorrect password', async () => {
      await createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      const result = await loginUser('testuser', 'wrongpassword');
      expect(result).toBeNull();
    });

    it('should create token in database', async () => {
      await createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      const result = await loginUser('testuser', 'password123');
      expect(result).not.toBeNull();

      const tokenInDb = await getAuthTokenByToken(result!.token);
      expect(tokenInDb).toBeDefined();
      expect(tokenInDb?.userId).toBe(result!.userId);
    });
  });

  describe('logoutUser', () => {
    it('should logout user and invalidate token', async () => {
      const user = await createUser({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      const loginResult = await loginUser('testuser', 'password123');
      expect(loginResult).not.toBeNull();

      const logoutSuccess = await logoutUser(loginResult!.token);
      expect(logoutSuccess).toBe(true);

      const tokenInDb = await getAuthTokenByToken(loginResult!.token);
      expect(tokenInDb?.invalidated).toBe(true);
    });

    it('should return false for non-existent token', async () => {
      const success = await logoutUser('non-existent-token');
      expect(success).toBe(false);
    });
  });
});
