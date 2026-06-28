"use strict";

function normalizeCampaign(row, pendingCount) {
  if (!row) return null;
  return {
    ...row,
    active: Number(row.active) === 1 ? 1 : 0,
    pending_count: Number(pendingCount ?? row.pending_count ?? 0),
  };
}

function createColdEmailRepository(db) {
  const PATCHABLE_CAMPAIGN_FIELDS = new Set([
    "subject",
    "campaign_tag",
    "from_address",
    "reply_to",
    "per_day",
    "schedule_pace_seconds",
    "schedule_offset_minutes",
    "fire_after_utc_hour",
    "fire_until_utc_hour",
    "min_minutes_between_runs",
    "active",
    "earliest_run_date_utc",
  ]);

  async function loadCampaign(campaignId) {
    const campaign = await db
      .prepare("SELECT * FROM cold_email_campaigns WHERE id = ?")
      .get(campaignId);
    if (!campaign) return null;

    const pending = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM cold_email_recipients WHERE campaign_id = ? AND sent_at IS NULL",
      )
      .get(campaignId);

    return normalizeCampaign(campaign, pending?.n);
  }

  async function listActiveCampaigns() {
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

    return rows.map((row) => normalizeCampaign(row));
  }

  async function listAllCampaigns() {
    return db
      .prepare("SELECT * FROM cold_email_campaigns ORDER BY created_at DESC")
      .all();
  }

  async function listTemplateReferences() {
    return db
      .prepare(
        `SELECT DISTINCT
          template_html_path AS html_path,
          template_text_path AS text_path
         FROM cold_email_campaigns
         ORDER BY html_path ASC, text_path ASC`,
      )
      .all();
  }

  async function listPendingRecipients(campaignId, limit) {
    return db
      .prepare(
        `SELECT * FROM cold_email_recipients r
       WHERE r.campaign_id = ? AND r.sent_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM users u
           WHERE LOWER(u.email) = LOWER(r.email)
             AND u.unsubscribed_at IS NOT NULL
         )
       ORDER BY r.index_pos ASC LIMIT ?`,
      )
      .all(campaignId, limit);
  }

  async function claimRunSlot(campaignId, nowIso, todayUtc, minMinutes) {
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

  async function releaseRunSlot(campaignId, previousLastRunAt, previousLastRunDateUtc) {
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

  async function markBatchSent(campaignId, rows, payload, resendResp, nowIso) {
    const items = Array.isArray(resendResp?.data) ? resendResp.data : [];
    const update = db.prepare(
      "UPDATE cold_email_recipients SET sent_at = ?, resend_email_id = ?, scheduled_at = ? WHERE campaign_id = ? AND index_pos = ?",
    );
    let ok = 0;
    for (let i = 0; i < rows.length && i < items.length; i++) {
      const id = items[i]?.id;
      if (!id) continue;
      const indexPos = payload[i]?.source_index_pos ?? rows[i].index_pos;
      await update.run(
        nowIso,
        id,
        payload[i].scheduled_at,
        campaignId,
        indexPos,
      );
      ok++;
    }
    return ok;
  }

  async function recordRunStats(campaignId, nowIso, batchSize) {
    await db
      .prepare(
        "UPDATE cold_email_campaigns SET last_run_at = ?, last_batch_size = ?, total_queued = total_queued + ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
      )
      .run(nowIso, batchSize, batchSize, nowIso, nowIso, campaignId);
  }

  async function updateCampaignFields(campaignId, changes, expectedUpdatedAt, updatedAt) {
    const entries = Object.entries(changes || {});
    if (entries.length === 0) return false;

    const updates = [];
    const params = [];
    for (const [field, value] of entries) {
      if (!PATCHABLE_CAMPAIGN_FIELDS.has(field)) {
        throw new Error(`unsupported cold-email campaign patch field: ${field}`);
      }
      updates.push(`${field} = ?`);
      params.push(value);
    }

    updates.push("updated_at = ?");
    params.push(updatedAt);
    params.push(campaignId);
    params.push(expectedUpdatedAt ?? "");

    const result = await db
      .prepare(
        `UPDATE cold_email_campaigns SET ${updates.join(", ")}
         WHERE id = ? AND COALESCE(updated_at, '') = ?`,
      )
      .run(...params);

    return (result?.changes ?? 0) > 0;
  }

  return {
    loadCampaign,
    listActiveCampaigns,
    listAllCampaigns,
    listTemplateReferences,
    listPendingRecipients,
    claimRunSlot,
    releaseRunSlot,
    markBatchSent,
    recordRunStats,
    updateCampaignFields,
  };
}

module.exports = { createColdEmailRepository };
