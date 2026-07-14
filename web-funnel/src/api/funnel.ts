import type { FunnelState } from "../state/funnel";
import { buildTrackRequest } from "../state/funnel";
import type { ApiClient } from "./client";

export interface Product {
  price_key: string;
  localized_price: string;
  currency?: string;
  name?: string;
}

export interface OrderStatus {
  status: "pending" | "paid" | "rendering" | "delivered" | "failed" | "refunded";
  recipient_name?: string;
  progress_copy?: string;
  share_url?: string;
  support_url?: string;
}

const ORDER_STATUSES = ["pending", "paid", "rendering", "delivered", "failed", "refunded"] as const;

export function isOrderStatus(value: string | null): value is OrderStatus["status"] {
  return value !== null && ORDER_STATUSES.includes(value as OrderStatus["status"]);
}

export function isTerminalOrderStatus(status: OrderStatus["status"] | undefined) {
  return status === "delivered" || status === "refunded";
}

export function buildCheckoutRequest(
  trackId: string,
  trackVersionId: string,
  priceKey: string,
) {
  return {
    track_id: trackId,
    track_version_id: trackVersionId,
    price_key: priceKey,
  };
}

export interface JobStatus {
  id?: string;
  status: "queued" | "running" | "completed" | "failed";
  step?: string;
  progress?: number;
  error?: string;
}

export interface VersionSummary {
  version_num: number;
  preview_url?: string;
  status?: string;
}

export async function createSongDraft(client: ApiClient, state: FunnelState) {
  const trackRequest = buildTrackRequest(state);
  const track = await client.post<{ track_id: string }>("/tracks", trackRequest);
  const version = await client.post<{ track_version_id: string; version_num: number }>(
    `/tracks/${track.track_id}/versions`,
    {
      params: {
        style: trackRequest.style,
        voice_gender: trackRequest.voice_gender,
      },
      render_type: "preview",
    },
  );
  const lyrics = await client.post<{ lyrics: unknown }>(
    `/tracks/${track.track_id}/versions/${version.version_num}/lyrics/generate`,
    {},
  );
  return {
    trackId: track.track_id,
    versionId: version.track_version_id,
    versionNum: version.version_num,
    lyrics: normalizeLyrics(lyrics.lyrics),
  };
}

export function normalizeLyrics(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        if (typeof entry === "string") return entry.split("\n");
        if (entry && typeof entry === "object" && "text" in entry) return [String(entry.text)];
        return [];
      })
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(normalizeLyrics);
  }
  return [];
}

export async function approveAndRenderPreview(
  client: ApiClient,
  trackId: string,
  versionNum: number,
) {
  await client.post(`/tracks/${trackId}/versions/${versionNum}/lyrics/approve`, {});
  return client.post<{ job_id: string; poll_url?: string }>(
    `/tracks/${trackId}/versions/${versionNum}/render_preview`,
    {},
  );
}

export async function fetchPreviewUrl(client: ApiClient, trackId: string, versionNum: number) {
  const response = await client.get<{ versions: VersionSummary[] }>(`/tracks/${trackId}`);
  return response.versions.find((version) => version.version_num === versionNum)?.preview_url;
}

interface PollPreviewOptions {
  client: ApiClient;
  trackId: string;
  versionNum: number;
  initialJobId: string;
  isActive: () => boolean;
  wait: () => Promise<void>;
  onJob?: (job: JobStatus) => void;
  onRetry?: (jobId: string) => void;
}

export async function pollPreviewUntilReady({
  client,
  trackId,
  versionNum,
  initialJobId,
  isActive,
  wait,
  onJob,
  onRetry,
}: PollPreviewOptions): Promise<string | undefined> {
  let jobId = initialJobId;
  let retryAvailable = true;
  while (isActive()) {
    const job = await client.get<JobStatus>(`/jobs/${jobId}`);
    if (!isActive()) return undefined;
    onJob?.(job);
    if (job.status === "completed") {
      const previewUrl = await fetchPreviewUrl(client, trackId, versionNum);
      if (!previewUrl) throw new Error("Preview completed without an audio URL.");
      return previewUrl;
    }
    if (job.status === "failed") {
      if (!retryAvailable) throw new Error(job.error ?? "Preview failed");
      retryAvailable = false;
      const retry = await client.post<{ job_id: string }>(
        `/tracks/${trackId}/versions/${versionNum}/retry`,
        {},
      );
      jobId = retry.job_id;
      onRetry?.(jobId);
    }
    await wait();
  }
  return undefined;
}

interface EditableVersionOptions {
  trackId: string;
  versionId: string;
  versionNum: number;
  hasPreview: boolean;
  previewGenerations: number;
  style: string;
  voiceGender: "female" | "male";
}

export async function createEditableVersion(client: ApiClient, options: EditableVersionOptions) {
  if (!options.hasPreview) {
    return { versionId: options.versionId, versionNum: options.versionNum, created: false };
  }
  const next = await client.post<{ track_version_id: string; version_num: number }>(
    `/tracks/${options.trackId}/versions`,
    {
      parent_version_id: options.versionId,
      render_type: "preview",
      params: {
        style: options.style,
        voice_gender: options.voiceGender,
        web_revision: options.previewGenerations + 1,
      },
    },
  );
  return {
    versionId: next.track_version_id,
    versionNum: next.version_num,
    created: true,
  };
}
