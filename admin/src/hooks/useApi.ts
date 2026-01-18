import { useState, useCallback } from 'react';

const API_BASE = '/admin/dashboard';

interface ApiError {
  error: string;
  message: string;
}

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAdminKey = () => localStorage.getItem('adminKey') || '';

  const request = useCallback(async <T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': getAdminKey(),
          ...options.headers,
        },
      });

      if (res.status === 403) {
        localStorage.removeItem('adminKey');
        window.location.href = '/admin/login';
        throw new Error('Unauthorized');
      }

      const data = await res.json();

      if (!res.ok) {
        const apiError = data as ApiError;
        throw new Error(apiError.message || 'Request failed');
      }

      return data as T;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback(<T>(endpoint: string) =>
    request<T>(endpoint), [request]);

  const post = useCallback(<T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }), [request]);

  const put = useCallback(<T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }), [request]);

  return { get, post, put, loading, error, setError };
}
