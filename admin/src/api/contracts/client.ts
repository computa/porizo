export interface AdminGetClient {
  get<T>(endpoint: string): Promise<T>;
}

export interface AdminPostClient {
  post<T>(endpoint: string, body: unknown): Promise<T>;
}

export type AdminReadWriteClient = AdminGetClient & AdminPostClient;
