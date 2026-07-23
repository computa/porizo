import type { FunnelState } from "../state/funnel";
import { buildTrackRequest } from "../state/funnel";
import type { ApiClient } from "./client";

export interface Product {
  price_key: string;
  localized_price: string;
  token_count: number;
  currency?: string;
  name?: string;
}

export type ContentStatus =
  | "pending"
  | "paid"
  | "rendering"
  | "ready"
  | "failed"
  | "refunded";

export type DeliveryChannelStatus =
  | "pending"
  | "accepted"
  | "delivered"
  | "failed"
  | "cancelled";

export interface DeliveryChannel {
  channel: "sms" | "email";
  masked_destination?: string;
  status: DeliveryChannelStatus;
  can_stop?: boolean;
}

export interface OrderDelivery {
  mode: "manual" | "immediate" | "scheduled";
  revision?: number;
  can_edit?: boolean;
  can_stop_any?: boolean;
  sender_display_name?: string;
  send_at?: string;
  timezone?: string;
  channels?: DeliveryChannel[];
}

export interface OrderStatus {
  order_id?: string;
  etsy_unit_id?: string;
  commerce_free?: boolean;
  track_version_id?: string;
  status?: "pending" | "paid" | "rendering" | "delivered" | "failed" | "refunded";
  content_status?: ContentStatus;
  delivery_status?:
    | "not_requested"
    | "draft"
    | "ready_to_share"
    | "scheduled"
    | "accepted"
    | "sending"
    | "partial"
    | "delivered"
    | "failed"
    | "cancelled";
  recipient_name?: string;
  progress_copy?: string;
  share_url?: string;
  support_url?: string;
  order_reference?: string;
  gift_reservation_id?: string;
  gift_id?: string;
  gift_order_id?: string;
  wallet_balance?: number;
  payment_source?: "stripe" | "gift_wallet";
  can_cancel_gift?: boolean;
  delivery?: OrderDelivery;
}

const ORDER_STATUSES = ["pending", "paid", "rendering", "delivered", "failed", "refunded"] as const;

export function isOrderStatus(
  value: string | null,
): value is NonNullable<OrderStatus["status"]> {
  return value !== null && ORDER_STATUSES.includes(value as NonNullable<OrderStatus["status"]>);
}

export function isTerminalOrderStatus(status: OrderStatus["status"] | undefined) {
  return status === "delivered" || status === "refunded";
}

export function contentStatus(order: OrderStatus | undefined): ContentStatus | undefined {
  if (order?.content_status) return order.content_status;
  if (order?.status === "delivered") return "ready";
  return order?.status;
}

export function isOrderPollingComplete(order: OrderStatus | undefined) {
  const content = contentStatus(order);
  if (content === "failed" || content === "refunded") return true;
  if (content !== "ready") return false;
  return [
    "not_requested",
    "ready_to_share",
    "scheduled",
    "accepted",
    "delivered",
    "failed",
    "cancelled",
  ].includes(order?.delivery_status ?? "not_requested");
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

export function buildWalletOrderRequest(
  trackId: string,
  trackVersionId: string,
  etsyJourneyId?: string,
) {
  return {
    track_id: trackId,
    track_version_id: trackVersionId,
    payment_method: "gift_credit" as const,
    ...(etsyJourneyId ? { etsy_journey_id: etsyJourneyId } : {}),
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
  turnstileToken: string,
) {
  await client.post(`/tracks/${trackId}/versions/${versionNum}/lyrics/approve`, {});
  return client.post<{ job_id: string; poll_url?: string }>(
    `/tracks/${trackId}/versions/${versionNum}/render_preview`,
    { turnstile_token: turnstileToken },
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
  onPreviewCount?: (count: number) => void;
  acquireRetryToken?: () => Promise<string>;
  maxAttempts?: number;
  retryAvailable?: boolean;
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
  onPreviewCount,
  acquireRetryToken,
  maxAttempts = 90,
  retryAvailable: initialRetryAvailable = true,
}: PollPreviewOptions): Promise<string | undefined> {
  let jobId = initialJobId;
  let retryAvailable = initialRetryAvailable;
  let attempts = 0;
  while (isActive() && attempts < maxAttempts) {
    attempts += 1;
    const job = await client.get<JobStatus>(`/jobs/${jobId}`);
    if (!isActive()) return undefined;
    onJob?.(job);
    if (job.status === "completed") {
      const response = await client.get<{ versions: VersionSummary[] }>(
        `/tracks/${trackId}`,
      );
      const previewUrl = response.versions.find(
        (version) => version.version_num === versionNum,
      )?.preview_url;
      if (!previewUrl) throw new Error("Preview completed without an audio URL.");
      onPreviewCount?.(
        response.versions.filter((version) => Boolean(version.preview_url)).length,
      );
      return previewUrl;
    }
    if (job.status === "failed") {
      if (!retryAvailable) throw new Error(job.error ?? "Preview failed");
      retryAvailable = false;
      const turnstileToken = acquireRetryToken
        ? await acquireRetryToken()
        : undefined;
      const retry = await client.post<{ job_id: string }>(
        `/tracks/${trackId}/versions/${versionNum}/retry`,
        {
          render_type: "preview",
          ...(turnstileToken
            ? { turnstile_token: turnstileToken }
            : {}),
        },
      );
      jobId = retry.job_id;
      onRetry?.(jobId);
    }
    await wait();
  }
  if (isActive()) throw new Error("Preview is taking longer than expected.");
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
