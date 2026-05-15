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

// Gate the next fire. Replaces the previous "fire once per UTC day"
// daily-key gate with a time-interval gate plus an upper-hour bound, so
// campaigns can opt into N fires/day by lowering min_minutes_between_runs.
// Defaults (min_minutes_between_runs=1440, fire_until_utc_hour=23) preserve
// the legacy 1×/day behaviour.
function shouldFireNow(campaign, now) {
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
  const hour = now.getUTCHours();
  const fireAfter = campaign.fire_after_utc_hour ?? 9;
  if (hour < fireAfter) {
    return {
      fire: false,
      reason: `before fire-after hour (utc=${hour} < ${fireAfter})`,
    };
  }
  // Default 24 = no upper bound (gate is `hour >= fireUntil`, hour is 0..23).
  // Pre-migration rows have undefined here; the fallback keeps them firing.
  const fireUntil = campaign.fire_until_utc_hour ?? 24;
  if (hour >= fireUntil) {
    return {
      fire: false,
      reason: `after fire-until hour (utc=${hour} >= ${fireUntil})`,
    };
  }
  // Interval gate. last_run_at is an ISO-8601 string (sqlite TEXT, pg TEXT);
  // Date() parses both forms. A null/missing value means "never fired", which
  // always satisfies the interval.
  const minMinutes = campaign.min_minutes_between_runs ?? 1440;
  if (campaign.last_run_at) {
    const lastMs = new Date(campaign.last_run_at).getTime();
    if (Number.isFinite(lastMs)) {
      const elapsedMin = (now.getTime() - lastMs) / 60_000;
      if (elapsedMin < minMinutes) {
        const remaining = Math.ceil(minMinutes - elapsedMin);
        return {
          fire: false,
          reason: `interval not elapsed (${Math.floor(elapsedMin)}min < ${minMinutes}min, ${remaining}min remaining)`,
        };
      }
    }
  }
  if ((campaign.pending_count ?? 0) <= 0) {
    return { fire: false, reason: "no pending recipients" };
  }
  return { fire: true, reason: "ok" };
}

// Backward-compatible alias. Anything in the codebase still calling
// shouldFireToday now goes through the new interval-aware gate.
const shouldFireToday = shouldFireNow;

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

// Try to claim the next fire slot atomically. Returns true if we won the
// race, false otherwise. The WHERE predicate enforces the interval gate at
// the DB level so two replicas / two boot-time setImmediate calls / admin
// trigger + scheduled poll can't double-fire even if they enter
// processCampaign at the same instant.
//
// `nowIso` is the new last_run_at we want to write. `minMinutes` is the
// configured min_minutes_between_runs. `todayUtc` keeps the legacy
// last_run_date_utc column up to date for the admin "fired today?" display.
//
// The CASE expressions compute "last_run_at + minMinutes minutes" portably:
// SQLite has datetime() / julianday(), Postgres has interval arithmetic.
// Comparing ISO-8601 strings lexicographically works for same-timezone
// values (all our timestamps are UTC ISO with millisecond precision), which
// lets a single SQL string run on both engines without dialect branching.
async function claimRunSlot(db, campaignId, nowIso, todayUtc, minMinutes) {
  const cutoffMs = new Date(nowIso).getTime() - minMinutes * 60_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE cold_email_campaigns
       SET last_run_at = ?, last_run_date_utc = ?, updated_at = ?
       WHERE id = ?
         AND active = 1
         AND (last_run_at IS NULL OR last_run_at <= ?)`,
    )
    .run(nowIso, todayUtc, nowIso, campaignId, cutoffIso);
  return (result?.changes ?? 0) > 0;
}

async function releaseRunSlot(
  db,
  campaignId,
  previousLastRunAt,
  previousLastRunDateUtc,
) {
  // Restore previous state if we claimed but couldn't submit. The next poll
  // will re-evaluate the interval gate against the restored last_run_at.
  await db
    .prepare(
      "UPDATE cold_email_campaigns SET last_run_at = ?, last_run_date_utc = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      previousLastRunAt,
      previousLastRunDateUtc,
      new Date().toISOString(),
      campaignId,
    );
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
      "UPDATE cold_email_campaigns SET last_run_at = ?, last_batch_size = ?, total_queued = total_queued + ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
    )
    .run(nowIso, batchSize, batchSize, nowIso, nowIso, campaignId);
}

async function processCampaign(db, campaign, options) {
  const { apiKey, now = new Date(), fetchImpl, log = () => {} } = options;

  // Gate first — cheap reads that filter out the obvious skips.
  const decision = shouldFireNow(campaign, now);
  if (!decision.fire) {
    log(`[cold-email:${campaign.id}] skip: ${decision.reason}`);
    return { fired: false, reason: decision.reason };
  }

  const todayUtc = ymd(now);
  const nowIso = now.toISOString();
  const previousLastRunAt = campaign.last_run_at ?? null;
  const previousLastRunDateUtc = campaign.last_run_date_utc ?? null;
  const minMinutes = campaign.min_minutes_between_runs ?? 1440;

  // Atomic claim — the WHERE predicate enforces the interval gate at the
  // DB level so only one caller per (campaign, interval window) wins. Guards
  // multi-replica races, admin-trigger-vs-scheduler races, and double-clicks.
  const claimed = await claimRunSlot(
    db,
    campaign.id,
    nowIso,
    todayUtc,
    minMinutes,
  );
  if (!claimed) {
    log(
      `[cold-email:${campaign.id}] skip: another caller already claimed this slot`,
    );
    return { fired: false, reason: "already claimed by another caller" };
  }

  let rows;
  let payload;
  try {
    rows = await listPendingRecipients(db, campaign.id, campaign.per_day);
    if (rows.length === 0) {
      log(`[cold-email:${campaign.id}] skip: no pending rows (post-claim)`);
      await releaseRunSlot(
        db,
        campaign.id,
        previousLastRunAt,
        previousLastRunDateUtc,
      );
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
      await releaseRunSlot(
        db,
        campaign.id,
        previousLastRunAt,
        previousLastRunDateUtc,
      );
      return { fired: false, reason: "payload empty" };
    }

    log(
      `[cold-email:${campaign.id}] submitting ${payload.length} emails, scheduleStart=${scheduleStart.toISOString()}`,
    );
    const resp = await submitToResend(payload, apiKey, fetchImpl);
    const sent = await markBatchSent(
      db,
      campaign.id,
      rows,
      payload,
      resp,
      nowIso,
    );

    // If Resend accepted with no usable ids (empty data, all errors), treat as
    // failure — release the claim so the next interval retries this cohort.
    if (sent === 0) {
      await releaseRunSlot(
        db,
        campaign.id,
        previousLastRunAt,
        previousLastRunDateUtc,
      );
      throw new Error(
        `Resend returned no usable email ids for ${payload.length} submitted`,
      );
    }

    await recordRunStats(db, campaign.id, nowIso, sent);
    log(`[cold-email:${campaign.id}] queued ${sent}/${payload.length}`);
    if (sent < payload.length) {
      log(
        `[cold-email:${campaign.id}] WARN partial response: ${payload.length - sent} not acked, will retry next interval`,
      );
    }
    return { fired: true, queued: sent, attempted: payload.length };
  } catch (err) {
    // Anything between claim and successful submit/mark releases the claim so
    // the next interval picks up where we left off.
    try {
      await releaseRunSlot(
        db,
        campaign.id,
        previousLastRunAt,
        previousLastRunDateUtc,
      );
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
  shouldFireNow,
  shouldFireToday, // alias for backwards compat
  buildResendPayload,
  // I/O (the orchestration entry point)
  loadCampaign,
  listActiveCampaigns,
  processCampaign,
  // exported for advanced callers / tests
  RESEND_BATCH_MAX,
  RESEND_TIMEOUT_MS,
};
