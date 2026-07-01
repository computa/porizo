import type { AdminGetClient } from './client';

export interface AttributionBreakdown {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  share_count: number;
  claim_count: number;
  download_count: number;
  registration_count: number;
}

export interface GrowthAttributionResponse {
  bySource: AttributionBreakdown[];
  byMedium: AttributionBreakdown[];
  byCampaign: AttributionBreakdown[];
  byContent?: AttributionBreakdown[];
  byTerm?: AttributionBreakdown[];
  appleAdsByCampaign?: AttributionBreakdown[];
  withAttribution?: number;
  totalShares?: number;
  attributionRate?: string;
  downloadsWithAttribution: number;
  totalDownloads: number;
  attributedRegistrations: number;
  downloadAttributionRate: string;
}

export interface GrowthDailyCount {
  date: string;
  count: number;
}

export interface GrowthTeaserMetricsResponse {
  teaserViews: number;
  shareClaims: number;
  shareStreams: number;
  viewToClaimRate: string;
  viewToStreamRate: string;
  dailyViews: GrowthDailyCount[];
}

export interface GrowthShareMetricsResponse {
  created: number;
  claimed: number;
  claimRate: string;
  byStatus: Array<{ status: string; count: number }>;
  avgAccessCount: string;
  dailyCreated: GrowthDailyCount[];
}

function daysParam(days: number): string {
  return encodeURIComponent(String(days));
}

export function fetchGrowthAttribution(
  api: AdminGetClient,
  days: number,
): Promise<GrowthAttributionResponse> {
  return api.get<GrowthAttributionResponse>(
    `/growth/attribution?days=${daysParam(days)}`,
  );
}

export function fetchGrowthTeasers(
  api: AdminGetClient,
  days: number,
): Promise<GrowthTeaserMetricsResponse> {
  return api.get<GrowthTeaserMetricsResponse>(
    `/growth/teasers?days=${daysParam(days)}`,
  );
}

export function fetchGrowthShares(
  api: AdminGetClient,
  days: number,
): Promise<GrowthShareMetricsResponse> {
  return api.get<GrowthShareMetricsResponse>(
    `/growth/shares?days=${daysParam(days)}`,
  );
}
