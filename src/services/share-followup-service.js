"use strict";

/**
 * Share follow-up service — pure scheduling and copy logic.
 *
 * Drives a 3-stage email sequence to the sender after they create a share
 * link. The goal is to lift return-engagement (next song) and rating
 * volume by reaching back when the moment is still warm.
 *
 * This module is intentionally DB-free so it can be unit-tested in
 * isolation. The integration layer (DB persistence, job runner, wire-in to
 * share creation) is documented in docs/plans/2026-05-22-share-email-followup-sequence.md.
 *
 * Stage schedule (from share creation time):
 *   - sender_24h:  encourage sender to send a second song / check reactions
 *   - sender_72h:  invite rating + share-back loop
 *   - sender_7d:   reactivation nudge with a specific use-case
 *
 * Each stage carries copy that can be passed straight into the matching
 * email template in email-service.js.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const FOLLOWUP_STAGES = Object.freeze([
  Object.freeze({
    stage: "sender_24h",
    delayMs: 24 * HOUR_MS,
    subject: "How did they react?",
    headline: "How did the song land?",
    body: "If it hit, the easiest way to keep the moment going is another one — a thank-you back, a sibling, a friend who hasn't heard theirs yet. The first preview is free.",
    cta: "Make another song",
    ctaPath: "/",
  }),
  Object.freeze({
    stage: "sender_72h",
    delayMs: 3 * DAY_MS,
    subject: "A favor (and a quick one)",
    headline: "If Porizo earned a song from you…",
    body: "A short rating helps more people find Porizo. It takes thirty seconds and it's the single biggest thing you can do for us. Thank you.",
    cta: "Rate Porizo",
    ctaPath: "https://apps.apple.com/app/id6758205028?action=write-review",
  }),
  Object.freeze({
    stage: "sender_7d",
    delayMs: 7 * DAY_MS,
    subject: "Someone is owed a song",
    headline: "One person you haven't sent one to yet.",
    body: "There is always one more — the parent who got skipped, the sibling who would actually cry, the friend whose birthday is in two weeks. Start with their name.",
    cta: "Start a song",
    ctaPath: "/",
  }),
]);

const STAGE_LOOKUP = Object.freeze(
  Object.fromEntries(FOLLOWUP_STAGES.map((s) => [s.stage, s])),
);

/**
 * Compute the full set of followups scheduled for a share.
 *
 * @param {Date|string|number} shareCreatedAt
 * @param {{ skipStages?: string[] }} [options]
 * @returns {Array<{ stage: string, sendAt: Date, subject: string, headline: string, body: string, cta: string, ctaPath: string }>}
 */
function computeFollowupSchedule(shareCreatedAt, options = {}) {
  const baseTime = toEpochMs(shareCreatedAt);
  if (!Number.isFinite(baseTime)) {
    throw new TypeError(
      "computeFollowupSchedule requires a valid shareCreatedAt timestamp",
    );
  }
  const skip = new Set(options.skipStages || []);
  return FOLLOWUP_STAGES.filter((s) => !skip.has(s.stage)).map((s) => ({
    stage: s.stage,
    sendAt: new Date(baseTime + s.delayMs),
    subject: s.subject,
    headline: s.headline,
    body: s.body,
    cta: s.cta,
    ctaPath: s.ctaPath,
  }));
}

/**
 * Filter a scheduled list to entries whose sendAt has arrived.
 *
 * @param {Array<{ sendAt: Date }>} scheduled
 * @param {Date|number} [now]
 * @returns {Array}
 */
function pickDueFollowups(scheduled, now = Date.now()) {
  const nowMs = toEpochMs(now);
  return scheduled.filter((entry) => toEpochMs(entry.sendAt) <= nowMs);
}

/**
 * Look up the canonical copy bundle for a stage (used by the email-service
 * layer to render the template body).
 *
 * @param {string} stage
 * @returns {{ subject: string, headline: string, body: string, cta: string, ctaPath: string } | null}
 */
function getStageCopy(stage) {
  const found = STAGE_LOOKUP[stage];
  if (!found) return null;
  return {
    subject: found.subject,
    headline: found.headline,
    body: found.body,
    cta: found.cta,
    ctaPath: found.ctaPath,
  };
}

function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

module.exports = {
  FOLLOWUP_STAGES,
  computeFollowupSchedule,
  pickDueFollowups,
  getStageCopy,
};
