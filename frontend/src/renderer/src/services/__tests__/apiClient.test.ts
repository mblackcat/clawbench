/**
 * API 客户端单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiClient, ApiClientError } from '../apiClient';

// Mock fetch
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    apiClient.clearToken();
  });

  describe('Token Management', () => {
    it('should store token after login', async () => {
      const mockResponse = {
        success: true,
        data: {
          token: 'test-token-123',
          userId: 'user-1',
          expiresAt: Date.now() + 3600000,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      await apiClient.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(apiClient.getToken()).toBe('test-token-123');
      expect(apiClient.isLoggedIn()).toBe(true);
    });

    it('should clear token after logout', async () => {
      // Set a token first
      apiClient.setToken('test-token');

      const mockResponse = {
        success: true,
        data: { success: true },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      await apiClient.logout();

      expect(apiClient.getToken()).toBeNull();
      expect(apiClient.isLoggedIn()).toBe(false);
    });

    it('should include Authorization header when token exists', async () => {
      apiClient.setToken('test-token');

      const mockResponse = {
        success: true,
        data: {
          userId: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      await apiClient.getCurrentUser();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw ApiClientError for API errors', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockErrorResponse,
      });

      await expect(
        apiClient.login({
          email: 'wrong@example.com',
          password: 'wrongpassword',
        })
      ).rejects.toThrow(ApiClientError);
    });

    it('should identify auth errors correctly', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token has expired',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockErrorResponse,
      });

      try {
        await apiClient.getCurrentUser();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).isAuthError()).toBe(true);
      }
    });

    it('should identify validation errors correctly', async () => {
      const mockErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockErrorResponse,
      });

      try {
        await apiClient.register({
          username: '',
          email: 'invalid',
          password: '123',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).isValidationError()).toBe(true);
      }
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Network connection failed')
      );

      try {
        await apiClient.listApplications();
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).isNetworkError()).toBe(true);
      }
    });
  });

  describe('Application API', () => {
    it('should create application with auth', async () => {
      apiClient.setToken('test-token');

      const mockResponse = {
        success: true,
        data: {
          applicationId: 'app-1',
          name: 'Test App',
          description: 'A test application',
          version: '1.0.0',
          ownerId: 'user-1',
          createdAt: Date.now(),
          published: false,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await apiClient.createApplication({
        name: 'Test App',
        description: 'A test application',
        version: '1.0.0',
        category: 'utility',
      });

      expect(result.applicationId).toBe('app-1');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/applications'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should list applications without auth', async () => {
      const mockResponse = {
        success: true,
        data: {
          applications: [
            {
              applicationId: 'app-1',
              name: 'App 1',
              description: 'First app',
              ownerId: 'user-1',
              ownerName: 'User One',
              category: 'utility',
              published: true,
              downloadCount: 10,
              metadata: {},
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          total: 1,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const result = await apiClient.listApplications();

      expect(result.applications).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should build query parameters correctly', async () => {
      const mockResponse = {
        success: true,
        data: { applications: [], total: 0 },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      await apiClient.listApplications({
        category: 'utility',
        search: 'test',
        limit: 10,
        offset: 0,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=utility'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object)
      );
    });
  });

  describe('File Upload', () => {
    it('should upload application package with FormData', async () => {
      apiClient.setToken('test-token');

      const mockResponse = {
        success: true,
        data: {
          applicationId: 'app-1',
          version: '1.0.0',
          fileSize: 1024,
          uploadedAt: Date.now(),
          downloadUrl: 'http://example.com/download',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const file = new File(['test content'], 'app.zip', {
        type: 'application/zip',
      });

      const result = await apiClient.uploadApplication(
        'app-1',
        file,
        '1.0.0',
        'Initial release'
      );

      expect(result.version).toBe('1.0.0');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/applications/app-1/upload'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
          body: expect.any(FormData),
        })
      );
    });
  });
});
