const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildShareUrlHelpers,
  deriveSharePublicBaseUrl,
} = require("../../src/utils/share-urls");

test("deriveSharePublicBaseUrl maps API host to public web host", () => {
  assert.equal(
    deriveSharePublicBaseUrl("https://api.porizo.co"),
    "https://porizo.co",
  );
  assert.equal(
    deriveSharePublicBaseUrl("http://localhost:3999"),
    "http://localhost:3999",
  );
});

test("share URL helpers preserve version and cache-busting behavior", () => {
  const helpers = buildShareUrlHelpers({
    publicBaseUrl: "https://api.porizo.co",
    sharePublicBaseUrl: "https://porizo.co",
    shareCoverVersion: "2",
    now: () => 123456,
  });

  assert.equal(
    helpers.buildPlayShareUrl("share_123"),
    "https://porizo.co/play/share_123?sv=2",
  );
  assert.equal(
    helpers.buildFreshPlayShareUrl("share_123"),
    "https://porizo.co/play/share_123?sv=2&smv=123456",
  );
  assert.equal(
    helpers.buildPoemShareUrl("poem_123"),
    "https://porizo.co/poem/poem_123?sv=2",
  );
  assert.equal(
    helpers.buildGiftShareUrl("gift_123"),
    "https://porizo.co/g/gift_123?sv=2",
  );
});

test("share URL helpers preserve requested share query strings only for expected paths", () => {
  const helpers = buildShareUrlHelpers({
    publicBaseUrl: "https://api.porizo.co",
    sharePublicBaseUrl: "https://porizo.co",
    shareCoverVersion: "2",
  });

  assert.equal(
    helpers.buildRequestedPlayShareUrl(
      { raw: { url: "/play/share_123?sv=2&fbv=cache123" } },
      "share_123",
    ),
    "https://porizo.co/play/share_123?sv=2&fbv=cache123",
  );
  assert.equal(
    helpers.buildRequestedPlayShareUrl(
      { raw: { url: "/other/share_123?fbv=cache123" } },
      "share_123",
    ),
    "https://porizo.co/play/share_123?sv=2",
  );
});

test("share URL helpers cap social cache tokens and build artwork URLs", () => {
  const helpers = buildShareUrlHelpers({
    publicBaseUrl: "https://api.porizo.co",
    sharePublicBaseUrl: "https://porizo.co",
    shareCoverVersion: "2",
  });
  const longToken = "x".repeat(80);

  assert.equal(
    helpers.extractSocialCacheToken({
      raw: { url: `/play/share_123?fbv=${longToken}` },
    }),
    "x".repeat(64),
  );
  assert.equal(
    helpers.buildShareCoverUrl("share_123", {
      socialCacheToken: "cache123",
      artworkVersion: "art456",
      variant: "whatsapp",
    }),
    "https://porizo.co/share/share_123/cover.jpg?v=2&smv=cache123&av=art456&variant=whatsapp",
  );
  assert.equal(
    helpers.buildPoemOgImageUrl("poem_123", { socialCacheToken: "cache123" }),
    "https://porizo.co/poem/poem_123/og-image.png?v=2&smv=cache123",
  );
});
