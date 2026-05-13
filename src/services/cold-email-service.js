/**
 * Cold-email campaign service.
 *
 * Replaces marketing/email/cold-daily-send.py + macOS launchd. State lives
 * in Postgres in production (cold_email_campaigns + cold_email_recipients).
 *
 * Pure decision logic (shouldFireToday, buildResendPayload, computeScheduleStart)
 * lives separately from the I/O so it can be unit-tested without a DB or
 * Resend account.
 *
 * Every DB call MUST be awaited — the Postgres adapter's prepare().get/all/run
 * returns Promises, the SQLite adapter returns values synchronously, and
 * `await` on a non-Promise is a harmless no-op so the same code runs in both.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES_ROOT = path.resolve(REPO_ROOT, "marketing", "email");
const RESEND_BATCH_MAX = 100;
const RESEND_TIMEOUT_MS = 30_000;

const SCHEMA_VERSION = "1.0";

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function computeScheduleStart(now, offsetMinutes) {
  return new Date(now.getTime() + offsetMinutes * 60_000);
}

function shouldFireToday(campaign, now) {
  if (!campaign) return { fire: false, reason: "no campaign loaded" };
  if (!campaign.active) return { fire: false, reason: "campaign inactive" };

  const todayUtc = ymd(now);
  if (
    campaign.earliest_run_date_utc &&
    todayUtc < campaign.earliest_run_date_utc
  ) {
    return {
      fire: false,
      reason: `too early: today=${todayUtc} < earliest=${campaign.earliest_run_date_utc}`,
    };
  }
  if (campaign.last_run_date_utc === todayUtc) {
    return { fire: false, reason: "already ran today" };
  }
  const hour = now.getUTCHours();
  if (hour < (campaign.fire_after_utc_hour ?? 9)) {
    return {
      fire: false,
      reason: `before fire-after hour (utc=${hour} < ${campaign.fire_after_utc_hour})`,
    };
  }
  if ((campaign.pending_count ?? 0) <= 0) {
    return { fire: false, reason: "no pending recipients" };
  }
  return { fire: true, reason: "ok" };
}

// Sandbox a campaign-provided template path to the templates root so a
// DB-write attacker cannot exfiltrate arbitrary repo files (../../.env,
// secrets.json, …) by setting template_html_path to a traversal string.
function safeTemplatePath(rel) {
  const abs = path.resolve(REPO_ROOT, rel);
  if (abs !== TEMPLATES_ROOT && !abs.startsWith(TEMPLATES_ROOT + path.sep)) {
    throw new Error(`template path escapes templates root: ${rel}`);
  }
  return abs;
}

function buildResendPayload(rows, options) {
  const { campaign, htmlTemplate, textTemplate, scheduleStart } = options;
  const pace = campaign.schedule_pace_seconds;
  const out = [];
  let queueIndex = 0;
  for (const row of rows) {
    const email = (row.email ?? "").trim();
    if (!email || !email.includes("@")) continue;
    const firstName = row.first_name ?? "";
    const scheduled = new Date(
      scheduleStart.getTime() + queueIndex * pace * 1000,
    );
    out.push({
      from: campaign.from_address,
      to: [email],
      reply_to: campaign.reply_to,
      subject: campaign.subject,
      html: htmlTemplate.replaceAll("{{first_name}}", firstName),
      text: textTemplate.replaceAll("{{first_name}}", firstName),
      scheduled_at: scheduled.toISOString(),
      tags: [
        { name: "campaign", value: campaign.id },
        { name: "cohort", value: campaign.campaign_tag },
      ],
    });
    queueIndex++;
  }
  return out;
}

// ---------- I/O layer ----------

async function loadCampaign(db, campaignId) {
  const camp = await db
    .prepare("SELECT * FROM cold_email_campaigns WHERE id = ?")
    .get(campaignId);
  if (!camp) return null;
  const pending = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cold_email_recipients WHERE campaign_id = ? AND sent_at IS NULL",
    )
    .get(campaignId);
  return {
    ...camp,
    active: Number(camp.active) === 1 ? 1 : 0,
    pending_count: Number(pending?.n ?? 0),
  };
}

async function listActiveCampaigns(db) {
  // Single query with LEFT JOIN of pending counts — avoids N+1.
  const rows = await db
    .prepare(
      `SELECT c.*, COALESCE(p.n, 0) AS pending_count
       FROM cold_email_campaigns c
       LEFT JOIN (
         SELECT campaign_id, COUNT(*) AS n
         FROM cold_email_recipients
         WHERE sent_at IS NULL
         GROUP BY campaign_id
       ) p ON p.campaign_id = c.id
       WHERE c.active = 1`,
    )
    .all();
  return rows.map((row) => ({
    ...row,
    active: Number(row.active) === 1 ? 1 : 0,
    pending_count: Number(row.pending_count ?? 0),
  }));
}

async function listPendingRecipients(db, campaignId, limit) {
  return db
    .prepare(
      "SELECT * FROM cold_email_recipients WHERE campaign_id = ? AND sent_at IS NULL ORDER BY index_pos ASC LIMIT ?",
    )
    .all(campaignId, limit);
}

async function loadTemplates(campaign) {
  const htmlPath = safeTemplatePath(campaign.template_html_path);
  const textPath = safeTemplatePath(campaign.template_text_path);
  const html = await fs.promises.readFile(htmlPath, "utf8");
  const text = await fs.promises.readFile(textPath, "utf8");
  return { html, text };
}

async function submitToResend(payload, apiKey, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const res = await fetchImpl("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "porizo-mailer/1.0",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Resend batch failed ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const body = await res.json();
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Try to claim today's fire slot atomically. Returns true if we won the race,
// false otherwise. Prevents two replicas / two boot-time setImmediate calls /
// admin trigger + scheduled poll from double-sending.
async function claimDailyFireSlot(db, campaignId, todayUtc) {
  const result = await db
    .prepare(
      `UPDATE cold_email_campaigns
       SET last_run_date_utc = ?
       WHERE id = ?
         AND active = 1
         AND (last_run_date_utc IS NULL OR last_run_date_utc < ?)`,
    )
    .run(todayUtc, campaignId, todayUtc);
  return (result?.changes ?? 0) > 0;
}

async function releaseDailyFireSlot(db, campaignId, previousLastRunDateUtc) {
  // Restore previous state if we claimed but couldn't submit.
  await db
    .prepare(
      "UPDATE cold_email_campaigns SET last_run_date_utc = ? WHERE id = ?",
    )
    .run(previousLastRunDateUtc, campaignId);
}

async function markBatchSent(
  db,
  campaignId,
  rows,
  payload,
  resendResp,
  nowIso,
) {
  const items = Array.isArray(resendResp?.data) ? resendResp.data : [];
  const update = db.prepare(
    "UPDATE cold_email_recipients SET sent_at = ?, resend_email_id = ?, scheduled_at = ? WHERE campaign_id = ? AND index_pos = ?",
  );
  let ok = 0;
  for (let i = 0; i < rows.length && i < items.length; i++) {
    const id = items[i]?.id;
    if (!id) continue;
    await update.run(
      nowIso,
      id,
      payload[i].scheduled_at,
      campaignId,
      rows[i].index_pos,
    );
    ok++;
  }
  return ok;
}

async function recordRunStats(db, campaignId, nowIso, batchSize) {
  await db
    .prepare(
      "UPDATE cold_email_campaigns SET last_run_at = ?, last_batch_size = ?, total_queued = total_queued + ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
    )
    .run(nowIso, batchSize, batchSize, nowIso, campaignId);
}

async function processCampaign(db, campaign, options) {
  const { apiKey, now = new Date(), fetchImpl, log = () => {} } = options;

  // Gate first — cheap reads that filter out the obvious skips.
  const decision = shouldFireToday(campaign, now);
  if (!decision.fire) {
    log(`[cold-email:${campaign.id}] skip: ${decision.reason}`);
    return { fired: false, reason: decision.reason };
  }

  const todayUtc = ymd(now);
  const previousLastRunDateUtc = campaign.last_run_date_utc ?? null;

  // Atomic claim — only one caller per (campaign, day) wins this. Guards
  // multi-replica races, admin-trigger-vs-scheduler races, and double-clicks.
  const claimed = await claimDailyFireSlot(db, campaign.id, todayUtc);
  if (!claimed) {
    log(
      `[cold-email:${campaign.id}] skip: another caller already claimed today`,
    );
    return { fired: false, reason: "already claimed by another caller" };
  }

  let rows;
  let payload;
  try {
    rows = await listPendingRecipients(db, campaign.id, campaign.per_day);
    if (rows.length === 0) {
      log(`[cold-email:${campaign.id}] skip: no pending rows (post-claim)`);
      await releaseDailyFireSlot(db, campaign.id, previousLastRunDateUtc);
      return { fired: false, reason: "no pending" };
    }

    if (campaign.per_day > RESEND_BATCH_MAX) {
      throw new Error(
        `per_day=${campaign.per_day} exceeds Resend batch limit ${RESEND_BATCH_MAX}`,
      );
    }

    const { html, text } = await loadTemplates(campaign);
    const scheduleStart = computeScheduleStart(
      now,
      campaign.schedule_offset_minutes,
    );
    payload = buildResendPayload(rows, {
      campaign,
      htmlTemplate: html,
      textTemplate: text,
      scheduleStart,
    });

    if (payload.length === 0) {
      log(`[cold-email:${campaign.id}] skip: payload empty after filtering`);
      await releaseDailyFireSlot(db, campaign.id, previousLastRunDateUtc);
      return { fired: false, reason: "payload empty" };
    }

    log(
      `[cold-email:${campaign.id}] submitting ${payload.length} emails, scheduleStart=${scheduleStart.toISOString()}`,
    );
    const resp = await submitToResend(payload, apiKey, fetchImpl);
    const nowIso = now.toISOString();
    const sent = await markBatchSent(
      db,
      campaign.id,
      rows,
      payload,
      resp,
      nowIso,
    );

    // If Resend accepted with no usable ids (empty data, all errors), treat as
    // failure — release the claim so tomorrow's run retries this cohort.
    if (sent === 0) {
      await releaseDailyFireSlot(db, campaign.id, previousLastRunDateUtc);
      throw new Error(
        `Resend returned no usable email ids for ${payload.length} submitted`,
      );
    }

    await recordRunStats(db, campaign.id, nowIso, sent);
    log(`[cold-email:${campaign.id}] queued ${sent}/${payload.length}`);
    if (sent < payload.length) {
      log(
        `[cold-email:${campaign.id}] WARN partial response: ${payload.length - sent} not acked, will retry next day`,
      );
    }
    return { fired: true, queued: sent, attempted: payload.length };
  } catch (err) {
    // Anything between claim and successful submit/mark releases the claim so
    // tomorrow's run picks up where we left off.
    try {
      await releaseDailyFireSlot(db, campaign.id, previousLastRunDateUtc);
    } catch (relErr) {
      log(
        `[cold-email:${campaign.id}] ERROR releasing claim: ${relErr.message}`,
      );
    }
    throw err;
  }
}

module.exports = {
  // pure
  SCHEMA_VERSION,
  ymd,
  computeScheduleStart,
  shouldFireToday,
  buildResendPayload,
  // I/O (the orchestration entry point)
  loadCampaign,
  listActiveCampaigns,
  processCampaign,
  // exported for advanced callers / tests
  RESEND_BATCH_MAX,
  RESEND_TIMEOUT_MS,
};
