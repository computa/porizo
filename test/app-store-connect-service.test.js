const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  compareVersionStrings,
  createAppStoreConnectService,
} = require("../src/services/app-store-connect-service");

describe("App Store Connect service", () => {
  it("returns the latest iOS version in Ready for Distribution state", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("/apps?")) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "app_123" }],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          data: [
            { attributes: { versionString: "1.2.2" } },
            { attributes: { versionString: "1.3.0" } },
            { attributes: { versionString: "1.2.10" } },
          ],
        }),
      };
    };

    const service = createAppStoreConnectService({
      keyId: "key",
      issuerId: "issuer",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      bundleId: "porizo.ios.app.PorizoApp",
      fetchImpl,
      cacheTtlMs: 60_000,
    });

    const version = await service.getLatestReadyIOSVersion({ force: true });

    assert.equal(version, "1.3.0");
    assert.equal(calls.length, 2);
    assert.match(calls[1], /appStoreState=READY_FOR_DISTRIBUTION/);
  });

  it("caches the resolved version inside the TTL", async () => {
    let appRequests = 0;
    const service = createAppStoreConnectService({
      keyId: "key",
      issuerId: "issuer",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      bundleId: "porizo.ios.app.PorizoApp",
      fetchImpl: async (url) => {
        appRequests += 1;
        if (url.includes("/apps?")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "app_123" }] }),
          };
        }
        return {
          ok: true,
          json: async () => ({ data: [{ attributes: { versionString: "1.2.2" } }] }),
        };
      },
      cacheTtlMs: 60_000,
    });

    const first = await service.getLatestReadyIOSVersion();
    const second = await service.getLatestReadyIOSVersion();

    assert.equal(first, "1.2.2");
    assert.equal(second, "1.2.2");
    assert.equal(appRequests, 2);
  });

  it("returns null when credentials are not configured", async () => {
    const service = createAppStoreConnectService({
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });

    assert.equal(service.isConfigured(), false);
    assert.equal(await service.getLatestReadyIOSVersion(), null);
  });

  it("compares dotted version strings correctly", () => {
    assert.ok(compareVersionStrings("1.2.10", "1.2.2") > 0);
    assert.ok(compareVersionStrings("1.3", "1.2.9") > 0);
    assert.ok(compareVersionStrings("1.2.0", "1.2") === 0);
  });
});
