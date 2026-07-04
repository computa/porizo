require("dotenv/config");
process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

async function makeApp(t, { playIntegrityVerifier = null, config = {} } = {}) {
  const storageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "porizo-device-integrity-test-"),
  );
  t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
  const appConfig = {
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    STREAM_BASE_URL: "http://stream.local",
    PUBLIC_BASE_URL: "http://public.local",
    ALLOW_ANON_USER_ID: true,
    PLAY_INTEGRITY_NONCE_SECRET: "test-integrity-secret",
    ...config,
  };
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  const app = buildServer({
    db,
    config: appConfig,
    storage: createStorageProvider(appConfig),
    billingServices: playIntegrityVerifier
      ? { playIntegrityVerifier }
      : undefined,
  });
  t.after(() => app.close());
  return app;
}

test("device integrity nonce and verify delegates token to verifier", async (t) => {
  const calls = [];
  const verifier = {
    isConfigured: () => true,
    verify: async (args) => {
      calls.push(args);
      return {
        ok: true,
        requestDetails: { requestHash: args.requestHash },
        appIntegrity: { packageName: "com.porizo.app" },
        deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
      };
    },
  };
  const app = await makeApp(t, { playIntegrityVerifier: verifier });

  const nonceRes = await app.inject({
    method: "POST",
    url: "/device/integrity/nonce",
    headers: { "x-user-id": "integrity_user", "x-device-id": "android-1" },
    payload: { platform: "android" },
  });
  assert.equal(nonceRes.statusCode, 200, nonceRes.body);
  const nonceBody = JSON.parse(nonceRes.body);
  assert.ok(nonceBody.nonce);
  assert.equal(nonceBody.request_hash, nonceBody.nonce);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/device/integrity/verify",
    headers: { "x-user-id": "integrity_user" },
    payload: {
      nonce: nonceBody.nonce,
      integrity_token: "signed-google-token",
      package_name: "com.porizo.app",
      app_set_id: "app-set-id",
    },
  });
  assert.equal(verifyRes.statusCode, 200, verifyRes.body);
  const verifyBody = JSON.parse(verifyRes.body);
  assert.equal(verifyBody.verified, true);
  assert.equal(verifyBody.nonce_valid, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestHash, nonceBody.nonce);
  assert.equal(calls[0].integrityToken, "signed-google-token");
});

test("device integrity verify rejects tampered nonce", async (t) => {
  const app = await makeApp(t);
  const nonceRes = await app.inject({
    method: "POST",
    url: "/device/integrity/nonce",
    headers: { "x-user-id": "integrity_user" },
  });
  const nonceBody = JSON.parse(nonceRes.body);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/device/integrity/verify",
    headers: { "x-user-id": "integrity_user" },
    payload: {
      nonce: `${nonceBody.nonce}x`,
      integrity_token: "signed-google-token",
    },
  });
  assert.equal(verifyRes.statusCode, 400, verifyRes.body);
  assert.equal(JSON.parse(verifyRes.body).error, "INVALID_INTEGRITY_NONCE");
});

test("device integrity verify fails closed when enforcement is enabled without verifier", async (t) => {
  const app = await makeApp(t, {
    config: { PLAY_INTEGRITY_ENFORCE: true },
  });
  const nonceRes = await app.inject({
    method: "POST",
    url: "/device/integrity/nonce",
    headers: { "x-user-id": "integrity_user" },
  });
  const nonceBody = JSON.parse(nonceRes.body);

  const verifyRes = await app.inject({
    method: "POST",
    url: "/device/integrity/verify",
    headers: { "x-user-id": "integrity_user" },
    payload: {
      nonce: nonceBody.nonce,
      integrity_token: "signed-google-token",
    },
  });
  assert.equal(verifyRes.statusCode, 503, verifyRes.body);
  assert.equal(JSON.parse(verifyRes.body).error, "PLAY_INTEGRITY_NOT_CONFIGURED");
});
