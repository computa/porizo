/**
 * share-followups-daily job
 *
 * Every N minutes, finds rows in share_followups whose send_at has arrived,
 * dispatches the matching share-followup email, and marks the row as sent
 * (or skipped, with a reason).
 *
 * Schedule and copy live in src/services/share-followup-service.js.
 * Template rendering lives in src/services/email-service.js.
 * Design + acceptance criteria in
 *   docs/plans/2026-05-22-share-email-followup-sequence.md
 */

const emailService = require("../services/email-service");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BATCH_SIZE = 100;

function startShareFollowupsJob({
  db,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  now = () => new Date(),
  log = (msg) => console.log(msg),
} = {}) {
  if (!db) throw new Error("startShareFollowupsJob: db is required");
  if (!emailService.isConfigured()) {
    log("[share-followups] disabled: RESEND_API_KEY not set");
    return { stop: () => {}, runNow: async () => ({ skipped: true }) };
  }

  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) return { skipped: true, reason: "already running" };
    isRunning = true;
    try {
      const due = await listDueFollowups(db, now(), batchSize);
      const results = { processed: 0, sent: 0, skipped: 0, errors: 0 };

      for (const row of due) {
        try {
          const outcome = await processFollowupRow(db, row);
          results.processed += 1;
          if (outcome === "sent") results.sent += 1;
          else if (outcome === "skipped") results.skipped += 1;
        } catch (err) {
          results.errors += 1;
          log(`[share-followups:${row.id}] error: ${err.message}`);
        }
      }
      return results;
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(() => {
    runOnce().catch((err) =>
      log(`[share-followups] unhandled error: ${err.message}`),
    );
  }, intervalMs);
  if (timer.unref) timer.unref();

  setImmediate(() => {
    runOnce().catch((err) =>
      log(`[share-followups] boot error: ${err.message}`),
    );
  });

  return {
    stop: () => clearInterval(timer),
    runNow: runOnce,
  };
}

async function listDueFollowups(db, nowDate, limit) {
  const nowIso = nowDate.toISOString();
  return db.all(
    `SELECT sf.id, sf.share_token_id, sf.sender_user_id, sf.stage, sf.send_at,
            u.email AS sender_email, u.name AS sender_name,
            u.unsubscribed_at AS sender_unsubscribed_at,
            st.status AS share_status, st.track_id, st.recipient_name
       FROM share_followups sf
       JOIN users u ON u.id = sf.sender_user_id
       LEFT JOIN share_tokens st ON st.id = sf.share_token_id
      WHERE sf.sent_at IS NULL
        AND sf.skip_reason IS NULL
        AND sf.send_at <= ?
      ORDER BY sf.send_at ASC
      LIMIT ?`,
    [nowIso, limit],
  );
}

async function processFollowupRow(db, row) {
  if (!row.sender_email) {
    await markSkipped(db, row.id, "no_sender_email");
    return "skipped";
  }
  if (row.sender_unsubscribed_at) {
    await markSkipped(db, row.id, "unsubscribed");
    return "skipped";
  }
  if (row.share_status === "revoked" || row.share_status === "expired") {
    await markSkipped(db, row.id, "share_revoked");
    return "skipped";
  }

  let trackTitle = "";
  if (row.track_id) {
    const track = await db.get(`SELECT title FROM tracks WHERE id = ?`, [
      row.track_id,
    ]);
    trackTitle = track ? track.title || "" : "";
  }

  const shareUrl = buildShareUrl(row.share_token_id);
  const { messageId } = await emailService.sendShareFollowupEmail({
    to: row.sender_email,
    senderName: row.sender_name,
    recipientName: row.recipient_name,
    trackTitle,
    shareUrl,
    stage: row.stage,
  });

  await markSent(db, row.id, messageId);
  return "sent";
}

function buildShareUrl(shareTokenId) {
  const base = process.env.PUBLIC_BASE_URL || "https://porizo.co";
  return `${base}/p/${shareTokenId}`;
}

async function markSent(db, id, resendEmailId) {
  return db.run(
    `UPDATE share_followups SET sent_at = ?, resend_email_id = ? WHERE id = ?`,
    [new Date().toISOString(), resendEmailId || null, id],
  );
}

async function markSkipped(db, id, reason) {
  return db.run(`UPDATE share_followups SET skip_reason = ? WHERE id = ?`, [
    reason,
    id,
  ]);
}

module.exports = {
  startShareFollowupsJob,
  // Exported for unit tests:
  listDueFollowups,
  processFollowupRow,
  buildShareUrl,
};
