/**
 * Track version URL builder tests
 *
 * Ensures presigned S3 URLs are generated for preview/full when storage is S3.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { buildTrackVersionUrls } = require("../../src/services/track-urls");

describe("Track version URL builder with S3 storage", () => {
  test("returns presigned URLs for preview and full", () => {
    const userId = "user_test_123";
    const trackId = "track_test_123";
    const storage = {
      type: "s3",
      createPresignedDownload: ({ key, expiresInSec }) => ({
        url: `https://s3.local/${key}?exp=${expiresInSec}`,
      }),
    };
    const track = { id: trackId, user_id: userId };
    const version = {
      version_num: 1,
      preview_url: "http://local/preview.m4a",
      full_url: "http://local/full.m4a",
    };

    const { previewUrl, fullUrl } = buildTrackVersionUrls({
      storageProvider: storage,
      track,
      version,
      baseUrl: "https://api.example.com",
      rewriteStreamUrl: (url) => url,
    });

    assert.ok(
      previewUrl.includes(`tracks/${userId}/${trackId}/v1/preview.m4a`),
      "preview_url should be a presigned S3 URL"
    );
    assert.ok(
      fullUrl.includes(`tracks/${userId}/${trackId}/v1/master.m4a`),
      "full_url should be a presigned S3 URL"
    );
  });
});
