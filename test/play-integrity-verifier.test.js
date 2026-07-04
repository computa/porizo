"use strict";

process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createPlayIntegrityVerifier } = require("../src/services/play-integrity-verifier");

function credentials() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    client_email: "play-integrity@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function verifierWithDecodePayload(payload, calls = []) {
  return createPlayIntegrityVerifier({
    packageName: "com.porizo.app",
    credentials: credentials(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === "https://oauth2.googleapis.com/token") {
        return {
          ok: true,
          json: async () => ({ access_token: "access-token", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({ tokenPayloadExternal: payload }),
      };
    },
  });
}

test("Play Integrity verifier sends Google's integrityToken request field", async () => {
  const calls = [];
  const verifier = verifierWithDecodePayload(
    {
      requestDetails: {
        requestHash: "nonce-1",
        requestPackageName: "com.porizo.app",
      },
      appIntegrity: {
        packageName: "com.porizo.app",
        appRecognitionVerdict: "PLAY_RECOGNIZED",
      },
      deviceIntegrity: {
        deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"],
      },
    },
    calls,
  );

  const result = await verifier.verify({
    integrityToken: "signed-token",
    requestHash: "nonce-1",
    packageName: "com.porizo.app",
  });

  assert.equal(result.ok, true);
  const decodeCall = calls.find((call) => call.url.includes(":decodeIntegrityToken"));
  assert.ok(decodeCall);
  assert.deepEqual(JSON.parse(decodeCall.options.body), { integrityToken: "signed-token" });
});

test("Play Integrity verifier rejects unrecognized app and failed device verdicts", async () => {
  const verifier = verifierWithDecodePayload({
    requestDetails: {
      requestHash: "nonce-1",
      requestPackageName: "com.porizo.app",
    },
    appIntegrity: {
      packageName: "com.porizo.app",
      appRecognitionVerdict: "UNRECOGNIZED_VERSION",
    },
    deviceIntegrity: {
      deviceRecognitionVerdict: [],
    },
  });

  const result = await verifier.verify({
    integrityToken: "signed-token",
    requestHash: "nonce-1",
    packageName: "com.porizo.app",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "app_not_recognized");
});

test("Play Integrity verifier rejects missing device integrity", async () => {
  const verifier = verifierWithDecodePayload({
    requestDetails: {
      requestHash: "nonce-1",
      requestPackageName: "com.porizo.app",
    },
    appIntegrity: {
      packageName: "com.porizo.app",
      appRecognitionVerdict: "PLAY_RECOGNIZED",
    },
    deviceIntegrity: {},
  });

  const result = await verifier.verify({
    integrityToken: "signed-token",
    requestHash: "nonce-1",
    packageName: "com.porizo.app",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "device_integrity_failed");
});
