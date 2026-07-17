"use strict";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initDb } = require("../src/db");
const {
  createRateLimitRepository,
} = require("../src/database/rate-limit-repository");

describe("rate-limit repository refunds", () => {
  let db;
  let repository;

  beforeEach(async () => {
    db = await initDb();
    repository = createRateLimitRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("releases the exact consumed window without going below zero", async () => {
    const consumed = await repository.consume({
      key: { subject: "ip", value: "ip:203.0.113.8" },
      action: "web_preview_ip_daily",
      max: 10,
      windowMs: 86_400_000,
    });
    assert.equal(consumed.allowed, true);

    await repository.refund(consumed);
    await repository.refund(consumed);

    const row = await db
      .prepare(
        `SELECT count FROM rate_limits
         WHERE user_id = ? AND action_type = ? AND window_start_ms = ?`,
      )
      .get(consumed.key.value, consumed.action, consumed.windowStartMs);
    assert.equal(Number(row.count), 0);
  });
});
