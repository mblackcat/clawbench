import { generateToken, verifyToken, decodeToken, calculateExpiresAt } from '../utils/jwt';
import { JWTPayload } from '../models/authToken';

/**
 * JWT 工具函数单元测试
 */

describe('JWT Utils', () => {
  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const payload: JWTPayload = {
        userId: 'test-user-id',
        tokenId: 'test-token-id',
      };

      const token = generateToken(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const payload: JWTPayload = {
        userId: 'test-user-id',
        tokenId: 'test-token-id',
      };

      const token = generateToken(payload);
      const verified = verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(payload.userId);
      expect(verified?.tokenId).toBe(payload.tokenId);
    });

    it('should return null for invalid token', () => {
      const invalidToken = 'invalid.token.string';
      const verified = verifyToken(invalidToken);

      expect(verified).toBeNull();
    });

    it('should return null for malformed token', () => {
      const malformedToken = 'not-a-jwt-token';
      const verified = verifyToken(malformedToken);

      expect(verified).toBeNull();
    });
  });

  describe('decodeToken', () => {
    it('should decode a token without verification', () => {
      const payload: JWTPayload = {
        userId: 'test-user-id',
        tokenId: 'test-token-id',
      };

      const token = generateToken(payload);
      const decoded = decodeToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(payload.userId);
      expect(decoded?.tokenId).toBe(payload.tokenId);
    });

    it('should return null for invalid token format', () => {
      const invalidToken = 'not-a-token';
      const decoded = decodeToken(invalidToken);

      expect(decoded).toBeNull();
    });
  });

  describe('calculateExpiresAt', () => {
    it('should calculate expiration timestamp in the future', () => {
      const now = Date.now();
      const expiresAt = calculateExpiresAt();

      expect(expiresAt).toBeGreaterThan(now);
    });

    it('should calculate expiration approximately 7 days in the future', () => {
      const now = Date.now();
      const expiresAt = calculateExpiresAt();
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

      // Allow 1 second tolerance
      expect(expiresAt - now).toBeGreaterThanOrEqual(sevenDaysInMs - 1000);
      expect(expiresAt - now).toBeLessThanOrEqual(sevenDaysInMs + 1000);
    });
  });

  describe('Token round-trip', () => {
    it('should maintain payload integrity through generate and verify', () => {
      const payload: JWTPayload = {
        userId: 'user-123',
        tokenId: 'token-456',
      };

      const token = generateToken(payload);
      const verified = verifyToken(token);

      expect(verified).toEqual(expect.objectContaining(payload));
    });
  });
});
