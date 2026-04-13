#!/usr/bin/env node
/**
 * seed-validation-fixtures.js
 *
 * Creates deterministic share fixtures for validation scenario testing (S4/S5/S6/S7/S8).
 * Run with: node scripts/seed-validation-fixtures.js
 *
 * Requires: local PostgreSQL running (npm run db:up)
 *
 * Creates:
 *   1. unbound_share_web_allowed — unclaimed share, browser playback enabled
 *   2. claimed_share_same_device — share claimed by device "validation-device-1"
 *   3. claimed_share_other_device — share claimed by device "validation-device-2"
 *   4. gift_share_app_required — gift share with app-claim policy
 *   5. gift_share_web_allowed — gift share with web-first policy
 *
 * Outputs: JSON with share IDs and URLs for each fixture.
 */

const crypto = require("crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// Load environment
require("dotenv").config();

const path = require("node:path");
const { getDatabase } = require("../src/database");
const { dbRun } = require("../src/utils/db-adapter");
const { getVersionDir } = require("../src/utils/common");
const { getFFmpegPath } = require("../src/utils/ffmpeg");

const FIXTURE_USER_ID = "validation-user-001";
const FIXTURE_DEVICE_1 = "validation-device-1";
const FIXTURE_DEVICE_2 = "validation-device-2";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), "storage");

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function newPin() {
  return String(crypto.randomInt(100000, 1000000));
}

function ensureSeededPreview(track, trackVersion) {
  const versionDir = getVersionDir(STORAGE_DIR, track, trackVersion);
  fs.mkdirSync(versionDir, { recursive: true });
  const previewPath = path.join(versionDir, "preview.m4a");
  if (!fs.existsSync(previewPath)) {
    execFileSync(getFFmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      previewPath,
    ]);
  }
}

async function main() {
  const db = await getDatabase({
    migrationsDir: path.join(process.cwd(), "migrations"),
  });

  // Ensure validation user exists
  await dbRun(
    db,
    `INSERT INTO users (id, risk_level, locale, created_at)
     VALUES (?, 0, 'en', CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO NOTHING`,
    [FIXTURE_USER_ID]
  );

  // Create a minimal track for each fixture
  const fixtures = {};
  const now = new Date().toISOString();
  const futureExpiry = "9999-12-31T23:59:59.000Z";

  const configs = [
    {
      name: "unbound_share_web_allowed",
      title: "Birthday Song for Sarah",
      recipient_name: "Sarah",
      occasion: "birthday",
      status: "unbound",
      web_stream_allowed: 1,
      bound_device_id: null,
      share_type: "lifetime",
      claim_policy: "default",
      delivery_source: "manual",
    },
    {
      name: "claimed_share_same_device",
      title: "Anniversary Song for Maria",
      recipient_name: "Maria",
      occasion: "anniversary",
      status: "claimed",
      web_stream_allowed: 1,
      bound_device_id: FIXTURE_DEVICE_1,
      share_type: "lifetime",
      claim_policy: "default",
      delivery_source: "manual",
    },
    {
      name: "claimed_share_other_device",
      title: "Thank You Song for Dad",
      recipient_name: "Dad",
      occasion: "thank_you",
      status: "claimed",
      web_stream_allowed: 0,
      bound_device_id: FIXTURE_DEVICE_2,
      share_type: "lifetime",
      claim_policy: "default",
      delivery_source: "manual",
    },
    {
      name: "gift_share_app_required",
      title: "Wedding Song for Emma",
      recipient_name: "Emma",
      occasion: "wedding",
      sender_display_name: "Marcus",
      status: "unbound",
      web_stream_allowed: 0,
      bound_device_id: null,
      share_type: "normal",
      claim_policy: "app_only",
      delivery_source: "gift",
    },
    {
      name: "gift_share_web_allowed",
      title: "Graduation Song for Alex",
      recipient_name: "Alex",
      occasion: "graduation",
      sender_display_name: "Marcus",
      status: "unbound",
      web_stream_allowed: 1,
      bound_device_id: null,
      share_type: "normal",
      claim_policy: "default",
      delivery_source: "gift",
    },
  ];

  for (const cfg of configs) {
    const trackId = newId("trk");
    const versionId = newId("tv");
    const shareId = newId("sh");
    const giftOrderId = cfg.delivery_source === "gift" ? newId("gift") : null;
    const pin = newPin();
    const streamKeyId = newId("sk");
    const streamKey = crypto.randomBytes(16).toString("base64");
    const track = { id: trackId, user_id: FIXTURE_USER_ID };
    const trackVersion = { id: versionId, version_num: 1 };

    // Create track
    await dbRun(
      db,
      `INSERT INTO tracks (
         id, user_id, status, title, occasion, recipient_name, style, duration_target,
         voice_mode, message, share_token_id, latest_version, created_at, updated_at
       ) VALUES (?, ?, 'completed', ?, ?, ?, 'acoustic', 60, 'ai', 'Validation fixture', NULL, 1, ?, ?)`,
      [trackId, FIXTURE_USER_ID, cfg.title, cfg.occasion, cfg.recipient_name, now, now]
    );

    // Create track version with a placeholder audio path
    await dbRun(
      db,
      `INSERT INTO track_versions (
         id, track_id, version_num, status, render_type, params_json, params_hash,
         created_at, preview_url
       ) VALUES (?, ?, 1, 'completed', 'preview', '{}', ?, ?, ?)`,
      [versionId, trackId, `hash_${versionId}`, now, "seeded-preview"]
    );
    ensureSeededPreview(track, trackVersion);

    if (giftOrderId) {
      await dbRun(
        db,
        `INSERT INTO gift_orders (
           id, sender_user_id, content_type, content_id, status, dispatch_status, delivery_mode,
           send_at, sender_timezone, recipient_name, sender_display_name, channels_json, recipient_phone,
           recipient_email, message, share_token_id, share_url, claim_pin, claim_policy, expires_in_days,
           dispatch_attempts, last_dispatch_error, dispatched_at, cancelled_at, token_transaction_id,
           refund_transaction_id, version_num, content_snapshot_json, next_retry_at, dispatch_started_at,
           idempotency_key, created_at, updated_at
         ) VALUES (?, ?, 'song', ?, 'scheduled', 'pending', 'immediate', ?, 'UTC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, 0, NULL, NULL, NULL, NULL, NULL, 1, NULL, ?, NULL, ?, ?, ?)`,
        [
          giftOrderId,
          FIXTURE_USER_ID,
          trackId,
          now,
          cfg.recipient_name,
          cfg.sender_display_name || null,
          JSON.stringify(["sms"]),
          "+15555550123",
          null,
          "Validation fixture",
          shareId,
          `${PUBLIC_BASE_URL}/play/${shareId}`,
          pin,
          cfg.claim_policy || "default",
          now,
          `validation_${giftOrderId}`,
          now,
          now,
        ]
      );
    }

    // Create share token
    await dbRun(
      db,
      `INSERT INTO share_tokens (
         id, track_id, track_version_id, creator_id, gift_order_id, status, share_type, claim_policy,
         web_stream_allowed, app_save_allowed, bound_device_id, bound_device_platform,
         claim_pin, claim_attempts, stream_key_id, stream_key, delivery_source,
         expires_at, created_at, access_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0)`,
      [
        shareId,
        trackId,
        versionId,
        FIXTURE_USER_ID,
        giftOrderId,
        cfg.status,
        cfg.share_type,
        cfg.claim_policy || null,
        cfg.web_stream_allowed,
        cfg.bound_device_id,
        cfg.bound_device_id ? "ios" : null,
        pin,
        streamKeyId,
        streamKey,
        cfg.delivery_source || null,
        futureExpiry,
        now,
      ],
    );

    // Link share to track
    await dbRun(db, `UPDATE tracks SET share_token_id = ?, updated_at = ? WHERE id = ?`, [
      shareId,
      now,
      trackId,
    ]);

    fixtures[cfg.name] = {
      shareId,
      shareUrl: `${PUBLIC_BASE_URL}/play/${shareId}`,
      trackId,
      pin,
      recipient_name: cfg.recipient_name,
      occasion: cfg.occasion,
      sender_display_name: cfg.sender_display_name || null,
      status: cfg.status,
      web_stream_allowed: cfg.web_stream_allowed,
    };
  }

  console.log("\n=== Validation Fixtures Created ===\n");
  console.log(JSON.stringify(fixtures, null, 2));
  console.log(
    "\n=== URLs ===\n"
  );
  for (const [name, f] of Object.entries(fixtures)) {
    console.log(`  ${name}: ${f.shareUrl}`);
    if (f.pin) console.log(`    PIN: ${f.pin}`);
  }
  console.log("");

  await db.close?.();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fixture creation failed:", err);
  process.exit(1);
});
