const { describe, it } = require("node:test");
const assert = require("node:assert");

function registerAuthSignupTests({ getApp, getDb, uniqueEmail }) {
  describe("POST /auth/signup", () => {
    it("should create new user account", async () => {
      const app = getApp();
      const email = uniqueEmail();
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email,
          password: "SecurePassword123",
          name: "Test User",
        },
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.user_id, "should return user_id");
      assert.ok(body.access_token, "should return access_token");
      assert.ok(body.refresh_token, "should return refresh_token");
      assert.strictEqual(body.expires_in, 900);
      const event = await getDb()
        .prepare(
          "SELECT metadata FROM auth_events WHERE user_id = ? AND event_type = 'signup_success'",
        )
        .get(body.user_id);
      assert.deepStrictEqual(JSON.parse(event.metadata), {
        method: "email",
        name_supplied: true,
      });
    });

    it("should reject duplicate email", async () => {
      const app = getApp();
      const email = uniqueEmail();
      await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "SecurePassword123" },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "AnotherPassword123" },
      });

      assert.strictEqual(response.statusCode, 409);
      assert.strictEqual(JSON.parse(response.body).error, "EMAIL_EXISTS");
    });

    it("should reject weak password", async () => {
      const response = await getApp().inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: uniqueEmail(), password: "short" },
      });
      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid email format", async () => {
      const response = await getApp().inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: "not-an-email",
          password: "SecurePassword123",
        },
      });
      assert.strictEqual(response.statusCode, 400);
    });
  });
}

module.exports = { registerAuthSignupTests };
