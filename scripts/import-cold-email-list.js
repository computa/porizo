#!/usr/bin/env node
/**
 * Import marketing/email/.state/cold-list.tsv into cold_email_campaigns +
 * cold_email_recipients. Reads from the local TSV (gitignored, has real
 * emails) and connects to the configured Porizo DB (SQLite in dev,
 * Postgres on Railway).
 *
 * Run locally with the Railway DB URL injected:
 *
 *   railway run -- node scripts/import-cold-email-list.js \
 *     --campaign mothers-day-2026 \
 *     --already-sent 340 \
 *     --subject "A song from one memory" \
 *     --campaign-tag cold-intro-day2plus \
 *     --per-day 80 \
 *     --pace-seconds 270 \
 *     --offset-minutes 60 \
 *     --earliest 2026-05-11
 *
 * Idempotent: re-running with the same campaign id is a no-op for already-
 * imported (campaign_id, index_pos) pairs unless --truncate is passed.
 * --truncate requires COLD_EMAIL_ALLOW_PROD_TRUNCATE=yes when DATABASE_URL
 * looks like Railway/production.
 */

require("dotenv/config");
const fs = require("node:fs");
const path = require("node:path");
const { getDatabase } = require("../src/database");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TSV = path.join(
  REPO_ROOT,
  "marketing/email/.state/cold-list.tsv",
);

function parseArgs(argv) {
  const args = {
    campaign: null,
    tsv: DEFAULT_TSV,
    subject: "A song from one memory",
    campaignTag: "cold-intro",
    perDay: 80,
    paceSeconds: 270,
    offsetMinutes: 60,
    fireAfterUtcHour: 9,
    earliest: null,
    templateHtml: "marketing/email/cold-intro.html",
    templateText: "marketing/email/cold-intro.txt",
    fromAddress: "Ambrose from Porizo <support@porizo.co>",
    replyTo: "support@porizo.co",
    alreadySent: 0,
    truncate: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === "--campaign") args.campaign = v();
    else if (a === "--tsv") args.tsv = path.resolve(v());
    else if (a === "--subject") args.subject = v();
    else if (a === "--campaign-tag") args.campaignTag = v();
    else if (a === "--per-day") args.perDay = parseInt(v(), 10);
    else if (a === "--pace-seconds") args.paceSeconds = parseInt(v(), 10);
    else if (a === "--offset-minutes") args.offsetMinutes = parseInt(v(), 10);
    else if (a === "--fire-after-utc-hour")
      args.fireAfterUtcHour = parseInt(v(), 10);
    else if (a === "--earliest") args.earliest = v();
    else if (a === "--template-html") args.templateHtml = v();
    else if (a === "--template-text") args.templateText = v();
    else if (a === "--from") args.fromAddress = v();
    else if (a === "--reply-to") args.replyTo = v();
    else if (a === "--already-sent") args.alreadySent = parseInt(v(), 10);
    else if (a === "--truncate") args.truncate = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/import-cold-email-list.js --campaign <id> [options]

Required:
  --campaign <id>             cold_email_campaigns.id

Common options:
  --tsv <path>                Recipients TSV (default: marketing/email/.state/cold-list.tsv)
  --subject "..."             Email subject
  --campaign-tag "..."        Resend tag value for the cohort
  --per-day N                 Batch size per day (default 80, max 100 — Resend batch limit)
  --pace-seconds N            Delay between deliveries (default 270)
  --offset-minutes N          Delay before first delivery (default 60, max 600)
  --fire-after-utc-hour N     Earliest UTC hour to fire each day (default 9)
  --earliest YYYY-MM-DD       Skip runs before this UTC date
  --already-sent N            Mark first N recipients as already sent (porting state)
  --truncate                  Wipe existing recipients for this campaign first.
                              Requires COLD_EMAIL_ALLOW_PROD_TRUNCATE=yes against
                              Railway/production DATABASE_URL.
  --dry-run                   Plan only, no writes
`);
}

function looksLikeProductionDatabaseUrl(url) {
  if (!url) return false;
  return /railway|rlwy\.net/.test(url) || process.env.NODE_ENV === "production";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  if (!args.campaign) {
    console.error("ERROR: --campaign is required.");
    help();
    process.exit(1);
  }
  if (args.perDay > 100) {
    console.error(
      `ERROR: --per-day=${args.perDay} exceeds Resend batch limit (100). Lower it or split into multiple campaigns.`,
    );
    process.exit(1);
  }
  if (args.offsetMinutes > 600) {
    console.error(
      `ERROR: --offset-minutes=${args.offsetMinutes} would push deliveries past UTC day boundary. Max 600 (10h).`,
    );
    process.exit(1);
  }

  const tsv = args.tsv;
  if (!fs.existsSync(tsv)) {
    console.error(`ERROR: TSV not found at ${tsv}`);
    process.exit(1);
  }
  const lines = fs
    .readFileSync(tsv, "utf8")
    .split("\n")
    .filter((l) => l.includes("\t"));
  const rows = lines.map((line, idx) => {
    const [email, firstName = ""] = line.split("\t");
    return {
      index_pos: idx,
      email: (email ?? "").trim(),
      first_name: firstName.trim(),
    };
  });
  console.log(
    `📂 Read ${rows.length} rows from ${path.relative(REPO_ROOT, tsv)}`,
  );

  // Refuse --truncate against production unless explicitly allowed.
  if (args.truncate && !args.dryRun) {
    const url = process.env.DATABASE_URL || "";
    if (
      looksLikeProductionDatabaseUrl(url) &&
      process.env.COLD_EMAIL_ALLOW_PROD_TRUNCATE !== "yes"
    ) {
      console.error(
        "ERROR: --truncate against production DATABASE_URL refused. Set COLD_EMAIL_ALLOW_PROD_TRUNCATE=yes to override.",
      );
      process.exit(1);
    }
  }

  const db = await getDatabase({
    migrationsDir: path.join(REPO_ROOT, "migrations"),
  });

  if (args.dryRun) {
    console.log("🧪 --dry-run: would write the following:");
    console.log(
      `   campaign ${args.campaign} (per_day=${args.perDay}, pace=${args.paceSeconds}s, offset=${args.offsetMinutes}m, earliest=${args.earliest ?? "—"})`,
    );
    console.log(
      `   ${rows.length} recipient rows; first ${args.alreadySent} marked sent_at=imported`,
    );
    console.log(
      `   first: ${rows[0]?.email}, last: ${rows[rows.length - 1]?.email}`,
    );
    if (db?.close) await db.close();
    return;
  }

  // Upsert campaign.
  const existing = await db
    .prepare("SELECT id FROM cold_email_campaigns WHERE id = ?")
    .get(args.campaign);
  if (existing) {
    await db
      .prepare(
        `UPDATE cold_email_campaigns SET
          campaign_tag = ?, subject = ?, template_html_path = ?, template_text_path = ?,
          from_address = ?, reply_to = ?, per_day = ?, schedule_pace_seconds = ?,
          schedule_offset_minutes = ?, earliest_run_date_utc = ?, fire_after_utc_hour = ?,
          active = 1
         WHERE id = ?`,
      )
      .run(
        args.campaignTag,
        args.subject,
        args.templateHtml,
        args.templateText,
        args.fromAddress,
        args.replyTo,
        args.perDay,
        args.paceSeconds,
        args.offsetMinutes,
        args.earliest,
        args.fireAfterUtcHour,
        args.campaign,
      );
    console.log(`🔁 Updated campaign ${args.campaign}`);
  } else {
    await db
      .prepare(
        `INSERT INTO cold_email_campaigns
          (id, campaign_tag, subject, template_html_path, template_text_path,
           from_address, reply_to, per_day, schedule_pace_seconds,
           schedule_offset_minutes, earliest_run_date_utc, fire_after_utc_hour, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        args.campaign,
        args.campaignTag,
        args.subject,
        args.templateHtml,
        args.templateText,
        args.fromAddress,
        args.replyTo,
        args.perDay,
        args.paceSeconds,
        args.offsetMinutes,
        args.earliest,
        args.fireAfterUtcHour,
      );
    console.log(`➕ Inserted campaign ${args.campaign}`);
  }

  if (args.truncate) {
    const r = await db
      .prepare("DELETE FROM cold_email_recipients WHERE campaign_id = ?")
      .run(args.campaign);
    console.log(`🧹 Truncated ${r?.changes ?? "?"} prior recipients`);
  }

  // Portable upsert: works on both SQLite and Postgres.
  const insert = db.prepare(
    `INSERT INTO cold_email_recipients (campaign_id, index_pos, email, first_name, sent_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (campaign_id, index_pos) DO NOTHING`,
  );
  let inserted = 0;
  const importedAt = new Date().toISOString();
  for (const row of rows) {
    const sentAt = row.index_pos < args.alreadySent ? importedAt : null;
    const r = await insert.run(
      args.campaign,
      row.index_pos,
      row.email,
      row.first_name,
      sentAt,
    );
    if ((r?.changes ?? 0) > 0) inserted++;
  }
  console.log(
    `✅ Inserted ${inserted}/${rows.length} recipients (first ${args.alreadySent} marked sent_at=imported)`,
  );

  const summary = await db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN sent_at IS NULL THEN 1 ELSE 0 END) AS pending FROM cold_email_recipients WHERE campaign_id = ?",
    )
    .get(args.campaign);
  console.log(
    `📊 Campaign ${args.campaign}: total=${summary?.total ?? 0}, sent=${summary?.sent ?? 0}, pending=${summary?.pending ?? 0}`,
  );

  if (db?.close) await db.close();
}

main().catch((err) => {
  console.error(`✖ import failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
