import type { AdminGetClient } from './client';

export interface FunnelStep {
  from: string;
  to: string;
  startUsers: number;
  convertedUsers: number;
  conversionRate: string;
}

export interface FunnelResponse {
  days: number;
  steps: FunnelStep[];
}

export interface EventCount {
  event_name: string;
  count: number;
}

export interface OverviewResponse {
  days: number;
  counts: EventCount[];
}

export interface DailyBucket {
  date: string;
  count: number;
}

export interface DailyResponse {
  event_name: string;
  days: number;
  byDay: DailyBucket[];
}

function daysParam(days: number): string {
  return encodeURIComponent(String(days));
}

export function fetchAnalyticsFunnel(
  api: AdminGetClient,
  days: number,
): Promise<FunnelResponse> {
  return api.get<FunnelResponse>(`/analytics/funnel?days=${daysParam(days)}`);
}

export function fetchAnalyticsOverview(
  api: AdminGetClient,
  days: number,
): Promise<OverviewResponse> {
  return api.get<OverviewResponse>(
    `/analytics/overview?days=${daysParam(days)}`,
  );
}

export function fetchAnalyticsDaily(
  api: AdminGetClient,
  eventName: string,
  days: number,
): Promise<DailyResponse> {
  return api.get<DailyResponse>(
    `/analytics/daily/${encodeURIComponent(eventName)}?days=${daysParam(days)}`,
  );
}
