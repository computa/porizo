"use strict";

process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { initDb } = require("../src/db");
const {
  createReceiverSessionService,
} = require("../src/services/receiver-session-service");

async function makeService(t) {
  const db = await initDb({
    dbPath: ":memory:",
    migrationsDir: path.join(process.cwd(), "migrations"),
  });
  t.after(() => db.close());
  return { db, service: createReceiverSessionService(db) };
}

test("receiver-session service persists events and only reuses sessions with a valid secret", async (t) => {
  const { db, service } = await makeService(t);
  const shareId = "share_service_secret";

  const first = await service.recordEvent({
    shareId,
    contentKind: "song",
    eventName: "receiver_link_opened",
    metadata: { source: "sms", "invalid-key-with-dash": "drop" },
    ip: "203.0.113.10",
    userAgent: "service-test",
  });

  assert.equal(first.recorded, true);
  assert.match(first.receiverSessionId, /^rs_[a-f0-9]{24}$/);
  assert.match(first.receiverSessionSecret, /^[a-f0-9]{48}$/);
  assert.match(first.receiverHandoffId, /^rh_[a-f0-9]{24}$/);

  const trusted = await service.getSessionForShare(
    first.receiverSessionId,
    shareId,
    first.receiverSessionSecret,
  );
  assert.equal(trusted.id, first.receiverSessionId);
  assert.equal(trusted.share_id, shareId);
  assert.equal(trusted.first_event_name, "receiver_link_opened");

  assert.equal(
    await service.getSessionForShare(first.receiverSessionId, shareId, null),
    null,
  );
  assert.equal(
    await service.getSessionForShare(
      first.receiverSessionId,
      "share_other",
      first.receiverSessionSecret,
    ),
    null,
  );

  const missingSecretReuse = await service.recordExistingSessionEvent({
    receiverSessionId: first.receiverSessionId,
    shareId,
    contentKind: "song",
    eventName: "receiver_play_started",
  });
  assert.deepEqual(missingSecretReuse, {
    receiverSessionId: null,
    receiverSessionSecret: null,
    receiverHandoffId: null,
    eventId: null,
    recorded: false,
  });

  const reused = await service.recordExistingSessionEvent({
    receiverSessionId: first.receiverSessionId,
    receiverSessionSecret: first.receiverSessionSecret,
    shareId,
    contentKind: "song",
    eventName: "receiver_play_started",
    metadata: { progress: 30 },
    ip: "203.0.113.11",
    userAgent: "service-test-2",
  });
  assert.equal(reused.recorded, true);
  assert.equal(reused.receiverSessionId, first.receiverSessionId);
  assert.equal(reused.receiverSessionSecret, first.receiverSessionSecret);

  const sessionRow = db
    .prepare("SELECT last_event_name, last_ip_address FROM receiver_sessions WHERE id = ?")
    .get(first.receiverSessionId);
  assert.deepEqual(sessionRow, {
    last_event_name: "receiver_play_started",
    last_ip_address: "203.0.113.11",
  });

  const events = db
    .prepare(
      "SELECT event_name, metadata_json FROM receiver_session_events WHERE receiver_session_id = ? ORDER BY created_at, id",
    )
    .all(first.receiverSessionId);
  assert.equal(events.length, 2);
  assert.equal(events[0].event_name, "receiver_link_opened");
  const linkOpenedMetadata = JSON.parse(events[0].metadata_json);
  assert.deepEqual(linkOpenedMetadata, { source: "sms" });
  assert.equal(Object.hasOwn(linkOpenedMetadata, "invalid-key-with-dash"), false);
  assert.deepEqual(JSON.parse(events[1].metadata_json), { progress: "30" });
});

test("receiver-session service enforces the per-session event limit before inserting", async (t) => {
  const { db, service } = await makeService(t);
  const shareId = "share_service_event_limit";

  const first = await service.recordEvent({
    shareId,
    contentKind: "song",
    eventName: "receiver_link_opened",
  });
  const now = new Date().toISOString();
  for (let i = 0; i < 249; i += 1) {
    db.prepare(
      `INSERT INTO receiver_session_events
        (id, receiver_session_id, share_id, event_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `rse_limit_${String(i).padStart(3, "0")}`,
      first.receiverSessionId,
      shareId,
      "receiver_play_started",
      "{}",
      now,
    );
  }

  await assert.rejects(
    service.recordExistingSessionEvent({
      receiverSessionId: first.receiverSessionId,
      receiverSessionSecret: first.receiverSessionSecret,
      shareId,
      contentKind: "song",
      eventName: "receiver_play_completed",
    }),
    (err) => err?.code === "RECEIVER_SESSION_EVENT_LIMIT",
  );

  const count = db
    .prepare(
      "SELECT COUNT(*) AS count FROM receiver_session_events WHERE receiver_session_id = ?",
    )
    .get(first.receiverSessionId);
  assert.equal(Number(count.count), 250);
});

test("receiver-session service resolves handoffs once and rejects expired handoffs", async (t) => {
  const { db, service } = await makeService(t);

  const fresh = await service.recordEvent({
    shareId: "share_service_handoff",
    contentKind: "poem",
    eventName: "receiver_save_cta_clicked",
  });

  const resolved = await service.resolveHandoff(fresh.receiverHandoffId);
  assert.deepEqual(resolved, {
    shareId: "share_service_handoff",
    receiverSessionId: fresh.receiverSessionId,
    contentKind: "poem",
    handoffResolvedAt: null,
  });

  assert.equal(await service.resolveHandoff(fresh.receiverHandoffId), null);
  const consumed = await service.lookupHandoff(fresh.receiverHandoffId);
  assert.equal(consumed.receiverSessionId, fresh.receiverSessionId);
  assert.ok(consumed.handoffResolvedAt);

  const expired = await service.recordEvent({
    shareId: "share_service_handoff_expired",
    contentKind: "song",
    eventName: "receiver_save_cta_clicked",
  });
  db.prepare(
    "UPDATE receiver_sessions SET handoff_expires_at = ? WHERE id = ?",
  ).run(new Date(Date.now() - 1000).toISOString(), expired.receiverSessionId);
  assert.equal(await service.lookupHandoff(expired.receiverHandoffId), null);
  assert.equal(await service.resolveHandoff(expired.receiverHandoffId), null);
});

test("receiver-session service issues, looks up, consumes, and replays claim tokens by explicit policy", async (t) => {
  const { db, service } = await makeService(t);

  const session = await service.recordEvent({
    shareId: "share_service_claim",
    contentKind: "song",
    eventName: "receiver_save_cta_clicked",
  });

  assert.equal(
    await service.issueReceiverClaimToken({
      receiverSessionId: session.receiverSessionId,
      shareId: "share_service_claim",
      contentKind: "poem",
    }),
    null,
  );

  const issued = await service.issueReceiverClaimToken({
    receiverSessionId: session.receiverSessionId,
    shareId: "share_service_claim",
    contentKind: "song",
  });
  assert.match(issued.receiverClaimToken, /^rc_[a-f0-9]{32}$/);
  assert.ok(issued.expiresAt);

  assert.deepEqual(
    await service.lookupReceiverClaimToken(issued.receiverClaimToken),
    {
      receiverSessionId: session.receiverSessionId,
      shareId: "share_service_claim",
      contentKind: "song",
      expiresAt: issued.expiresAt,
      consumedAt: null,
    },
  );

  assert.equal(await service.consumeReceiverClaimToken(issued.receiverClaimToken), true);
  assert.equal(await service.consumeReceiverClaimToken(issued.receiverClaimToken), false);
  assert.equal(await service.lookupReceiverClaimToken(issued.receiverClaimToken), null);

  const consumed = await service.lookupReceiverClaimToken(
    issued.receiverClaimToken,
    { allowConsumed: true },
  );
  assert.equal(consumed.receiverSessionId, session.receiverSessionId);
  assert.ok(consumed.consumedAt);
  const sessionRow = db
    .prepare("SELECT handoff_resolved_at FROM receiver_sessions WHERE id = ?")
    .get(session.receiverSessionId);
  assert.ok(sessionRow.handoff_resolved_at);

  const expired = await service.issueReceiverClaimToken({
    receiverSessionId: session.receiverSessionId,
    shareId: "share_service_claim",
    contentKind: "song",
  });
  const tokenHash = db
    .prepare("SELECT token_hash FROM receiver_claim_tokens WHERE consumed_at IS NULL")
    .get().token_hash;
  db.prepare(
    "UPDATE receiver_claim_tokens SET expires_at = ? WHERE token_hash = ?",
  ).run(new Date(Date.now() - 1000).toISOString(), tokenHash);
  assert.equal(await service.lookupReceiverClaimToken(expired.receiverClaimToken), null);
});

test("receiver-session service does not resolve handoff when stale claim-token consume changes zero rows", async () => {
  const claimToken = `rc_${"a".repeat(32)}`;
  const repository = {
    async findUnconsumedReceiverClaimToken(claimTokenHash) {
      assert.match(claimTokenHash, /^[a-f0-9]{64}$/);
      return { receiver_session_id: "rs_stale_claim_race" };
    },
    async consumeReceiverClaimToken(claimTokenHash, now) {
      assert.match(claimTokenHash, /^[a-f0-9]{64}$/);
      assert.equal(Number.isNaN(Date.parse(now)), false);
      return { changes: 0 };
    },
    async markHandoffResolvedIfUnset() {
      assert.fail("markHandoffResolvedIfUnset must not be called after a stale consume");
    },
  };

  const service = createReceiverSessionService(null, { repository });

  assert.equal(await service.consumeReceiverClaimToken(claimToken), false);
});

test("receiver-session service records app opens and marks matched users from trusted handoffs", async (t) => {
  const { db, service } = await makeService(t);

  const session = await service.recordEvent({
    shareId: "share_service_app_open",
    contentKind: "song",
    eventName: "receiver_save_cta_clicked",
  });
  const opened = await service.markAppOpened({
    receiverSessionId: session.receiverSessionId,
    shareId: "share_service_app_open",
    contentKind: "song",
    userId: "user_matched",
    ip: "203.0.113.12",
    userAgent: "PorizoApp/1.0",
  });

  assert.equal(opened.recorded, true);
  assert.equal(opened.receiverSessionId, session.receiverSessionId);
  const sessionRow = db
    .prepare("SELECT matched_user_id, last_event_name FROM receiver_sessions WHERE id = ?")
    .get(session.receiverSessionId);
  assert.deepEqual(sessionRow, {
    matched_user_id: "user_matched",
    last_event_name: "receiver_app_opened",
  });
  const event = db
    .prepare(
      "SELECT event_name, metadata_json, ip_address, user_agent FROM receiver_session_events WHERE id = ?",
    )
    .get(opened.eventId);
  assert.equal(event.event_name, "receiver_app_opened");
  assert.deepEqual(JSON.parse(event.metadata_json), {
    matched_user_id: "user_matched",
  });
  assert.equal(event.ip_address, "203.0.113.12");
  assert.equal(event.user_agent, "PorizoApp/1.0");
});
