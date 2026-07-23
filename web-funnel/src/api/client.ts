export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
    readonly retryAt?: string,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  getToken: () => string | null;
  refreshSession?: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = options.getToken();
    const response = await fetcher(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401 && retry && options.refreshSession) {
      const refreshed = await options.refreshSession();
      if (refreshed) return request<T>(path, init, false);
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        message?: string;
        retry_at?: string;
      };
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new ApiError(
        body.message ?? body.error ?? "Request failed",
        response.status,
        body.error ?? body.code,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        body.retry_at,
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      request<T>(path, {
        ...init,
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
