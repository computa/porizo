/**
 * Tests for the artwork capability URL HMAC sign/verify, including the kid-
 * versioned rotation path.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Test isolates the dev-fallback secret path: NODE_ENV must not be 'production'
// when this file is loaded so the module imports cleanly. Tests set
// ARTWORK_HMAC_SECRET / *_PREV via the env BEFORE requiring the module.
process.env.NODE_ENV = "test";
process.env.ARTWORK_HMAC_SECRET = "current-secret-v1";
process.env.ARTWORK_HMAC_SECRET_PREV = "previous-secret-v0";

const {
  signArtworkUrl,
  buildSignedArtworkUrl,
  verifyArtworkSignature,
} = require("../../src/routes/artwork");

const ONE_HOUR_FROM_NOW = Math.floor(Date.now() / 1000) + 3600;

test("signArtworkUrl produces a base64url-encoded HMAC-SHA256", () => {
  const sig = signArtworkUrl({
    trackId: "track-abc",
    expiryUnix: ONE_HOUR_FROM_NOW,
  });
  // sha256 base64url is always 43 chars (no padding)
  assert.equal(sig.length, 43);
  assert.match(sig, /^[A-Za-z0-9_-]+$/, "no +,/,= chars");
});

test("verifyArtworkSignature accepts a fresh signature", () => {
  const sig = signArtworkUrl({
    trackId: "track-abc",
    expiryUnix: ONE_HOUR_FROM_NOW,
  });
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-abc",
      expiryUnix: ONE_HOUR_FROM_NOW,
      sig,
    }),
    true,
  );
});

test("verifyArtworkSignature rejects an expired signature", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const sig = signArtworkUrl({ trackId: "track-abc", expiryUnix: past });
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-abc",
      expiryUnix: past,
      sig,
    }),
    false,
  );
});

test("verifyArtworkSignature rejects a signature reused across trackIds", () => {
  const sig = signArtworkUrl({
    trackId: "track-A",
    expiryUnix: ONE_HOUR_FROM_NOW,
  });
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-B",
      expiryUnix: ONE_HOUR_FROM_NOW,
      sig,
    }),
    false,
  );
});

test("verifyArtworkSignature accepts a signature from the previous key (kid=v0)", () => {
  const sig = signArtworkUrl({
    trackId: "track-rotate",
    expiryUnix: ONE_HOUR_FROM_NOW,
    kid: "v0",
  });
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-rotate",
      expiryUnix: ONE_HOUR_FROM_NOW,
      sig,
      kid: "v0",
    }),
    true,
  );
});

test("verifyArtworkSignature rejects a v0 signature presented as v1 (wrong kid)", () => {
  const sigV0 = signArtworkUrl({
    trackId: "track-x",
    expiryUnix: ONE_HOUR_FROM_NOW,
    kid: "v0",
  });
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-x",
      expiryUnix: ONE_HOUR_FROM_NOW,
      sig: sigV0,
      // Note: no kid means default v1 — should fail because v0 signed it
    }),
    false,
  );
});

test("verifyArtworkSignature rejects unknown kid", () => {
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-x",
      expiryUnix: ONE_HOUR_FROM_NOW,
      sig: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      kid: "v999",
    }),
    false,
  );
});

test("verifyArtworkSignature rejects missing sig/exp", () => {
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-x",
      expiryUnix: ONE_HOUR_FROM_NOW,
    }),
    false,
  );
  assert.equal(
    verifyArtworkSignature({ trackId: "track-x", sig: "abc" }),
    false,
  );
});

// ---------- buildSignedArtworkUrl ----------

function parseQuery(url) {
  const qs = url.split("?")[1] || "";
  return Object.fromEntries(new URLSearchParams(qs));
}

test("buildSignedArtworkUrl returns a verifiable URL by default", () => {
  const url = buildSignedArtworkUrl({ trackId: "track-x" });
  assert.match(url, /^\/tracks\/track-x\/artwork\.jpg\?/);
  const q = parseQuery(url);
  assert.ok(q.sig);
  assert.ok(q.exp);
  assert.equal(q.kid, "v1");
  assert.ok(q.v, "cache-bust version stamp included");
  assert.equal(
    verifyArtworkSignature({
      trackId: "track-x",
      expiryUnix: parseInt(q.exp, 10),
      sig: q.sig,
      kid: q.kid,
    }),
    true,
  );
});

test("buildSignedArtworkUrl rounds exp to the next day boundary for cache stability", () => {
  const url = buildSignedArtworkUrl({ trackId: "track-x", ttlSeconds: 3600 });
  const q = parseQuery(url);
  const exp = parseInt(q.exp, 10);
  assert.equal(exp % (24 * 60 * 60), 0, "exp must be a multiple of 86400");
  assert.ok(exp > Math.floor(Date.now() / 1000), "exp must be in the future");
});

test("buildSignedArtworkUrl includes share_token when provided", () => {
  const url = buildSignedArtworkUrl({
    trackId: "track-x",
    shareTokenId: "share-abc",
  });
  const q = parseQuery(url);
  assert.equal(q.share_token, "share-abc");
});

test("buildSignedArtworkUrl omits share_token when not provided", () => {
  const url = buildSignedArtworkUrl({ trackId: "track-x" });
  assert.ok(!url.includes("share_token="));
});

test("buildSignedArtworkUrl rejects missing trackId", () => {
  assert.throws(() => buildSignedArtworkUrl({}), /trackId is required/);
});

test("buildSignedArtworkUrl rejects NaN / non-positive ttl", () => {
  assert.throws(
    () => buildSignedArtworkUrl({ trackId: "t", ttlSeconds: "abc" }),
    /ttlSeconds must be a positive number/,
  );
  assert.throws(
    () => buildSignedArtworkUrl({ trackId: "t", ttlSeconds: 0 }),
    /ttlSeconds must be a positive number/,
  );
  assert.throws(
    () => buildSignedArtworkUrl({ trackId: "t", ttlSeconds: -60 }),
    /ttlSeconds must be a positive number/,
  );
});

test("buildSignedArtworkUrl preserves provided versionStamp", () => {
  const url = buildSignedArtworkUrl({
    trackId: "track-x",
    versionStamp: 1234567890,
  });
  const q = parseQuery(url);
  assert.equal(q.v, "1234567890");
});
