/// <reference types="vite/client" />

import { useCallback, useRef } from 'react';

const getBaseUrl = (): string => {
  return '';
};

const getToken = (): string | null => localStorage.getItem('admin_token');
const setToken = (t: string) => localStorage.setItem('admin_token', t);
const clearToken = () => localStorage.removeItem('admin_token');

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
        '/api/v1/users/login',
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
  }, []);

  return { fetchApi, getToken, login, logout };
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
