import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import {
  buildCheckoutRequest,
  createEditableVersion,
  fetchPreviewUrl,
  isTerminalOrderStatus,
  pollPreviewUntilReady,
} from "./funnel";

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    ...overrides,
  } as ApiClient;
}

describe("preview lifecycle", () => {
  it("reads the matching preview URL from the canonical track response", async () => {
    const get = vi.fn().mockResolvedValue({
      versions: [
        { version_num: 1, preview_url: "https://audio.test/one.mp3" },
        { version_num: 2, preview_url: "https://audio.test/two.mp3" },
      ],
    });

    await expect(fetchPreviewUrl(mockClient({ get }), "track-1", 2)).resolves.toBe(
      "https://audio.test/two.mp3",
    );
    expect(get).toHaveBeenCalledWith("/tracks/track-1");
  });

  it("silently retries one failed render and returns the replacement preview", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "completed" })
      .mockResolvedValueOnce({ versions: [{ version_num: 3, preview_url: "/preview.mp3" }] });
    const post = vi.fn().mockResolvedValue({ job_id: "job-2" });
    const onRetry = vi.fn();

    await expect(
      pollPreviewUntilReady({
        client: mockClient({ get, post }),
        trackId: "track-1",
        versionNum: 3,
        initialJobId: "job-1",
        isActive: () => true,
        wait: async () => undefined,
        onRetry,
      }),
    ).resolves.toBe("/preview.mp3");

    expect(post).toHaveBeenCalledWith("/tracks/track-1/versions/3/retry", {});
    expect(onRetry).toHaveBeenCalledWith("job-2");
    expect(get.mock.calls[1][0]).toBe("/jobs/job-2");
  });

  it("surfaces a second render failure", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "failed", error: "still failed" });
    const post = vi.fn().mockResolvedValue({ job_id: "job-2" });

    await expect(
      pollPreviewUntilReady({
        client: mockClient({ get, post }),
        trackId: "track-1",
        versionNum: 1,
        initialJobId: "job-1",
        isActive: () => true,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("still failed");
  });

  it("stops without fetching track data after cancellation", async () => {
    let active = true;
    const get = vi.fn().mockImplementation(async () => {
      active = false;
      return { status: "running" };
    });

    await expect(
      pollPreviewUntilReady({
        client: mockClient({ get }),
        trackId: "track-1",
        versionNum: 1,
        initialJobId: "job-1",
        isActive: () => active,
        wait: async () => undefined,
      }),
    ).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledOnce();
  });

  it("does not issue another job request after navigation cancels a polling wait", async () => {
    let active = true;
    const get = vi.fn().mockResolvedValue({ status: "running" });

    await expect(
      pollPreviewUntilReady({
        client: mockClient({ get }),
        trackId: "track-1",
        versionNum: 1,
        initialJobId: "job-1",
        isActive: () => active,
        wait: async () => { active = false; },
      }),
    ).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledOnce();
  });
});

describe("paid lifecycle", () => {
  it("keeps polling failed orders until the backend reaches refunded or delivered", () => {
    expect(isTerminalOrderStatus("failed")).toBe(false);
    expect(isTerminalOrderStatus("refunded")).toBe(true);
    expect(isTerminalOrderStatus("delivered")).toBe(true);
  });

  it("builds the exact checkout contract without client-side price data", () => {
    expect(buildCheckoutRequest("track-1", "version-1", "gift-song-au")).toEqual({
      track_id: "track-1",
      track_version_id: "version-1",
      price_key: "gift-song-au",
    });
  });
});

describe("post-preview edits", () => {
  it("creates a child version so edited lyrics cannot reuse stale preview audio", async () => {
    const post = vi.fn().mockResolvedValue({ track_version_id: "version-2", version_num: 2 });

    await expect(
      createEditableVersion(mockClient({ post }), {
        trackId: "track-1",
        versionId: "version-1",
        versionNum: 1,
        hasPreview: true,
        previewGenerations: 1,
        style: "Acoustic, warm",
        voiceGender: "female",
      }),
    ).resolves.toEqual({ versionId: "version-2", versionNum: 2, created: true });

    expect(post).toHaveBeenCalledWith("/tracks/track-1/versions", {
      parent_version_id: "version-1",
      render_type: "preview",
      params: {
        style: "Acoustic, warm",
        voice_gender: "female",
        web_revision: 2,
      },
    });
  });
});
