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
const { createShareFollowupRepository } = require("../database/share-followup-repository");
const {
  buildPlayShareUrl,
  deriveSharePublicBaseUrl,
} = require("../utils/share-urls");

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

  const repository = createShareFollowupRepository(db);
  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) return { skipped: true, reason: "already running" };
    isRunning = true;
    try {
      const due = await listDueFollowups(db, now(), batchSize, { repository });
      const results = { processed: 0, sent: 0, skipped: 0, errors: 0 };

      for (const row of due) {
        try {
          const outcome = await processFollowupRow(db, row, { repository });
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

async function listDueFollowups(db, nowDate, limit, options = {}) {
  const repository = options.repository || createShareFollowupRepository(db);
  const nowIso = nowDate.toISOString();
  return repository.listDueFollowups(nowIso, limit);
}

async function processFollowupRow(db, row, options = {}) {
  const repository = options.repository || createShareFollowupRepository(db);
  if (!row.sender_email) {
    await markSkipped(db, row.id, "no_sender_email", { repository });
    return "skipped";
  }
  if (row.sender_unsubscribed_at) {
    await markSkipped(db, row.id, "unsubscribed", { repository });
    return "skipped";
  }
  if (row.share_status === "revoked" || row.share_status === "expired") {
    await markSkipped(db, row.id, "share_revoked", { repository });
    return "skipped";
  }

  let trackTitle = "";
  if (row.track_id) {
    const track = await repository.getTrackTitle(row.track_id);
    trackTitle = track ? track.title || "" : "";
  }

  const shareUrl = buildShareUrl(row.share_token_id);
  const { messageId } = await emailService.sendShareFollowupEmail({
    to: row.sender_email,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    recipientName: row.recipient_name,
    trackTitle,
    shareUrl,
    stage: row.stage,
  });

  await markSent(db, row.id, messageId, { repository });
  return "sent";
}

function buildShareUrl(shareTokenId) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || "https://porizo.co";
  const sharePublicBaseUrl =
    process.env.SHARE_PUBLIC_BASE_URL || deriveSharePublicBaseUrl(publicBaseUrl);
  return buildPlayShareUrl(
    {
      sharePublicBaseUrl,
      shareCoverVersion: process.env.SHARE_COVER_VERSION || "",
    },
    shareTokenId,
  );
}

async function markSent(db, id, resendEmailId, options = {}) {
  const repository = options.repository || createShareFollowupRepository(db);
  return repository.markSent(id, resendEmailId, new Date().toISOString());
}

async function markSkipped(db, id, reason, options = {}) {
  const repository = options.repository || createShareFollowupRepository(db);
  return repository.markSkipped(id, reason);
}

module.exports = {
  startShareFollowupsJob,
  // Exported for unit tests:
  listDueFollowups,
  processFollowupRow,
  buildShareUrl,
};
