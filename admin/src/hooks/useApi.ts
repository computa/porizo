import { useState, useCallback } from 'react';

const API_BASE = '/admin/dashboard';

export function useApi(basePath?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getToken = () => localStorage.getItem('adminToken') || '';

  const request = useCallback(async <T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> => {
    setLoading(true);
    setError(null);

    try {
      const base = basePath ?? API_BASE;
      const res = await fetch(`${base}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`,
          ...options.headers,
        },
      });

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin/login';
        // Return never-resolving promise to halt execution during redirect
        return new Promise<T>(() => {});
      }

      if (!res.ok) {
        // Try to parse error body, handle non-JSON responses gracefully
        let errorMessage = `Request failed with status ${res.status}`;
        try {
          const data = await res.json();
          if (data.error?.message) {
            errorMessage = data.error.message;
          } else if (data.message) {
            errorMessage = data.message;
          }
        } catch {
          // Response wasn't JSON - use status-based message
        }
        throw new Error(errorMessage);
      }

      return res.json() as Promise<T>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  const get = useCallback(<T>(endpoint: string) =>
    request<T>(endpoint), [request]);

  const post = useCallback(<T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }), [request]);

  const put = useCallback(<T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }), [request]);

  const del = useCallback(<T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'DELETE',
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), [request]);

  return { get, post, put, del, loading, error, setError };
}
