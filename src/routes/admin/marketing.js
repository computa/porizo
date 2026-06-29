"use strict";

const fs = require("fs");
const path = require("path");

function registerAdminMarketingRoutes(
  app,
  {
    adminMarketingRepository,
    auditService,
    db,
    newUuid,
    nowIso,
    oneSignalService,
    parsePagination,
    requireAdminRole,
    requireAdminSession,
    sendError,
  },
) {
  const MARKETING_CONTACT_STATUSES = ["active", "bounced", "unsubscribed"];

  function parseBooleanFilter(value, fieldName, reply) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "true") return 1;
    if (value === "false") return 0;
    sendError(
      reply,
      400,
      "INVALID_FILTER",
      `${fieldName} must be true or false`,
    );
    return null;
  }

  // --- Marketing ---

  // RFC 4180 CSV parser with quoted-field support
  function parseCsvRow(line) {
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cols.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cols.push(current.trim());
    return cols;
  }

  // Read and validate a CSV file upload, returning { lines, filename }
  async function readCsvUpload(
    request,
    reply,
    { maxSizeMB = 2, maxRows = 10000 } = {},
  ) {
    const data = await request.file();
    if (!data) {
      sendError(reply, 400, "NO_FILE", "No file uploaded");
      return null;
    }

    const mime = data.mimetype;
    if (
      mime !== "text/csv" &&
      mime !== "application/vnd.ms-excel" &&
      mime !== "application/octet-stream"
    ) {
      sendError(reply, 400, "INVALID_FILE_TYPE", "Only CSV files are accepted");
      return null;
    }

    const maxSize = maxSizeMB * 1024 * 1024;
    const chunks = [];
    let size = 0;
    for await (const chunk of data.file) {
      size += chunk.length;
      if (size > maxSize) {
        sendError(
          reply,
          400,
          "FILE_TOO_LARGE",
          `CSV must be under ${maxSizeMB}MB`,
        );
        return null;
      }
      chunks.push(chunk);
    }

    const csvText = Buffer.concat(chunks).toString("utf8");
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      sendError(reply, 400, "EMPTY_CSV", "CSV has no data rows");
      return null;
    }
    if (maxRows && lines.length > maxRows + 1) {
      sendError(
        reply,
        400,
        "TOO_MANY_ROWS",
        `CSV must have fewer than ${maxRows.toLocaleString()} rows`,
      );
      return null;
    }

    return { lines, filename: data.filename || "unknown.csv" };
  }

  // Normalize email from multiple possible header names
  function normalizeEmail(record) {
    return (
      (record.email || record.emailaddress || record.email_address || "")
        .trim()
        .toLowerCase() || null
    );
  }

  // OWASP formula injection prevention for CSV export cells
  function sanitizeCsvCell(val) {
    if (!val) return "";
    const s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }

  const TEMPLATE_ALLOWLIST = [
    {
      id: "email-1-introduction",
      file: "email-1-introduction.html",
      subject: "What if your favorite memory became a song?",
      label: "The Introduction",
      day: "Day 0",
    },
    {
      id: "email-2-social-proof",
      file: "email-2-social-proof.html",
      subject: "Re: The gift no one expects",
      label: "The Social Proof",
      day: "Day 3",
    },
    {
      id: "email-3-final-nudge",
      file: "email-3-final-nudge.html",
      subject: "Someone's birthday is coming up",
      label: "The Final Nudge",
      day: "Day 8",
    },
  ];

  const CAMPAIGN_TYPES = ["email", "push", "social", "partnership"];
  const CAMPAIGN_STATUSES = ["draft", "scheduled", "sent", "completed"];
  const MAX_PUSH_TITLE_LENGTH = 80;
  const MAX_PUSH_BODY_LENGTH = 180;

  function validateCampaignFields({ type, status, template_id }, reply) {
    if (type && !CAMPAIGN_TYPES.includes(type)) {
      sendError(
        reply,
        400,
        "INVALID_TYPE",
        `Type must be one of: ${CAMPAIGN_TYPES.join(", ")}`,
      );
      return false;
    }
    if (status && !CAMPAIGN_STATUSES.includes(status)) {
      sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${CAMPAIGN_STATUSES.join(", ")}`,
      );
      return false;
    }
    if (template_id && !TEMPLATE_ALLOWLIST.some((t) => t.id === template_id)) {
      sendError(reply, 400, "INVALID_TEMPLATE", "Invalid template ID");
      return false;
    }
    return true;
  }

  function normalizePushText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeOneSignalSegments({ segment, segments }) {
    const rawSegments = Array.isArray(segments) ? segments : [segment || "All"];
    return rawSegments
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 10);
  }

  function normalizeUserIds(userIds) {
    if (!Array.isArray(userIds)) return [];
    return userIds
      .map((item) => normalizePushText(item))
      .filter(Boolean)
      .slice(0, 1000);
  }

  function oneSignalRecipientCount(response) {
    const candidates = [response?.recipients, response?.successful];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return 0;
  }

  const COLD_EMAIL_TEMPLATES = [
    {
      id: "cold-intro",
      file: "cold-intro.html",
      subject: "A song from one memory",
      label: "Cold Intro",
      day: "Day 0 (active)",
    },
    {
      id: "completed-before",
      file: "completed-before.html",
      subject: "Your song's still here",
      label: "Completed Before",
      day: "Re-engagement",
    },
    {
      id: "no-song",
      file: "no-song.html",
      subject: "Almost gave you a song",
      label: "No Song",
      day: "Re-engagement",
    },
  ];
  const coldEmailSvc = require("../../services/cold-email-service");

  app.get(
    "/admin/dashboard/marketing/email-templates",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const nurtureDir = path.join(process.cwd(), "marketing", "emails");
      const coldDir = path.join(process.cwd(), "marketing", "email");

      const readGroup = async (dir, list) =>
        Promise.all(
          list.map(async (tpl) => {
            try {
              const html = await fs.promises.readFile(
                path.join(dir, tpl.file),
                "utf8",
              );
              return { ...tpl, html };
            } catch {
              return { ...tpl, html: null, error: "File not found" };
            }
          }),
        );

      // Any template_html_path referenced by an actual campaign that
      // ISN'T in the static COLD_EMAIL_TEMPLATES list is surfaced with
      // {custom: true} so operators see what's actually being sent —
      // not just what the static list documents.
      const knownColdPaths = new Set(
        COLD_EMAIL_TEMPLATES.map((tpl) => `marketing/email/${tpl.file}`),
      );
      const referenced = await coldEmailSvc.listTemplateReferences(db);
      const customSpecs = [];
      for (const row of referenced ?? []) {
        if (!row?.html_path) continue;
        if (knownColdPaths.has(row.html_path)) continue;
        const file = row.html_path.replace(/^marketing\/email\//, "");
        customSpecs.push({
          id: `custom:${file}`,
          file,
          subject: "(custom template)",
          label: `Custom · ${file}`,
          day: "Custom",
          custom: true,
        });
      }

      const [templates, standardCold, customCold] = await Promise.all([
        readGroup(nurtureDir, TEMPLATE_ALLOWLIST),
        readGroup(coldDir, COLD_EMAIL_TEMPLATES),
        readGroup(coldDir, customSpecs),
      ]);
      reply.send({
        templates,
        cold_email_templates: [...standardCold, ...customCold],
      });
    },
  );

  app.get("/admin/dashboard/marketing/contacts", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { limit, offset } = parsePagination(request.query);
    const { search, category, status } = request.query;
    if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
      return sendError(
        reply,
        400,
        "INVALID_STATUS",
        `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
      );
    }

    const { contacts, total } = await adminMarketingRepository.listContacts({
      search,
      category,
      status,
      limit,
      offset,
    });

    reply.send({ contacts, total, limit, offset });
  });

  app.post(
    "/admin/dashboard/marketing/contacts/upload",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 2,
        maxRows: 10000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const KNOWN_HEADERS = new Set([
        "first_name",
        "last_name",
        "company_name",
        "name",
        "website",
        "description",
        "contact_name",
        "email",
        "emailaddress",
        "email_address",
        "category",
        "channel_type",
        "score",
        "icp_fit_score",
        "icp_fit_reasoning",
        "audience_reach",
        "partnership_opportunity",
        "contact_approach",
      ]);

      const headers = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      const now = nowIso();
      const importRows = rows.map((row) => {
        const cols = parseCsvRow(row);
        // Build record from known headers only (prevents prototype pollution)
        const record = Object.create(null);
        headers.forEach((h, i) => {
          if (KNOWN_HEADERS.has(h)) record[h] = cols[i] || null;
        });

        const email = normalizeEmail(record);
        const firstName = record.first_name || null;
        const lastName = record.last_name || null;
        const companyName = record.company_name || record.name || null;
        let website = record.website || null;
        // Derive contact_name from first+last if not explicitly provided
        const contactName =
          record.contact_name ||
          (firstName && lastName
            ? `${firstName} ${lastName}`
            : firstName || lastName || null);

        // Sanitize URL — only allow http(s) schemes
        if (website && !/^https?:\/\//i.test(website)) {
          website = null;
        }

        return {
          id: newUuid(),
          firstName,
          lastName,
          companyName,
          website,
          description: record.description || null,
          contactName,
          email,
          category: record.category || record.channel_type || null,
          score: parseInt(record.score || record.icp_fit_score) || 0,
          icpFitReasoning: record.icp_fit_reasoning || null,
          audienceReach: record.audience_reach || null,
          partnershipOpportunity: record.partnership_opportunity || null,
          contactApproach: record.contact_approach || null,
          sourceFile: filename,
        };
      });

      const { inserted, skipped } =
        await adminMarketingRepository.importContactsTransaction({
          rows: importRows,
          now,
        });

      await auditService.audit(
        admin.adminId,
        "marketing_contacts_upload",
        "marketing_contacts",
        null,
        {
          filename,
          inserted,
          skipped,
          total_rows: rows.length,
        },
      );

      reply.send({ success: true, inserted, skipped, total: rows.length });
    },
  );

  app.get("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const campaigns = await adminMarketingRepository.listCampaigns();
    reply.send({ campaigns });
  });

  // ===== Cold-email campaigns =====
  // Replaces the old launchd/Python job. Read-only observability + manual
  // trigger. Trigger requires superadmin because each call schedules real
  // outbound emails to a cold list — irreversible side effect.
  const COLD_EMAIL_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  app.get("/admin/dashboard/marketing/cold-email", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;
    const active = await coldEmailSvc.listActiveCampaigns(db);
    const all = await coldEmailSvc.listAllCampaigns(db);
    const byId = new Map(active.map((c) => [c.id, c.pending_count]));
    const campaigns = all.map((c) => ({
      ...c,
      pending_count: byId.get(c.id) ?? 0,
    }));
    reply.send({ campaigns });
  });

  app.post(
    "/admin/dashboard/marketing/cold-email/:id/trigger",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const id = request.params.id;
      if (!COLD_EMAIL_ID_PATTERN.test(id)) {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_ID",
          "Campaign id must match [a-zA-Z0-9_-]{1,64}",
        );
      }
      const campaign = await coldEmailSvc.loadCampaign(db, id);
      if (!campaign) {
        return sendError(
          reply,
          404,
          "CAMPAIGN_NOT_FOUND",
          `No cold_email_campaigns row '${id}'`,
        );
      }
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return sendError(
          reply,
          503,
          "RESEND_KEY_MISSING",
          "RESEND_API_KEY not set",
        );
      }
      try {
        const result = await coldEmailSvc.processCampaign(db, campaign, {
          apiKey,
          now: new Date(),
          log: (msg) => app.log.info(msg),
        });
        try {
          await auditService.audit(
            admin.adminId,
            "cold_email_manual_trigger",
            "cold_email_campaigns",
            id,
            {
              fired: result.fired,
              queued: result.queued ?? 0,
              attempted: result.attempted ?? 0,
              reason: result.reason ?? null,
              from_address: campaign.from_address,
              subject: campaign.subject,
            },
          );
        } catch (auditErr) {
          app.log.error(auditErr, "cold-email trigger audit log failed");
        }
        if (!result.fired) {
          return reply.code(409).send({
            fired: false,
            reason: result.reason,
          });
        }
        reply.send({
          fired: true,
          queued: result.queued,
          attempted: result.attempted,
        });
      } catch (err) {
        app.log.error(err, "cold-email manual trigger failed");
        sendError(
          reply,
          502,
          "RESEND_FAILED",
          "Resend batch submission failed",
        );
      }
    },
  );

  app.patch(
    "/admin/dashboard/marketing/cold-email/:id",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, ["superadmin"]);
      if (!admin) return;
      const id = request.params.id;
      if (!COLD_EMAIL_ID_PATTERN.test(id)) {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_ID",
          "Campaign id must match [a-zA-Z0-9_-]{1,64}",
        );
      }
      const existing = await coldEmailSvc.loadCampaign(db, id);
      if (!existing) {
        return sendError(
          reply,
          404,
          "CAMPAIGN_NOT_FOUND",
          `No cold_email_campaigns row '${id}'`,
        );
      }

      // NOTE: Keep these whitelists in sync with admin/src/pages/marketing/
      // ColdEmailTab.tsx EDITABLE_FIELDS — frontend renders one form input
      // per allowed field, server is the authoritative validator.
      const body = request.body || {};
      const allowedString = {
        subject: { maxLen: 200, kind: "text" },
        campaign_tag: { maxLen: 80, kind: "text" },
        from_address: { maxLen: 200, kind: "email" },
        reply_to: { maxLen: 200, kind: "email" },
      };
      const allowedInt = {
        per_day: [1, 100],
        schedule_pace_seconds: [30, 3600],
        schedule_offset_minutes: [0, 600],
        fire_after_utc_hour: [0, 23],
        fire_until_utc_hour: [1, 24],
        min_minutes_between_runs: [1, 1440],
        active: [0, 1],
      };

      // RFC 5322 single-mailbox shape, optional display name. Rejects CR/LF
      // so a wrong-value PATCH can't smuggle headers into the Resend payload.
      const EMAIL_LIKE_RE =
        /^([^<>\r\n]{0,80}<)?[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+>?$/;

      const changes = {};
      const changedFields = [];

      for (const [field, spec] of Object.entries(allowedString)) {
        if (!(field in body)) continue;
        const raw = body[field];
        if (typeof raw !== "string" || raw.length > spec.maxLen) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be a string up to ${spec.maxLen} chars`,
          );
        }
        const value = raw.trim();
        if (value.length === 0) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must not be blank`,
          );
        }
        if (/[\r\n\0]/.test(value)) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must not contain control characters`,
          );
        }
        if (spec.kind === "email" && !EMAIL_LIKE_RE.test(value)) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must look like 'name@example.com' or 'Name <name@example.com>'`,
          );
        }
        changes[field] = value;
        changedFields.push(field);
      }

      for (const [field, [min, max]] of Object.entries(allowedInt)) {
        if (!(field in body)) continue;
        const value = body[field];
        if (!Number.isInteger(value) || value < min || value > max) {
          return sendError(
            reply,
            400,
            "INVALID_FIELD",
            `${field} must be an integer in [${min}, ${max}]`,
          );
        }
        changes[field] = value;
        changedFields.push(field);
      }

      if ("earliest_run_date_utc" in body) {
        const value = body.earliest_run_date_utc;
        if (value !== null) {
          if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return sendError(
              reply,
              400,
              "INVALID_FIELD",
              "earliest_run_date_utc must be YYYY-MM-DD or null",
            );
          }
          // Roundtrip check rejects 2026-13-99, 2026-02-31, etc.
          const dt = new Date(`${value}T00:00:00Z`);
          if (
            Number.isNaN(dt.getTime()) ||
            dt.toISOString().slice(0, 10) !== value
          ) {
            return sendError(
              reply,
              400,
              "INVALID_FIELD",
              "earliest_run_date_utc must be a real calendar date",
            );
          }
        }
        changes.earliest_run_date_utc = value;
        changedFields.push("earliest_run_date_utc");
      }

      if (changedFields.length === 0) {
        return sendError(
          reply,
          400,
          "NO_UPDATES",
          "No editable fields supplied",
        );
      }

      // Cross-field: fire_until_utc_hour must be strictly greater than
      // fire_after_utc_hour, else the daily window is empty and the campaign
      // silently never fires. Resolve effective values against the
      // patched-or-existing campaign (the patch is partial).
      const effectiveAfter =
        "fire_after_utc_hour" in body
          ? body.fire_after_utc_hour
          : existing.fire_after_utc_hour;
      const effectiveUntil =
        "fire_until_utc_hour" in body
          ? body.fire_until_utc_hour
          : existing.fire_until_utc_hour;
      if (
        Number.isInteger(effectiveAfter) &&
        Number.isInteger(effectiveUntil) &&
        effectiveUntil <= effectiveAfter
      ) {
        return sendError(
          reply,
          400,
          "INVALID_WINDOW",
          `fire_until_utc_hour (${effectiveUntil}) must be greater than fire_after_utc_hour (${effectiveAfter}) — otherwise the daily window is empty.`,
        );
      }

      // Optimistic concurrency: require If-Match against current updated_at.
      // Bypassed if the client doesn't send it (legacy curl callers), but
      // strongly recommended for the admin UI to surface stale-form-state
      // conflicts to the operator.
      const ifMatch =
        request.headers["if-match"] ??
        request.headers["If-Match"] ??
        body.if_match ??
        body.updated_at;
      if (ifMatch && ifMatch !== existing.updated_at) {
        return reply.code(409).send({
          error: "STALE_UPDATE",
          message:
            "Campaign was modified by another writer. Refresh to see the latest state and retry.",
          current_updated_at: existing.updated_at,
        });
      }

      const nowIso = new Date().toISOString();
      const updatedCampaign = await coldEmailSvc.updateCampaignFields(
        db,
        id,
        changes,
        existing.updated_at ?? "",
        nowIso,
      );
      if (!updatedCampaign) {
        // Lost the race after the If-Match check (another PATCH landed
        // between our load and our UPDATE). Surface the conflict.
        return reply.code(409).send({
          error: "STALE_UPDATE",
          message:
            "Campaign was modified by another writer between read and write. Refresh and retry.",
        });
      }

      const updated = await coldEmailSvc.loadCampaign(db, id);

      try {
        const before = {};
        const after = {};
        for (const f of changedFields) {
          before[f] = existing[f];
          after[f] = updated[f];
        }
        await auditService.audit(
          admin.adminId,
          "cold_email_campaign_update",
          "cold_email_campaigns",
          id,
          { before, after },
        );
      } catch (auditErr) {
        app.log.error(auditErr, "cold-email PATCH audit log failed");
      }

      reply.send({ campaign: updated });
    },
  );

  app.post("/admin/dashboard/marketing/campaigns", async (request, reply) => {
    const admin = await requireAdminSession(request, reply);
    if (!admin) return;

    const { name, type, status, template_id, sent_at, recipient_count, notes } =
      request.body || {};
    if (!name || !name.trim()) {
      return sendError(reply, 400, "MISSING_NAME", "Campaign name is required");
    }
    if (name.trim().length > 200) {
      return sendError(
        reply,
        400,
        "NAME_TOO_LONG",
        "Campaign name must not exceed 200 characters",
      );
    }
    if (notes && notes.length > 2000) {
      return sendError(
        reply,
        400,
        "NOTES_TOO_LONG",
        "Notes must not exceed 2,000 characters",
      );
    }
    if (!validateCampaignFields({ type, status, template_id }, reply)) return;
    if (
      recipient_count != null &&
      (recipient_count < 0 || recipient_count > 1000000)
    ) {
      return sendError(
        reply,
        400,
        "INVALID_COUNT",
        "Recipient count must be 0-1,000,000",
      );
    }
    if (sent_at && isNaN(new Date(sent_at).getTime())) {
      return sendError(
        reply,
        400,
        "INVALID_DATE",
        "sent_at must be a valid ISO date",
      );
    }

    const id = newUuid();
    const now = nowIso();
    const campaign = await adminMarketingRepository.createCampaign({
      id,
      name: name.trim(),
      type: type || "email",
      status: status || "draft",
      templateId: template_id || null,
      sentAt: sent_at || null,
      recipientCount: recipient_count || 0,
      notes: notes || null,
      now,
    });

    await auditService.audit(
      admin.adminId,
      "marketing_campaign_create",
      "marketing_campaigns",
      id,
      { name: name.trim() },
    );

    reply.send({ campaign });
  });

  app.put(
    "/admin/dashboard/marketing/campaigns/:id",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const existing = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!existing) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const {
        name,
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      } = request.body || {};

      if (name !== undefined && name.trim().length > 200) {
        return sendError(
          reply,
          400,
          "NAME_TOO_LONG",
          "Campaign name must not exceed 200 characters",
        );
      }
      if (notes !== undefined && notes && notes.length > 2000) {
        return sendError(
          reply,
          400,
          "NOTES_TOO_LONG",
          "Notes must not exceed 2,000 characters",
        );
      }
      if (!validateCampaignFields({ type, status, template_id }, reply)) return;
      if (sent_at && isNaN(new Date(sent_at).getTime())) {
        return sendError(
          reply,
          400,
          "INVALID_DATE",
          "sent_at must be a valid ISO date",
        );
      }

      // Validate numeric stats
      const stats = {
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
      };
      for (const [key, val] of Object.entries(stats)) {
        if (
          val != null &&
          (val < 0 || val > 1000000 || !Number.isInteger(val))
        ) {
          return sendError(
            reply,
            400,
            "INVALID_STAT",
            `${key} must be a non-negative integer up to 1,000,000`,
          );
        }
      }

      // Build update set from provided fields (allowlisted columns only)
      const ALLOWED_COLUMNS = [
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
      ];
      const candidates = {
        name: name?.trim(),
        type,
        status,
        template_id,
        sent_at,
        recipient_count,
        opens,
        clicks,
        replies: repliesCount,
        bounces,
        unsubscribes,
        notes,
      };
      const updates = {};
      for (const [k, v] of Object.entries(candidates)) {
        if (v !== undefined) {
          if (!ALLOWED_COLUMNS.includes(k)) continue;
          updates[k] = v;
        }
      }

      if (Object.keys(updates).length === 0) {
        return sendError(reply, 400, "NO_CHANGES", "No fields to update");
      }

      updates.updated_at = nowIso();
      await adminMarketingRepository.updateCampaign(request.params.id, updates);

      await auditService.audit(
        admin.adminId,
        "marketing_campaign_update",
        "marketing_campaigns",
        request.params.id,
        {
          fields_changed: Object.keys(updates).filter(
            (k) => k !== "updated_at",
          ),
        },
      );

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      reply.send({ campaign });
    },
  );

  app.post(
    "/admin/dashboard/marketing/campaigns/:id/send-push",
    async (request, reply) => {
      const admin = await requireAdminRole(request, reply, [
        "admin",
        "superadmin",
      ]);
      if (!admin) return;

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (campaign.type !== "push") {
        return sendError(
          reply,
          400,
          "INVALID_CAMPAIGN_TYPE",
          "Only push campaigns can be sent through OneSignal",
        );
      }
      if (!oneSignalService.isConfigured()) {
        return sendError(
          reply,
          503,
          "ONESIGNAL_NOT_CONFIGURED",
          "OneSignal credentials are not configured",
        );
      }

      const title = normalizePushText(request.body?.title);
      const body = normalizePushText(request.body?.body);
      const imageUrl =
        normalizePushText(request.body?.image_url || request.body?.imageUrl) ||
        null;
      const dryRun =
        request.body?.dry_run === true || request.body?.dryRun === true;
      const segments = normalizeOneSignalSegments(request.body || {});
      const userIds = normalizeUserIds(
        request.body?.user_ids || request.body?.userIds,
      );

      if (!title) {
        return sendError(reply, 400, "MISSING_TITLE", "Push title is required");
      }
      if (!body) {
        return sendError(reply, 400, "MISSING_BODY", "Push body is required");
      }
      if (title.length > MAX_PUSH_TITLE_LENGTH) {
        return sendError(
          reply,
          400,
          "TITLE_TOO_LONG",
          `Push title must not exceed ${MAX_PUSH_TITLE_LENGTH} characters`,
        );
      }
      if (body.length > MAX_PUSH_BODY_LENGTH) {
        return sendError(
          reply,
          400,
          "BODY_TOO_LONG",
          `Push body must not exceed ${MAX_PUSH_BODY_LENGTH} characters`,
        );
      }
      if (userIds.length === 0 && segments.length === 0) {
        return sendError(
          reply,
          400,
          "MISSING_TARGET",
          "At least one segment or user ID is required",
        );
      }
      if (
        request.body?.data &&
        (typeof request.body.data !== "object" ||
          Array.isArray(request.body.data))
      ) {
        return sendError(
          reply,
          400,
          "INVALID_DATA",
          "Push data must be an object",
        );
      }

      const pushData = {
        ...(request.body?.data || {}),
        campaign_id: campaign.id,
        campaign_name: campaign.name,
      };
      const target =
        userIds.length > 0
          ? { type: "users", user_ids: userIds }
          : { type: "segments", segments };

      if (dryRun) {
        return reply.send({
          success: true,
          dry_run: true,
          configured: true,
          target,
          title,
          body,
        });
      }

      if (request.body?.confirm !== "SEND_PUSH") {
        return sendError(
          reply,
          400,
          "CONFIRMATION_REQUIRED",
          "Set confirm to SEND_PUSH before sending a live push",
        );
      }

      let response;
      try {
        response =
          userIds.length > 0
            ? await oneSignalService.sendToUsers({
                userIds,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              })
            : await oneSignalService.sendToSegment({
                segments,
                title,
                body,
                data: pushData,
                imageUrl,
                name: campaign.name,
              });
      } catch (err) {
        request.log?.error(
          { err, campaignId: campaign.id },
          "OneSignal push send failed",
        );
        return sendError(
          reply,
          err.status || 502,
          "ONESIGNAL_SEND_FAILED",
          "OneSignal rejected the push send request",
        );
      }

      const sentAt = nowIso();
      const recipients = oneSignalRecipientCount(response);
      const targetLabel =
        userIds.length > 0 ? `users:${userIds.length}` : segments.join(",");

      const updated = await adminMarketingRepository.recordPushSend({
        pushCampaignId: newUuid(),
        campaignId: campaign.id,
        campaignName: campaign.name,
        targetLabel,
        title,
        body,
        dataJson: JSON.stringify(pushData),
        imageUrl,
        notificationId: response.id || null,
        sentAt,
        recipients,
      });

      await auditService.audit(
        admin.adminId,
        "marketing_push_send",
        "marketing_campaigns",
        campaign.id,
        {
          onesignal_notification_id: response.id || null,
          recipients,
          target,
        },
      );

      reply.send({
        success: true,
        campaign: updated,
        onesignal: {
          id: response.id || null,
          recipients,
        },
      });
    },
  );

  // --- Import GMass Results ---
  app.post(
    "/admin/dashboard/marketing/campaigns/:id/import-results",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const campaign = await adminMarketingRepository.getCampaignById(
        request.params.id,
      );
      if (!campaign) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }
      if (!["sent", "completed"].includes(campaign.status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          "Can only import results for sent or completed campaigns",
        );
      }

      const csv = await readCsvUpload(request, reply, {
        maxSizeMB: 5,
        maxRows: 50000,
      });
      if (!csv) return;

      const { lines, filename } = csv;

      const GMASS_HEADERS = new Set([
        "emailaddress",
        "email",
        "email_address",
        "opened",
        "clicked",
        "replied",
        "bounced",
        "unsubscribed",
      ]);

      const rawHeaders = parseCsvRow(lines[0]).map((h) =>
        h.trim().toLowerCase().replace(/\s+/g, "_"),
      );
      const rows = lines.slice(1);

      // Validate that CSV has an email column
      const hasEmailColumn = rawHeaders.some(
        (h) => h === "emailaddress" || h === "email" || h === "email_address",
      );
      if (!hasEmailColumn) {
        return sendError(
          reply,
          400,
          "MISSING_EMAIL",
          "CSV must have an EmailAddress or Email column",
        );
      }

      function isEngaged(val) {
        const v = val?.trim().toLowerCase();
        return v === "x" || v === "1" || v === "true";
      }

      const now = nowIso();
      const campaignId = request.params.id;
      const importRows = rows.map((row) => {
        const cols = parseCsvRow(row);
        const record = Object.create(null);
        rawHeaders.forEach((h, i) => {
          if (GMASS_HEADERS.has(h)) record[h] = cols[i] || null;
        });

        return {
          id: newUuid(),
          email: normalizeEmail(record),
          opened: isEngaged(record.opened) ? 1 : 0,
          clicked: isEngaged(record.clicked) ? 1 : 0,
          replied: isEngaged(record.replied) ? 1 : 0,
          bounced: isEngaged(record.bounced) ? 1 : 0,
          unsubscribed: isEngaged(record.unsubscribed) ? 1 : 0,
        };
      });

      const {
        matched,
        skippedUnknown,
        bouncedCount,
        unsubscribedCount,
      } = await adminMarketingRepository.importCampaignEngagementsTransaction({
        campaignId,
        rows: importRows,
        now,
      });

      await auditService.audit(
        admin.adminId,
        "marketing_results_import",
        "marketing_campaigns",
        campaignId,
        {
          filename,
          matched,
          skipped: skippedUnknown,
          bounced: bouncedCount,
          unsubscribed: unsubscribedCount,
          total_rows: rows.length,
        },
      );

      reply.send({
        success: true,
        matched,
        skipped: skippedUnknown,
        bounced: bouncedCount,
        unsubscribed: unsubscribedCount,
        total: rows.length,
      });
    },
  );

  // --- Campaign Engagements ---
  app.get(
    "/admin/dashboard/marketing/campaigns/:id/engagements",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      if (!(await adminMarketingRepository.campaignExists(request.params.id))) {
        return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
      }

      const { limit, offset } = parsePagination(request.query);
      const { opened, clicked, replied, bounced } = request.query;
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;
      const repliedFilter = parseBooleanFilter(replied, "replied", reply);
      if (repliedFilter === null) return;
      const bouncedFilter = parseBooleanFilter(bounced, "bounced", reply);
      if (bouncedFilter === null) return;

      const { engagements, total } =
        await adminMarketingRepository.listCampaignEngagements({
          campaignId: request.params.id,
          filters: {
            opened: openedFilter,
            clicked: clickedFilter,
            replied: repliedFilter,
            bounced: bouncedFilter,
          },
          limit,
          offset,
        });
      reply.send({ engagements, total, limit, offset });
    },
  );

  // --- Export Contacts CSV ---
  app.get(
    "/admin/dashboard/marketing/contacts/export",
    async (request, reply) => {
      const admin = await requireAdminSession(request, reply);
      if (!admin) return;

      const { status, campaign_id, opened, clicked } = request.query;
      if (status && !MARKETING_CONTACT_STATUSES.includes(status)) {
        return sendError(
          reply,
          400,
          "INVALID_STATUS",
          `Status must be one of: ${MARKETING_CONTACT_STATUSES.join(", ")}`,
        );
      }
      const openedFilter = parseBooleanFilter(opened, "opened", reply);
      if (openedFilter === null) return;
      const clickedFilter = parseBooleanFilter(clicked, "clicked", reply);
      if (clickedFilter === null) return;

      let contacts;

      if (campaign_id) {
        if (!(await adminMarketingRepository.campaignExists(campaign_id))) {
          return sendError(reply, 404, "NOT_FOUND", "Campaign not found");
        }
      }

      contacts = await adminMarketingRepository.exportContacts({
        campaignId: campaign_id,
        status,
        opened: openedFilter,
        clicked: clickedFilter,
      });

      // Build CSV
      const csvLines = ["First Name,Last Name,Email"];
      for (const c of contacts) {
        csvLines.push(
          `${sanitizeCsvCell(c.first_name)},${sanitizeCsvCell(c.last_name)},${sanitizeCsvCell(c.email)}`,
        );
      }

      await auditService.audit(
        admin.adminId,
        "marketing_contacts_export",
        "marketing_contacts",
        null,
        {
          filters: { status, campaign_id, opened, clicked },
          row_count: contacts.length,
        },
      );

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
        .header("Cache-Control", "no-store")
        .send(csvLines.join("\n"));
    },
  );


}

module.exports = { registerAdminMarketingRoutes };
