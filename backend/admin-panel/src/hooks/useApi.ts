/// <reference types="vite/client" />

import { useCallback, useRef } from 'react';

const getBaseUrl = (): string => {
  return '';
};

const getToken = (): string | null => localStorage.getItem('admin_token');
const setToken = (t: string) => localStorage.setItem('admin_token', t);
const clearToken = () => localStorage.removeItem('admin_token');

/** Password login endpoint — its 401 means bad credentials, not an expired session */
const LOGIN_PATH = '/api/v1/users/login';

export function useApi() {
  const baseUrl = getBaseUrl();

  const fetchApi = useCallback(
    async <T>(path: string, options: RequestInit = {}): Promise<T> => {
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

      // Session expired / invalid token: clear it and bounce to login.
      // The login request itself is excluded so wrong credentials surface inline.
      if (res.status === 401 && !path.startsWith(LOGIN_PATH)) {
        clearToken();
        localStorage.removeItem('admin_role');
        if (!window.location.pathname.endsWith('/admin/login')) {
          window.location.assign('/admin/login');
        }
        throw new ApiError('UNAUTHORIZED', 'Session expired, please sign in again', 401);
      }

      const json = await res.json();

      if (!json.success) {
        throw new ApiError(
          json.error?.code || 'UNKNOWN',
          json.error?.message || 'Unknown error',
          res.status
        );
      }

      return json;
    },
    [baseUrl]
  );

  const login = useCallback(
    async (email: string, password: string): Promise<string> => {
      const json = await fetchApi<{ success: boolean; data: { token: string; userId: string } }>(
        LOGIN_PATH,
        {
          method: 'POST',
          body: JSON.stringify({ username: email, password }),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      setToken(json.data.token);
      return json.data.token;
    },
    [fetchApi]
  );

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem('admin_role');
  }, []);

  const getMe = useCallback(async (): Promise<string> => {
    const cached = localStorage.getItem('admin_role');
    if (cached) return cached;

    try {
      const json = await fetchApi<{ success: boolean; data: { role: string } }>('/api/v1/users/me');
      const role = json.data.role;
      localStorage.setItem('admin_role', role);
      return role;
    } catch {
      return 'user';
    }
  }, [fetchApi]);

  return { fetchApi, getToken, login, logout, getMe };
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
