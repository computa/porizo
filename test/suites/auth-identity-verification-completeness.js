const { describe, it } = require("node:test");
const assert = require("node:assert");

function registerVerificationCompletenessTests({
  getApp,
  getDb,
  createAppleUser,
  getMe,
  linkPhone,
  uniqueEmail,
  uniquePhone,
}) {
  describe("S5b: Verification-based completeness", () => {
    it("should remain incomplete when only phone is verified", async () => {
      const app = getApp();
      const relayEmail = uniqueEmail().replace(
        "@example.com",
        "@privaterelay.appleid.com",
      );
      const appleUser = await createAppleUser(app, { email: relayEmail });

      const phoneNumber = uniquePhone();
      const linkRes = await linkPhone(
        app,
        getDb(),
        appleUser.accessToken,
        phoneNumber,
      );
      assert.strictEqual(linkRes.statusCode, 200, "Phone link must succeed");

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);
      assert.strictEqual(
        me.body.needs_profile_completion,
        true,
        "Verified phone must not substitute for verified non-relay email",
      );
      assert.ok(
        me.body.missing_profile_requirements.includes("verified_email"),
      );
    });

    it("should remain incomplete when real email is on file but unverified", async () => {
      const app = getApp();
      const relayEmail = uniqueEmail().replace(
        "@example.com",
        "@privaterelay.appleid.com",
      );
      const appleUser = await createAppleUser(app, { email: relayEmail });
      const realEmail = uniqueEmail();

      await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${appleUser.accessToken}` },
        payload: {
          expected_user_id: appleUser.userId,
          contact_email: realEmail,
        },
      });

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);
      assert.strictEqual(
        me.body.needs_profile_completion,
        true,
        "Unverified real email must not satisfy profile completion",
      );
      assert.ok(
        me.body.missing_profile_requirements.includes("verified_email"),
        "Unverified email must remain a missing requirement",
      );
    });
  });
}

module.exports = { registerVerificationCompletenessTests };
