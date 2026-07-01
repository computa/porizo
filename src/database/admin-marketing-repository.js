"use strict";

const { createPreparedDbFromQuery } = require("../utils/db-adapter");

const CAMPAIGN_UPDATE_COLUMNS = new Set([
  "name",
  "type",
  "status",
  "template_id",
  "sent_at",
  "recipient_count",
  "opens",
  "clicks",
  "replies",
  "bounces",
  "unsubscribes",
  "notes",
  "updated_at",
]);

function escapeLikePattern(str) {
  return String(str || "").replace(/[%_\\]/g, "\\$&");
}

function changesFrom(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function buildContactFilters({ search, category, status } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    const escaped = escapeLikePattern(search);
    conditions.push(
      "(first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\')",
    );
    params.push(
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
    );
  }
  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  return { conditions, params };
}

function buildEngagementFilters(filters = {}) {
  const clauses = [];
  const params = [];
  for (const field of ["opened", "clicked", "replied", "bounced"]) {
    if (filters[field] !== undefined) {
      clauses.push(` AND me.${field} = ?`);
      params.push(filters[field]);
    }
  }
  return { sql: clauses.join(""), params };
}

function createAdminMarketingRepository(db) {
  async function listContacts({ search, category, status, limit, offset }) {
    const { conditions, params } = buildContactFilters({
      search,
      category,
      status,
    });
    let sql = "SELECT * FROM marketing_contacts";
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

    const contacts = await db.prepare(sql).all(...params, limit, offset);

    let countSql = "SELECT COUNT(*) AS total FROM marketing_contacts";
    if (conditions.length) {
      countSql += ` WHERE ${conditions.join(" AND ")}`;
    }
    const count = await db.prepare(countSql).get(...params);

    return {
      contacts,
      total: Number(count?.total || 0),
    };
  }

  async function importContacts({ rows, now, dbOverride = db }) {
    const insertedRows = [];
    let skipped = 0;

    const insertStmt = dbOverride.prepare(`
      INSERT INTO marketing_contacts (
        id, first_name, last_name, company_name, website, description,
        contact_name, email, category, score, icp_fit_reasoning,
        audience_reach, partnership_opportunity, contact_approach,
        source_file, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    for (const row of rows) {
      if (row.email) {
        const existing = await dbOverride
          .prepare("SELECT id FROM marketing_contacts WHERE email = ?")
          .get(row.email);
        if (existing) {
          skipped++;
          continue;
        }
      } else if (row.companyName) {
        const existing = await dbOverride
          .prepare(
            "SELECT id FROM marketing_contacts WHERE company_name = ? AND (website = ? OR (website IS NULL AND ? IS NULL))",
          )
          .get(row.companyName, row.website, row.website);
        if (existing) {
          skipped++;
          continue;
        }
      } else {
        skipped++;
        continue;
      }

      await insertStmt.run(
        row.id,
        row.firstName,
        row.lastName,
        row.companyName,
        row.website,
        row.description,
        row.contactName,
        row.email,
        row.category,
        row.score,
        row.icpFitReasoning,
        row.audienceReach,
        row.partnershipOpportunity,
        row.contactApproach,
        row.sourceFile,
        now,
        now,
      );
      insertedRows.push(row);
    }

    return { inserted: insertedRows.length, skipped };
  }

  async function importContactsTransaction({ rows, now }) {
    if (typeof db.transaction !== "function") {
      throw new Error("Admin marketing contact import requires transactions");
    }
    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      return importContacts({ rows, now, dbOverride: txDb });
    });
  }

  async function listCampaigns() {
    return db
      .prepare("SELECT * FROM marketing_campaigns ORDER BY created_at DESC")
      .all();
  }

  async function getCampaignById(id) {
    return db.prepare("SELECT * FROM marketing_campaigns WHERE id = ?").get(id);
  }

  async function campaignExists(id) {
    const row = await db
      .prepare("SELECT id FROM marketing_campaigns WHERE id = ?")
      .get(id);
    return Boolean(row);
  }

  async function createCampaign({
    id,
    name,
    type,
    status,
    templateId,
    sentAt,
    recipientCount,
    notes,
    now,
  }) {
    await db
      .prepare(
        `
        INSERT INTO marketing_campaigns (
          id, name, type, status, template_id, sent_at,
          recipient_count, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        name,
        type,
        status,
        templateId,
        sentAt,
        recipientCount,
        notes,
        now,
        now,
      );
    return getCampaignById(id);
  }

  async function updateCampaign(id, updates) {
    const filtered = {};
    for (const [key, value] of Object.entries(updates || {})) {
      if (CAMPAIGN_UPDATE_COLUMNS.has(key)) {
        filtered[key] = value;
      }
    }

    if (!Object.keys(filtered).length) {
      return { changes: 0 };
    }

    const setClauses = Object.keys(filtered)
      .map((key) => `${key} = ?`)
      .join(", ");
    const result = await db
      .prepare(`UPDATE marketing_campaigns SET ${setClauses} WHERE id = ?`)
      .run(...Object.values(filtered), id);
    return { changes: changesFrom(result) };
  }

  async function recordPushSend({
    pushCampaignId,
    campaignId,
    campaignName,
    targetLabel,
    title,
    body,
    dataJson,
    imageUrl,
    notificationId,
    sentAt,
    recipients,
  }) {
    if (typeof db.transaction !== "function") {
      throw new Error("Admin marketing push send requires transactions");
    }

    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      await txDb
        .prepare(
          `
          INSERT INTO push_campaigns (
            id, name, segment, title, body, data_json, image_url,
            onesignal_notification_id, sent_at, recipients_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          pushCampaignId,
          campaignName,
          targetLabel,
          title,
          body,
          dataJson,
          imageUrl,
          notificationId,
          sentAt,
          recipients,
          sentAt,
        );

      await txDb
        .prepare(
          `
          UPDATE marketing_campaigns
          SET status = 'sent', sent_at = ?, recipient_count = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(sentAt, recipients, sentAt, campaignId);

      return txDb
        .prepare("SELECT * FROM marketing_campaigns WHERE id = ?")
        .get(campaignId);
    });
  }

  async function importCampaignEngagements({
    campaignId,
    rows,
    now,
    dbOverride = db,
  }) {
    const mergeFn = dbOverride.isPostgres ? "GREATEST" : "MAX";
    let matched = 0;
    let skippedUnknown = 0;
    let bouncedCount = 0;
    let unsubscribedCount = 0;

    const upsertEngagement = dbOverride.prepare(`
      INSERT INTO marketing_engagements (
        id, contact_id, campaign_id, opened, clicked, replied,
        bounced, unsubscribed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contact_id, campaign_id) DO UPDATE SET
        opened = ${mergeFn}(marketing_engagements.opened, excluded.opened),
        clicked = ${mergeFn}(marketing_engagements.clicked, excluded.clicked),
        replied = ${mergeFn}(marketing_engagements.replied, excluded.replied),
        bounced = ${mergeFn}(marketing_engagements.bounced, excluded.bounced),
        unsubscribed = ${mergeFn}(marketing_engagements.unsubscribed, excluded.unsubscribed),
        updated_at = excluded.updated_at
    `);

    for (const row of rows) {
      if (!row.email) {
        skippedUnknown++;
        continue;
      }

      const contact = await dbOverride
        .prepare("SELECT id, status FROM marketing_contacts WHERE email = ?")
        .get(row.email);
      if (!contact) {
        skippedUnknown++;
        continue;
      }

      await upsertEngagement.run(
        row.id,
        contact.id,
        campaignId,
        row.opened,
        row.clicked,
        row.replied,
        row.bounced,
        row.unsubscribed,
        now,
        now,
      );

      if (row.bounced && contact.status === "active") {
        await dbOverride
          .prepare(
            "UPDATE marketing_contacts SET status = 'bounced', updated_at = ? WHERE id = ?",
          )
          .run(now, contact.id);
        bouncedCount++;
      }
      if (row.unsubscribed && contact.status !== "unsubscribed") {
        await dbOverride
          .prepare(
            "UPDATE marketing_contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?",
          )
          .run(now, contact.id);
        unsubscribedCount++;
      }

      matched++;
    }

    const stats = await dbOverride
      .prepare(
        `
        SELECT
          COUNT(*) AS recipient_count,
          SUM(opened) AS opens,
          SUM(clicked) AS clicks,
          SUM(replied) AS replies,
          SUM(bounced) AS bounces,
          SUM(unsubscribed) AS unsubscribes
        FROM marketing_engagements WHERE campaign_id = ?
      `,
      )
      .get(campaignId);

    await dbOverride
      .prepare(
        `
        UPDATE marketing_campaigns SET
          recipient_count = ?, opens = ?, clicks = ?, replies = ?,
          bounces = ?, unsubscribes = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        stats.recipient_count || 0,
        stats.opens || 0,
        stats.clicks || 0,
        stats.replies || 0,
        stats.bounces || 0,
        stats.unsubscribes || 0,
        now,
        campaignId,
      );

    return { matched, skippedUnknown, bouncedCount, unsubscribedCount };
  }

  async function importCampaignEngagementsTransaction({ campaignId, rows, now }) {
    if (typeof db.transaction !== "function") {
      throw new Error("Admin marketing engagement import requires transactions");
    }
    return db.transaction(async (query) => {
      const txDb = createPreparedDbFromQuery(query, db);
      return importCampaignEngagements({
        campaignId,
        rows,
        now,
        dbOverride: txDb,
      });
    });
  }

  async function listCampaignEngagements({
    campaignId,
    filters,
    limit,
    offset,
  }) {
    const where = buildEngagementFilters(filters);
    const baseParams = [campaignId, ...where.params];
    const countSql = `
      SELECT COUNT(*) AS total
      FROM marketing_engagements me
      JOIN marketing_contacts mc ON mc.id = me.contact_id
      WHERE me.campaign_id = ?${where.sql}
    `;
    const count = await db.prepare(countSql).get(...baseParams);

    const rows = await db
      .prepare(
        `
        SELECT mc.id, mc.first_name, mc.last_name, mc.email,
               mc.status AS contact_status,
               me.opened, me.clicked, me.replied, me.bounced, me.unsubscribed
        FROM marketing_engagements me
        JOIN marketing_contacts mc ON mc.id = me.contact_id
        WHERE me.campaign_id = ?${where.sql}
        ORDER BY mc.email ASC LIMIT ? OFFSET ?
      `,
      )
      .all(...baseParams, limit, offset);

    return {
      engagements: rows,
      total: Number(count?.total || 0),
    };
  }

  async function exportContacts({ campaignId, status, opened, clicked }) {
    const params = [];
    let sql;

    if (campaignId) {
      sql = `
        SELECT mc.first_name, mc.last_name, mc.email
        FROM marketing_contacts mc
        JOIN marketing_engagements me
          ON me.contact_id = mc.id AND me.campaign_id = ?
        WHERE 1=1
      `;
      params.push(campaignId);

      if (status) {
        sql += " AND mc.status = ?";
        params.push(status);
      }
      if (opened !== undefined) {
        sql += " AND me.opened = ?";
        params.push(opened);
      }
      if (clicked !== undefined) {
        sql += " AND me.clicked = ?";
        params.push(clicked);
      }
    } else {
      sql = "SELECT first_name, last_name, email FROM marketing_contacts";
      if (status) {
        sql += " WHERE status = ?";
        params.push(status);
      }
    }

    sql += " ORDER BY email ASC";
    return db.prepare(sql).all(...params);
  }

  return {
    campaignExists,
    createCampaign,
    exportContacts,
    getCampaignById,
    importCampaignEngagementsTransaction,
    importContactsTransaction,
    listCampaignEngagements,
    listCampaigns,
    listContacts,
    recordPushSend,
    updateCampaign,
  };
}

module.exports = {
  createAdminMarketingRepository,
};
