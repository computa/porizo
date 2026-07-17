"use strict";

process.env.NODE_ENV = "test";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../../src/db");
const {
  convergeOrderIdentity,
} = require("../../src/services/web-order-identity");
const {
  createIdentityRepository,
} = require("../../src/database/identity-repository");
const { createPreparedDbFromQuery } = require("../../src/utils/db-adapter");

const NOW = "2026-07-16T10:00:00.000Z";

async function seedUser(db, id, accountStatus) {
  await db
    .prepare(
      "INSERT INTO users (id, created_at, risk_level, account_status) VALUES (?, ?, 'low', ?)",
    )
    .run(id, NOW, accountStatus);
  await db
    .prepare(
      "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
    )
    .run(id, NOW);
}

async function seedContact(db, { userId, email, verified }) {
  await db
    .prepare(
      `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, is_primary, is_relay, created_at)
       VALUES (?, ?, 'email', ?, ?, ?, 'magic_link', 1, 0, ?)`,
    )
    .run(
      `uc_${userId}`,
      userId,
      email.toLowerCase(),
      email,
      verified ? NOW : null,
      NOW,
    );
}

// Run the convergence inside a transaction, wiring a transaction-scoped
// identity repository — matches how the orchestrator calls it.
async function runConverge(db, { buyerUserId, email, name }) {
  return db.transaction(async (query) => {
    const identityRepository = createIdentityRepository(
      createPreparedDbFromQuery(query, db),
    );
    return convergeOrderIdentity(query, {
      buyerUserId,
      email,
      name,
      identityRepository,
    });
  });
}

describe("convergeOrderIdentity", () => {
  let db;

  beforeEach(async () => {
    db = await initDb();
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  it("(c) attaches an unverified contact for a brand-new email and promotes the guest", async () => {
    await seedUser(db, "guest", "guest");
    const result = await runConverge(db, {
      buyerUserId: "guest",
      email: "New.Buyer@Example.com",
      name: "Ada Lovelace",
    });
    assert.equal(result.outcome, "attached");
    assert.equal(result.userId, "guest");

    const contact = await db.query(
      "SELECT value_normalized, verified_at, source FROM user_contacts WHERE user_id = 'guest'",
    );
    assert.equal(contact.rows[0].value_normalized, "new.buyer@example.com");
    assert.equal(
      contact.rows[0].verified_at,
      null,
      "never auto-verified from Stripe",
    );
    assert.equal(contact.rows[0].source, "stripe_checkout");

    const user = await db.query(
      "SELECT account_status, display_name FROM users WHERE id = 'guest'",
    );
    assert.equal(user.rows[0].account_status, "active");
    // The buyer's Stripe name populates the previously-nameless account.
    assert.equal(user.rows[0].display_name, "Ada Lovelace");
  });

  it("sets display_name on the no-email promotion path, and never clobbers an existing name", async () => {
    // no-email branch: guest promoted with just a name.
    await seedUser(db, "guest", "guest");
    await runConverge(db, { buyerUserId: "guest", email: "", name: "Grace H" });
    let user = await db.query(
      "SELECT account_status, display_name FROM users WHERE id = 'guest'",
    );
    assert.equal(user.rows[0].account_status, "active");
    assert.equal(user.rows[0].display_name, "Grace H");

    // Guard: a later convergence with a different name must NOT overwrite it.
    await runConverge(db, {
      buyerUserId: "guest",
      email: "grace@example.com",
      name: "Someone Else",
    });
    user = await db.query("SELECT display_name FROM users WHERE id = 'guest'");
    assert.equal(
      user.rows[0].display_name,
      "Grace H",
      "existing display_name must not be clobbered",
    );
  });

  it("(b) merges the guest into an existing account on a VERIFIED email match", async () => {
    await seedUser(db, "guest", "guest");
    await seedUser(db, "existing", "active");
    await seedContact(db, {
      userId: "existing",
      email: "owner@example.com",
      verified: true,
    });

    const result = await runConverge(db, {
      buyerUserId: "guest",
      email: "owner@example.com",
    });
    assert.equal(result.outcome, "merged");
    assert.equal(result.userId, "existing");

    const guest = await db.query(
      "SELECT deleted_at FROM users WHERE id = 'guest'",
    );
    assert.ok(guest.rows[0].deleted_at, "guest soft-deleted after merge");
  });

  it("(b→c) does NOT merge on an UNVERIFIED matching contact (no takeover via typo)", async () => {
    await seedUser(db, "guest", "guest");
    await seedUser(db, "existing", "active");
    await seedContact(db, {
      userId: "existing",
      email: "owner@example.com",
      verified: false,
    });

    const result = await runConverge(db, {
      buyerUserId: "guest",
      email: "owner@example.com",
    });
    assert.equal(
      result.outcome,
      "attached",
      "unverified match attaches to guest, no merge",
    );
    assert.equal(result.userId, "guest");

    const guest = await db.query(
      "SELECT deleted_at FROM users WHERE id = 'guest'",
    );
    assert.equal(guest.rows[0].deleted_at, null, "guest NOT deleted");
    const buyerContact = await db.query(
      "SELECT source FROM user_contacts WHERE user_id = 'guest'",
    );
    assert.equal(buyerContact.rows[0].source, "stripe_checkout");
  });

  it("(a) is a no-op when the buyer is already a non-guest account", async () => {
    await seedUser(db, "buyer", "active");
    const result = await runConverge(db, {
      buyerUserId: "buyer",
      email: "buyer@example.com",
    });
    assert.equal(result.outcome, "existing_account");
    const contacts = await db.query(
      "SELECT COUNT(*) AS c FROM user_contacts WHERE user_id = 'buyer'",
    );
    assert.equal(
      Number(contacts.rows[0].c),
      0,
      "no contact attached for existing account",
    );
  });

  it("does not double-attach a contact on a second convergence (idempotent)", async () => {
    await seedUser(db, "guest", "guest");
    await runConverge(db, { buyerUserId: "guest", email: "buyer@example.com" });
    // Re-run against the (now active) user — treated as existing_account no-op.
    await runConverge(db, { buyerUserId: "guest", email: "buyer@example.com" });
    const contacts = await db.query(
      "SELECT COUNT(*) AS c FROM user_contacts WHERE user_id = 'guest'",
    );
    assert.equal(Number(contacts.rows[0].c), 1);
  });
});
