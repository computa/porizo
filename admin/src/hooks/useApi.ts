import { useState, useCallback } from "react";

const API_BASE = "/admin/dashboard";
type ResponseType = "json" | "blob" | "text";

interface RequestConfig {
  responseType?: ResponseType;
  includeJsonContentType?: boolean;
}

export function useApi(basePath?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getToken = () => localStorage.getItem("adminToken") || "";

  const request = useCallback(
    async <T>(
      endpoint: string,
      options: RequestInit = {},
      config: RequestConfig = {},
    ): Promise<T> => {
      setLoading(true);
      setError(null);

      try {
        const base = basePath ?? API_BASE;
        const { responseType = "json", includeJsonContentType = true } = config;
        const headers = new Headers(options.headers);

        if (includeJsonContentType && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${getToken()}`);
        }

        const res = await fetch(`${base}${endpoint}`, {
          ...options,
          headers,
        });

        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("adminToken");
          localStorage.removeItem("adminUser");
          window.location.href = "/admin/login";
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

        if (responseType === "blob") {
          return res.blob() as T;
        }
        if (responseType === "text") {
          return res.text() as T;
        }

        return res.json() as Promise<T>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [basePath],
  );

  const get = useCallback(
    <T>(endpoint: string) => request<T>(endpoint),
    [request],
  );

  const post = useCallback(
    <T>(endpoint: string, body: unknown) =>
      request<T>(endpoint, { method: "POST", body: JSON.stringify(body) }),
    [request],
  );

  const put = useCallback(
    <T>(endpoint: string, body: unknown) =>
      request<T>(endpoint, { method: "PUT", body: JSON.stringify(body) }),
    [request],
  );

  const patch = useCallback(
    <T>(endpoint: string, body: unknown) =>
      request<T>(endpoint, { method: "PATCH", body: JSON.stringify(body) }),
    [request],
  );

  const del = useCallback(
    <T>(endpoint: string, body?: unknown) =>
      request<T>(endpoint, {
        method: "DELETE",
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    [request],
  );

  const postForm = useCallback(
    <T>(endpoint: string, formData: FormData) =>
      request<T>(
        endpoint,
        { method: "POST", body: formData },
        { includeJsonContentType: false },
      ),
    [request],
  );

  const getBlob = useCallback(
    (endpoint: string) =>
      request<Blob>(
        endpoint,
        { method: "GET" },
        { responseType: "blob", includeJsonContentType: false },
      ),
    [request],
  );

  return {
    get,
    post,
    put,
    patch,
    del,
    postForm,
    getBlob,
    loading,
    error,
    setError,
  };
}
