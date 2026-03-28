import { config } from '../config';
import { ErrorCode, ErrorStatusMap } from '../types/api';
import { AppError } from '../middleware/errorHandler';

describe('Infrastructure Tests', () => {
  describe('Configuration', () => {
    it('should load configuration correctly', () => {
      expect(config.port).toBeDefined();
      expect(config.nodeEnv).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.jwt).toBeDefined();
      expect(config.storage).toBeDefined();
      expect(config.logging).toBeDefined();
    });

    it('should have valid port number', () => {
      expect(config.port).toBeGreaterThan(0);
      expect(config.port).toBeLessThan(65536);
    });

    it('should have JWT configuration', () => {
      expect(config.jwt.secret).toBeDefined();
      expect(config.jwt.expiresIn).toBeDefined();
    });
  });

  describe('Error Response Format', () => {
    it('should create AppError with correct structure', () => {
      const error = new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Test error message',
        { field: 'test' }
      );

      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.message).toBe('Test error message');
      expect(error.details).toEqual({ field: 'test' });
    });

    it('should map error codes to correct HTTP status codes', () => {
      expect(ErrorStatusMap[ErrorCode.INVALID_CREDENTIALS]).toBe(401);
      expect(ErrorStatusMap[ErrorCode.PERMISSION_DENIED]).toBe(403);
      expect(ErrorStatusMap[ErrorCode.VALIDATION_ERROR]).toBe(400);
      expect(ErrorStatusMap[ErrorCode.NOT_FOUND]).toBe(404);
      expect(ErrorStatusMap[ErrorCode.ALREADY_EXISTS]).toBe(409);
      expect(ErrorStatusMap[ErrorCode.INTERNAL_ERROR]).toBe(500);
    });

    it('should have all error codes mapped to status codes', () => {
      const errorCodes = Object.values(ErrorCode);
      errorCodes.forEach((code) => {
        expect(ErrorStatusMap[code]).toBeDefined();
        expect(ErrorStatusMap[code]).toBeGreaterThanOrEqual(400);
        expect(ErrorStatusMap[code]).toBeLessThan(600);
      });
    });
  });

  describe('Error Code Categories', () => {
    it('should have authentication error codes (401)', () => {
      const authErrors = [
        ErrorCode.INVALID_CREDENTIALS,
        ErrorCode.TOKEN_EXPIRED,
        ErrorCode.INVALID_TOKEN,
        ErrorCode.AUTH_REQUIRED,
      ];

      authErrors.forEach((code) => {
        expect(ErrorStatusMap[code]).toBe(401);
      });
    });

    it('should have authorization error codes (403)', () => {
      const authzErrors = [
        ErrorCode.PERMISSION_DENIED,
        ErrorCode.NOT_OWNER,
      ];

      authzErrors.forEach((code) => {
        expect(ErrorStatusMap[code]).toBe(403);
      });
    });

    it('should have validation error codes (400)', () => {
      const validationErrors = [
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.MISSING_FIELD,
        ErrorCode.INVALID_TYPE,
        ErrorCode.INVALID_VALUE,
        ErrorCode.INVALID_FILE_FORMAT,
      ];

      validationErrors.forEach((code) => {
        expect(ErrorStatusMap[code]).toBe(400);
      });
    });

    it('should have server error codes (500)', () => {
      const serverErrors = [
        ErrorCode.DATABASE_ERROR,
        ErrorCode.FILE_SYSTEM_ERROR,
        ErrorCode.INTERNAL_ERROR,
      ];

      serverErrors.forEach((code) => {
        expect(ErrorStatusMap[code]).toBe(500);
      });
    });
  });
});
