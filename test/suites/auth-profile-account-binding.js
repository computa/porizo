const { describe, it } = require("node:test");
const assert = require("node:assert");

function registerProfileAccountBindingTests({ getApp, getDb, uniqueEmail }) {
  describe("Profile account binding", () => {
    it("rejects a retry authenticated as a different account before mutating either profile", async () => {
      const app = getApp();
      const db = getDb();
      const accounts = [];
      for (const name of ["Account A", "Account B"]) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/signup",
          payload: {
            email: uniqueEmail(),
            password: "SecurePassword123",
            name,
          },
        });
        assert.strictEqual(response.statusCode, 201, response.body);
        accounts.push(response.json());
      }

      const [accountA, accountB] = accounts;
      const response = await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${accountB.access_token}` },
        payload: {
          expected_user_id: accountA.user_id,
          display_name: "Wrong account",
        },
      });
      assert.strictEqual(response.statusCode, 409, response.body);
      assert.strictEqual(response.json().error, "ACCOUNT_CHANGED");

      for (const [index, account] of accounts.entries()) {
        const user = await db
          .prepare("SELECT display_name FROM users WHERE id = ?")
          .get(account.user_id);
        assert.strictEqual(
          user.display_name,
          index === 0 ? "Account A" : "Account B",
        );
      }

      const saved = await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${accountA.access_token}` },
        payload: {
          expected_user_id: accountA.user_id,
          display_name: "Updated A",
        },
      });
      assert.strictEqual(saved.statusCode, 200, saved.body);
      assert.strictEqual(saved.json().display_name, "Updated A");

      const missingBinding = await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${accountA.access_token}` },
        payload: { display_name: "Unbound" },
      });
      assert.strictEqual(missingBinding.statusCode, 400, missingBinding.body);
    });
  });
}

module.exports = { registerProfileAccountBindingTests };
