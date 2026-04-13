const { after, before, describe, test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

describe("PostgreSQL core schema repair migration", () => {
  let skipPostgres = false;
  let db = null;
  let schema = null;

  before(async () => {
    try {
      const { createPool } = require("../../src/database/postgres");
      db = createPool({
        database: process.env.POSTGRES_DB || "porizo",
      });
      await db.query("SELECT 1");
    } catch (err) {
      skipPostgres = true;
    }
  });

  after(async () => {
    if (!db) {
      return;
    }

    if (schema) {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await db.close();
  });

  test("repairs drifted schemas that skipped core workflow tables", async (t) => {
    if (skipPostgres) {
      return t.skip("PostgreSQL not available");
    }

    const { createPool, runMigrations } = require("../../src/database/postgres");
    const migrationsDir = path.join(process.cwd(), "migrations/pg");
    schema = `repair_core_${Date.now()}`;

    await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await db.query(`CREATE TABLE ${schema}.schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

    const appliedFiles = [
      "001_init.sql",
      "002_add_pipeline_assets.sql",
      "003_add_stream_key.sql",
      "004_add_provider_urls.sql",
      "005_add_lyrics_and_delete.sql",
      "006_add_provenance.sql",
      "007_add_access_tokens.sql",
      "008_add_share_pin.sql",
      "009_add_version_unique_constraint.sql",
      "010_add_story_context.sql",
      "011_add_moderation_details.sql",
      "012_add_job_locks.sql",
      "013_add_job_tracking.sql",
      "014_add_stream_base_url.sql",
      "015_add_poems.sql",
      "016_add_subscriptions.sql",
      "017_song_based_subscriptions.sql",
      "018_add_subscription_billing_columns.sql",
      "019_user_authentication.sql",
      "020_story_sessions.sql",
      "021_add_story_engine_v2.sql",
      "022_add_devices.sql",
      "023_admin_users.sql",
      "024_security_config.sql",
      "025_job_queue_name.sql",
      "026_provider_control.sql",
      "027_events.sql",
      "028_share_attribution.sql",
      "029_daily_aggregates.sql",
      "030_add_dead_letter_queue.sql",
      "031_add_user_deleted_at.sql",
      "032_add_webhook_dlq.sql",
      "033_add_subscription_unique_constraint.sql",
      "034_extend_auth_events_types.sql",
      "035_rate_limits_bigint.sql",
      "036_poem_sharing.sql",
      "037_phone_auth.sql",
      "038_stt_provider_config.sql",
      "039_voice_quality_tiers.sql",
      "040_seedvc_feature_flags.sql",
      "041_add_push_tokens.sql",
      "042_add_cover_image_urls.sql",
      "043_library_membership.sql",
      "044_orchestration_executions.sql",
      "045_orchestration_execution_events.sql",
      "046_music_provider_routing_config.sql",
      "047_tune_seedvc_feature_flags.sql",
      "048_timbre_blend_feature_flags.sql",
      "054_dlq_auto_reprocess.sql",
      "056_gift_scheduling_and_wallet.sql",
      "057_og_variant.sql",
      "058_add_poems_per_month.sql",
      "059_gift_reservations.sql",
      "060_gift_bundles.sql",
      "061_poem_entitlements.sql",
      "062_song_transactions_index.sql",
      "063_admin_upgrade.sql",
      "064_song_generation_entitlement.sql",
      "065_app_update_policy.sql",
      "066_ios_auto_update_policy.sql",
      "068_demo_shares.sql",
      "069_marketing_tables.sql",
      "070_d2c_contacts.sql",
      "073_voice_gender.sql",
      "074_story_session_version.sql",
      "075_update_plan_limits.sql",
      "076_onboarding_samples.sql",
      "077_blog_cms.sql",
      "078_add_phone_verifications_used_at.sql",
      "079_phone_provider_unified_auth.sql",
      "080_gift_delivery_hardening.sql",
      "080_verified_email_unique.sql",
      "081_gift_delivery_outbox.sql",
      "082_gift_funding_source.sql",
      "083_poem_share_binding_columns.sql",
      "084_gift_ops_observability.sql",
      "085_gift_order_recipient_name.sql",
      "086_gift_sender_display_name.sql",
      "087_apple_ads_attribution.sql",
    ];

    for (const filename of appliedFiles) {
      await db.query(
        `INSERT INTO ${schema}.schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [filename]
      );
    }

    // Simulate the drifted public schema: later tables exist, but the core workflow
    // tables never landed even though migrations claim they did.
    await db.query(`
      CREATE TABLE ${schema}.dead_letter_queue (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        original_status TEXT NOT NULL,
        failure_reason TEXT NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reprocessed_at TEXT,
        reprocess_job_id TEXT,
        auto_reprocess_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    const repairDb = createPool({
      database: process.env.POSTGRES_DB || "porizo",
      schema,
    });

    try {
      await runMigrations(repairDb, migrationsDir);

      const applied = await repairDb.query(
        "SELECT id FROM schema_migrations WHERE id = $1",
        ["088_repair_core_workflow_tables.sql"]
      );
      assert.equal(applied.rowCount, 1, "repair migration should apply");

      const tables = await repairDb.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name IN ('users', 'tracks', 'track_versions', 'jobs')
        ORDER BY table_name
      `, [schema]);
      assert.deepStrictEqual(
        tables.rows.map((row) => row.table_name),
        ["jobs", "track_versions", "tracks", "users"]
      );

      const jobsColumns = await repairDb.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'jobs'
        ORDER BY ordinal_position
      `, [schema]);
      assert.ok(
        jobsColumns.rows.some((row) => row.column_name === "last_heartbeat_at"),
        "jobs repair should include heartbeat tracking columns"
      );

      const tracksColumns = await repairDb.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'tracks'
        ORDER BY ordinal_position
      `, [schema]);
      assert.ok(
        tracksColumns.rows.some((row) => row.column_name === "funding_source"),
        "tracks repair should include funding_source"
      );
    } finally {
      await repairDb.close();
    }
  });
});
