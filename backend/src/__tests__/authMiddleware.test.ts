import { Request, Response } from 'express';
import { authenticate, optionalAuthenticate, AuthRequest } from '../middleware/auth';
import { generateToken } from '../utils/jwt';
import { createAuthToken, invalidateToken } from '../repositories/authTokenRepository';
import { initializeSchema } from '../database/schema';
import { database } from '../database';
import { cleanAllTables } from './helpers/db-cleanup';
import { v4 as uuidv4 } from 'uuid';

/**
 * 认证中间件单元测试
 */

describe('Auth Middleware', () => {
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

  const mockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const mockNext = jest.fn();

  describe('authenticate', () => {
    it('should authenticate valid token', async () => {
      const userId = uuidv4();
      const tokenId = uuidv4();
      const expiresAt = Date.now() + 1000000;

      const token = generateToken({ userId, tokenId });
      await createAuthToken(userId, token, expiresAt);

      const req: Partial<AuthRequest> = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req.userId).toBe(userId);
      expect(req.tokenId).toBe(tokenId);
    });

    it('should reject request without token', async () => {
      const req: Partial<AuthRequest> = {
        headers: {},
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authentication required',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid token format', async () => {
      const req: Partial<AuthRequest> = {
        headers: {
          authorization: 'InvalidFormat token',
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject malformed JWT token', async () => {
      const req: Partial<AuthRequest> = {
        headers: {
          authorization: 'Bearer invalid-jwt-token',
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalidated token', async () => {
      const userId = uuidv4();
      const tokenId = uuidv4();
      const expiresAt = Date.now() + 1000000;

      const token = generateToken({ userId, tokenId });
      await createAuthToken(userId, token, expiresAt);
      await invalidateToken(token);

      const req: Partial<AuthRequest> = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired or invalidated',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject expired token', async () => {
      const userId = uuidv4();
      const tokenId = uuidv4();
      const expiresAt = Date.now() - 1000; // Expired

      const token = generateToken({ userId, tokenId });
      await createAuthToken(userId, token, expiresAt);

      const req: Partial<AuthRequest> = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await authenticate(req as AuthRequest, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuthenticate', () => {
    it('should authenticate valid token', async () => {
      const userId = uuidv4();
      const tokenId = uuidv4();
      const expiresAt = Date.now() + 1000000;

      const token = generateToken({ userId, tokenId });
      await createAuthToken(userId, token, expiresAt);

      const req: Partial<AuthRequest> = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await optionalAuthenticate(req as AuthRequest, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req.userId).toBe(userId);
      expect(req.tokenId).toBe(tokenId);
    });

    it('should continue without token', async () => {
      const req: Partial<AuthRequest> = {
        headers: {},
      };
      const res = mockResponse();
      mockNext.mockClear();

      await optionalAuthenticate(req as AuthRequest, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req.userId).toBeUndefined();
      expect(req.tokenId).toBeUndefined();
    });

    it('should continue with invalid token', async () => {
      const req: Partial<AuthRequest> = {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      };
      const res = mockResponse();
      mockNext.mockClear();

      await optionalAuthenticate(req as AuthRequest, res as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req.userId).toBeUndefined();
    });
  });
});
