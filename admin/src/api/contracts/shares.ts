import type { AdminGetClient, AdminReadWriteClient } from './client';

export type ShareResourceType = 'song' | 'poem';

export interface DemoShare {
  id: string;
  resource_id: string;
  resource_type: ShareResourceType;
  title: string | null;
  access_count: number;
  created_at: string;
  status: string;
  share_url: string;
}

export interface ShareToken {
  id: string;
  track_id: string;
  track_title: string;
  status: string;
  access_count: number;
  bound_device_id: string | null;
  stream_key: string;
  created_at: string;
  expires_at: string | null;
}

export interface PoemShareToken {
  id: string;
  poem_id: string;
  poem_title: string;
  recipient_name: string;
  creator_id: string;
  status: string;
  claim_pin: string | null;
  claim_attempts: number;
  access_count: number;
  bound_user_id: string | null;
  allow_save: boolean;
  claim_policy: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface SharesResponse {
  shares: ShareToken[];
}

export interface PoemSharesResponse {
  shares: PoemShareToken[];
}

export interface DemoSharesResponse {
  demo_shares: DemoShare[];
}

export interface CreateDemoShareRequest {
  resource_type: ShareResourceType;
  resource_id: string;
}

export interface CreateDemoShareResponse {
  success: true;
  share_id: string;
  share_url: string;
  resource_type: ShareResourceType;
  resource_id: string;
}

export interface RevokeDemoShareResponse {
  success: true;
  revoked: true;
}

export interface RebindShareRequest {
  newDeviceId: string;
  reason: string;
}

export interface RebindShareResponse {
  success: true;
  oldDeviceId: string | null;
  newDeviceId: string;
}

export interface ResetPoemShareAttemptsResponse {
  success: true;
  oldAttempts: number;
}

export interface RevokePoemShareResponse {
  success: true;
  oldStatus: string;
}

function limitParam(limit: number): string {
  return encodeURIComponent(String(limit));
}

export function listShareTokens(
  api: AdminGetClient,
  limit = 100,
): Promise<SharesResponse> {
  return api.get<SharesResponse>(`/shares?limit=${limitParam(limit)}`);
}

export function listPoemShareTokens(
  api: AdminGetClient,
  limit = 100,
): Promise<PoemSharesResponse> {
  return api.get<PoemSharesResponse>(`/poem-shares?limit=${limitParam(limit)}`);
}

export function listDemoShares(
  api: AdminGetClient,
): Promise<DemoSharesResponse> {
  return api.get<DemoSharesResponse>('/demo-shares');
}

export function createDemoShare(
  api: AdminReadWriteClient,
  body: CreateDemoShareRequest,
): Promise<CreateDemoShareResponse> {
  return api.post<CreateDemoShareResponse>('/demo-shares', body);
}

export function revokeDemoShare(
  api: AdminReadWriteClient,
  shareId: string,
): Promise<RevokeDemoShareResponse> {
  return api.post<RevokeDemoShareResponse>(
    `/demo-share/${encodeURIComponent(shareId)}/revoke`,
    {},
  );
}

export function rebindShare(
  api: AdminReadWriteClient,
  shareId: string,
  body: RebindShareRequest,
): Promise<RebindShareResponse> {
  return api.post<RebindShareResponse>(
    `/share/${encodeURIComponent(shareId)}/rebind`,
    body,
  );
}

export function resetPoemShareAttempts(
  api: AdminReadWriteClient,
  shareId: string,
  reason: string,
): Promise<ResetPoemShareAttemptsResponse> {
  return api.post<ResetPoemShareAttemptsResponse>(
    `/poem-share/${encodeURIComponent(shareId)}/reset-attempts`,
    { reason },
  );
}

export function revokePoemShare(
  api: AdminReadWriteClient,
  shareId: string,
  reason: string,
): Promise<RevokePoemShareResponse> {
  return api.post<RevokePoemShareResponse>(
    `/poem-share/${encodeURIComponent(shareId)}/revoke`,
    { reason },
  );
}
