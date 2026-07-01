process.env.NODE_ENV = "test";
process.env.ARTWORK_HMAC_SECRET = "artwork-route-current-secret";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const storageRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "porizo-artwork-route-"),
);
process.env.STORAGE_ROOT = storageRoot;

const { trackArtworkKey } = require("../../src/storage");
const {
  buildSignedArtworkUrl,
  registerArtworkRoutes,
} = require("../../src/routes/artwork");

after(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

function captureArtworkHandler(deps) {
  let handler;
  registerArtworkRoutes(
    {
      get(route, registeredHandler) {
        assert.equal(route, "/tracks/:trackId/artwork.jpg");
        handler = registeredHandler;
      },
    },
    deps,
  );
  assert.equal(typeof handler, "function");
  return handler;
}

function createReply() {
  return {
    statusCode: 200,
    headers: {},
    sent: false,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    header(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload) {
      this.sent = true;
      this.payload = payload;
      return payload;
    },
  };
}

function sendError(reply, status, code, message) {
  return reply.code(status).send({ error: code, message });
}

function requestFor({ trackId, query = {}, authorization = null }) {
  return {
    params: { trackId },
    query,
    headers: authorization ? { authorization } : {},
    log: {
      warn() {},
      error() {},
    },
  };
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function queryFromSignedUrl(url) {
  return Object.fromEntries(new URL(`https://example.test${url}`).searchParams);
}

test("artwork route authorizes owner bearer requests through the access repository", async () => {
  const trackId = "track_owner_art";
  const userId = "user_owner_art";
  const objectKey = trackArtworkKey({ userId, trackId });
  const localFilePath = path.join(storageRoot, objectKey);
  fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
  fs.writeFileSync(localFilePath, "jpg-data");

  const ownerLookups = [];
  const handler = captureArtworkHandler({
    artworkAccessRepository: {
      async getShareTokenForArtwork() {
        throw new Error("share token lookup should not run for owner auth");
      },
      async getTrackOwnerForArtwork(requestedTrackId) {
        ownerLookups.push(requestedTrackId);
        return { user_id: userId };
      },
    },
    requireUserId: async () => userId,
    sendError,
  });

  const reply = createReply();
  await handler(
    requestFor({ trackId, authorization: "Bearer owner-token" }),
    reply,
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.headers["content-type"], "image/jpeg");
  assert.equal(await readStream(reply.payload), "jpg-data");
  assert.deepEqual(ownerLookups, [trackId, trackId]);
});

test("artwork route returns TRACK_NOT_FOUND after valid HMAC when repository has no owner row", async () => {
  const trackId = "track_missing_art";
  const query = queryFromSignedUrl(
    buildSignedArtworkUrl({ trackId, versionStamp: 123 }),
  );
  const ownerLookups = [];
  const handler = captureArtworkHandler({
    artworkAccessRepository: {
      async getShareTokenForArtwork() {
        throw new Error("share token lookup should not run for bare HMAC auth");
      },
      async getTrackOwnerForArtwork(requestedTrackId) {
        ownerLookups.push(requestedTrackId);
        return undefined;
      },
    },
    sendError,
  });

  const reply = createReply();
  await handler(requestFor({ trackId, query }), reply);

  assert.equal(reply.statusCode, 404);
  assert.deepEqual(reply.payload, {
    error: "TRACK_NOT_FOUND",
    message: "Track no longer exists.",
  });
  assert.deepEqual(ownerLookups, [trackId]);
});
