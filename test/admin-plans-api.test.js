/**
 * Admin Plans API Tests
 *
 * Tests for the POST /admin/plans create endpoint.
 */

process.env.NODE_ENV = "test";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

describe("Admin Plans API", async () => {
  let db, app, adminToken;

  async function loginAdmin(appInstance = app) {
    const response = await appInstance.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "admin@porizo.app", password: "admin123" },
    });
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body).token;
  }

  beforeEach(async () => {
    db = await getDatabase();
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: {
        put: async () => {},
        get: async () => null,
        exists: async () => false,
        delete: async () => {},
        getSignedUrl: async (key) => `http://localhost/${key}`,
      },
    });
    adminToken = await loginAdmin();
  });

  describe("POST /admin/plans", () => {
    it("creates a new plan as superadmin", async () => {
      const planId = `test_plan_${Date.now()}`;
      const resp = await app.inject({
        method: "POST",
        url: "/admin/plans",
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: {
          id: planId,
          name: "Test Premier",
          tier: "pro",
          songs_per_month: 25,
          previews_per_day: -1,
          price_monthly_cents: 2499,
          price_annual_cents: 24999,
          description: "For power creators",
          features_json: ["25 songs/month", "Unlimited previews"],
        },
      });
      const body = JSON.parse(resp.body);
      assert.equal(resp.statusCode, 200);
      assert.equal(body.success, true);
      assert.equal(body.plan.songs_per_month, 25);
      assert.equal(body.plan.name, "Test Premier");
      assert.deepEqual(body.plan.features, ["25 songs/month", "Unlimited previews"]);
    });

    it("requires name, tier, and songs_per_month", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/admin/plans",
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: "Incomplete" },
      });
      assert.equal(resp.statusCode, 400);
      const body = JSON.parse(resp.body);
      assert.equal(body.error, "MISSING_FIELDS");
    });

    it("rejects duplicate plan ID", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/admin/plans",
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { id: "free", name: "Duplicate", tier: "free", songs_per_month: 0 },
      });
      assert.equal(resp.statusCode, 409);
    });

    it("validates tier is a known value", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/admin/plans",
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: "Bad Tier", tier: "diamond", songs_per_month: 50 },
      });
      assert.equal(resp.statusCode, 400);
      const body = JSON.parse(resp.body);
      assert.ok(body.message.includes("tier must be"));
    });

    it("rejects unauthenticated requests", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/admin/plans",
        payload: { name: "No Auth", tier: "free", songs_per_month: 0 },
      });
      assert.equal(resp.statusCode, 401);
    });
  });
});
