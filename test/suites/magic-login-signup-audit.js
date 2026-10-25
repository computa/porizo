const { it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMagicLoginRepository,
} = require("../../src/database/magic-login-repository");
const {
  createMagicLoginService,
} = require("../../src/services/magic-login-service");

function registerMagicLoginSignupAuditTest({ getApp, getDb }) {
  it("creates an account only after an unknown email completes the two-secret exchange", async () => {
    const app = getApp();
    const db = getDb();
    const email = "new-magic-user@example.com";
    const created = await createMagicLoginService({
      repository: createMagicLoginRepository(db),
    }).createTransaction({
      email,
      platform: "ios",
      purpose: "login",
      requesterKey: "new-user-requester-key",
    });
    assert.equal(
      await db.prepare("SELECT id FROM users WHERE email = ?").get(email),
      undefined,
    );

    const response = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().is_new_user, true);
    assert.ok(response.json().access_token);
    const user = await db
      .prepare("SELECT id, email, email_verified FROM users WHERE email = ?")
      .get(email);
    assert.ok(user?.id);
    assert.equal(Boolean(user.email_verified), true);
    const entitlement = await db
      .prepare("SELECT tier FROM entitlements WHERE user_id = ?")
      .get(user.id);
    assert.equal(entitlement?.tier, "free");

    const events = await db
      .prepare("SELECT event_type, metadata FROM auth_events WHERE user_id = ?")
      .all(user.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "signup_success");
    assert.deepEqual(JSON.parse(events[0].metadata), {
      method: "magic_email",
      name_supplied: false,
      platform: "ios",
    });

    const replay = await app.inject({
      method: "POST",
      url: "/auth/magic/exchange",
      payload: {
        transaction_id: created.transactionId,
        platform: "ios",
        link_secret: created.linkSecret,
        request_secret: created.requestSecret,
      },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().user_id, user.id);
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_events WHERE user_id = ? AND event_type = 'signup_success'",
      )
      .get(user.id);
    assert.equal(Number(count.count), 1);
  });
}

module.exports = { registerMagicLoginSignupAuditTest };
