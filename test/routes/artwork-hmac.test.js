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
