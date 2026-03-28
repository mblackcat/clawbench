import { v4 as uuidv4 } from 'uuid';
import {
  createAuthToken,
  getAuthTokenByToken,
  getAuthTokenById,
  invalidateToken,
  invalidateUserTokens,
  isTokenValid,
  cleanupExpiredTokens,
} from '../repositories/authTokenRepository';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';

/**
 * 认证令牌仓库单元测试
 */

describe('AuthToken Repository', () => {
  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // 清空令牌表
    await cleanAllTables();
  });

  describe('createAuthToken', () => {
    it('should create a new auth token', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      const authToken = await createAuthToken(userId, token, expiresAt);

      expect(authToken).toBeDefined();
      expect(authToken.tokenId).toBeDefined();
      expect(authToken.userId).toBe(userId);
      expect(authToken.token).toBe(token);
      expect(authToken.expiresAt).toBe(expiresAt);
      expect(authToken.invalidated).toBe(false);
    });
  });

  describe('getAuthTokenByToken', () => {
    it('should retrieve token by token string', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      await createAuthToken(userId, token, expiresAt);
      const retrieved = await getAuthTokenByToken(token);

      expect(retrieved).toBeDefined();
      expect(retrieved?.token).toBe(token);
      expect(retrieved?.userId).toBe(userId);
    });

    it('should return undefined for non-existent token', async () => {
      const retrieved = await getAuthTokenByToken('non-existent-token');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAuthTokenById', () => {
    it('should retrieve token by token ID', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      const created = await createAuthToken(userId, token, expiresAt);
      const retrieved = await getAuthTokenById(created.tokenId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.tokenId).toBe(created.tokenId);
      expect(retrieved?.token).toBe(token);
    });

    it('should return undefined for non-existent token ID', async () => {
      const retrieved = await getAuthTokenById(uuidv4());
      expect(retrieved).toBeUndefined();
    });
  });

  describe('invalidateToken', () => {
    it('should invalidate a token', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      await createAuthToken(userId, token, expiresAt);
      const success = await invalidateToken(token);

      expect(success).toBe(true);

      const retrieved = await getAuthTokenByToken(token);
      expect(retrieved?.invalidated).toBe(true);
    });

    it('should return false for non-existent token', async () => {
      const success = await invalidateToken('non-existent-token');
      expect(success).toBe(false);
    });
  });

  describe('invalidateUserTokens', () => {
    it('should invalidate all tokens for a user', async () => {
      const userId = uuidv4();
      const token1 = 'test-jwt-token-1';
      const token2 = 'test-jwt-token-2';
      const expiresAt = Date.now() + 1000000;

      await createAuthToken(userId, token1, expiresAt);
      await createAuthToken(userId, token2, expiresAt);

      const count = await invalidateUserTokens(userId);
      expect(count).toBe(2);

      const retrieved1 = await getAuthTokenByToken(token1);
      const retrieved2 = await getAuthTokenByToken(token2);

      expect(retrieved1?.invalidated).toBe(true);
      expect(retrieved2?.invalidated).toBe(true);
    });

    it('should return 0 for user with no tokens', async () => {
      const count = await invalidateUserTokens(uuidv4());
      expect(count).toBe(0);
    });
  });

  describe('isTokenValid', () => {
    it('should return true for valid token', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      await createAuthToken(userId, token, expiresAt);
      const isValid = await isTokenValid(token);

      expect(isValid).toBe(true);
    });

    it('should return false for invalidated token', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() + 1000000;

      await createAuthToken(userId, token, expiresAt);
      await invalidateToken(token);

      const isValid = await isTokenValid(token);
      expect(isValid).toBe(false);
    });

    it('should return false for expired token', async () => {
      const userId = uuidv4();
      const token = 'test-jwt-token';
      const expiresAt = Date.now() - 1000; // Expired

      await createAuthToken(userId, token, expiresAt);
      const isValid = await isTokenValid(token);

      expect(isValid).toBe(false);
    });

    it('should return false for non-existent token', async () => {
      const isValid = await isTokenValid('non-existent-token');
      expect(isValid).toBe(false);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens', async () => {
      const userId = uuidv4();
      const expiredToken = 'expired-token';
      const validToken = 'valid-token';
      const pastTime = Date.now() - 1000;
      const futureTime = Date.now() + 1000000;

      await createAuthToken(userId, expiredToken, pastTime);
      await createAuthToken(userId, validToken, futureTime);

      const count = await cleanupExpiredTokens();
      expect(count).toBe(1);

      const expiredRetrieved = await getAuthTokenByToken(expiredToken);
      const validRetrieved = await getAuthTokenByToken(validToken);

      expect(expiredRetrieved).toBeUndefined();
      expect(validRetrieved).toBeDefined();
    });

    it('should return 0 when no expired tokens exist', async () => {
      const userId = uuidv4();
      const token = 'valid-token';
      const futureTime = Date.now() + 1000000;

      await createAuthToken(userId, token, futureTime);

      const count = await cleanupExpiredTokens();
      expect(count).toBe(0);
    });
  });
});
