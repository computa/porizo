# Free Signup Grant and Song Usage Reporting Fixes

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository follows the global ExecPlan standard at `~/.codex/PLANS.MD`. This plan also follows the local instruction to read `CLAUDE.md`, `specs/personalized-song-platform-spec.md`, and `docs/architecture-and-flows.md` before implementation.

> For agentic workers: REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

## Purpose / Big Picture

After this change, Porizo can explain song usage without confusing drafts, free signup songs, subscription songs, and paid one-off gift-wallet songs. A new user gets the admin-configured one-time free song grant at signup, currently seeded to two songs, and no recurring free monthly refill. The production/user reporting path exposes how many gift-wallet songs each user has spent, so a free-tier user with a paid one-off credit is no longer misread as bypassing the free plan.

The visible behavior is: a newly registered account shows the configured signup song grant, `/billing/trial/activate` no longer grants extra songs by default, rendering a paid one-off song increments a per-user gift-spend counter, and reports count rendered/charged songs rather than draft tracks.

## Progress

- [x] (2026-06-11) Production investigation completed: latest production user had three track records, two rendered songs, one paid gift-wallet spend, and one unrendered draft.
- [x] (2026-06-11) Plan authored with the product decision that signup grant becomes two one-time songs and future trial song grants are disabled by default.
- [x] (2026-06-11) Execution mode selected: use subagent-driven implementation, then specialist review, fixes, and verification.
- [x] (2026-06-11) Documentation/reporting guidance started in `docs/entitlements-and-song-usage.md`.
- [x] (2026-06-11) Added schema migration for `entitlements.gift_songs_used_total`, usage summary view, free signup grant value, and disabled default trial.
- [x] (2026-06-11) Updated backend entitlement creation, gift spend accounting, and billing payload.
- [x] (2026-06-11) Exposed `gift_songs_used_total` in the admin user list for per-user reporting.
- [x] (2026-06-11) Updated iOS entitlement model and API contract test coverage for the new field.
- [x] (2026-06-11) Added regression tests for free signup grant, disabled trial, gift spend accounting, and summary reporting.
- [x] (2026-06-11) Added admin endpoint regression coverage proving gift songs spent are displayed on user rows.
- [x] (2026-06-11) Specialist spec and code-quality reviews completed with no blocking findings.
- [x] (2026-06-11) Follow-up specialist review found three gaps: admin UI display, fail-open missing trial config, and stale signup-song flag mutability.
- [x] (2026-06-11) Fixed follow-up findings by adding the admin `Gift spent` column and failing trial config closed.
- [x] (2026-06-11) Corrected the signup grant implementation to remain admin-configurable through `free_tier_songs_grant`; current default/migration value is `2`.
- [x] (2026-06-11) Second specialist review completed with no blocking findings.
- [x] (2026-06-11) Targeted backend tests passed during implementation: 113/113.
- [x] (2026-06-11) Focused iOS API contract tests passed: 21/21.
- [x] (2026-06-11) Full `npm run lint` passed.
- [x] (2026-06-11) Full `npm test` passed unsandboxed: 588 tests, 582 passed, 6 skipped, 0 failed.
- [x] (2026-06-11) Final targeted backend tests for signup grant configurability and billing plans passed: 87/87.
- [x] (2026-06-11) Admin `npm run lint --prefix admin` and `npm run build --prefix admin` passed.

## Surprises & Discoveries

- Observation: The current free signup grant is not monthly.
  Evidence: `src/services/subscription-manager.js` reads `free_tier_songs_grant` only in `createFreeEntitlements()`, and `subscription_plans.free.songs_per_month` is already `0`.

- Observation: The production latest-user case was not a free quota bypass.
  Evidence: Production `user_fc93478281059eb3b524e9cd` had one free `song_transactions` spend, one `gift_wallet_transactions` `gift_purchase`, one gift `song_spend`, and one draft track without `song_entitlement_consumed_at`.

- Observation: If the product rule is "two songs at signup and that is it", the trial system must be disabled or it can still add extra songs to a free-tier account.
  Evidence: production `trial_config` had `songs_allowed = 2` and `is_active = 1` during investigation.

## Decision Log

- Decision: Seed `free_tier_songs_grant` to `2`, keep it admin-configurable through feature flags, and keep `subscription_plans.free.songs_per_month = 0`.
  Rationale: The product request is a one-time signup allowance, not a free monthly plan, and admins need to be able to change the signup grant without a code change.
  Date/Author: 2026-06-11 / Codex

- Decision: Disable default trial song grants by setting `trial_config.is_active = 0` and `songs_allowed = 0`.
  Rationale: Leaving trial active would allow a free-tier user to get signup songs plus trial songs, contradicting "2 songs grant when user signs up and that is it."
  Date/Author: 2026-06-11 / Codex

- Decision: Add `entitlements.gift_songs_used_total` as the per-user gift spent column.
  Rationale: `songs_used_total` intentionally counts all render funding sources; a dedicated gift subset makes paid one-off usage auditable without joining the gift-wallet ledger every time.
  Date/Author: 2026-06-11 / Codex

- Decision: Reports must treat rendered/charged versions as songs, not draft tracks or `create_completed` events.
  Rationale: Track creation can produce drafts. Entitlement consumption happens on render endpoints, so track count is not the same as generated song count.
  Date/Author: 2026-06-11 / Codex

- Decision: Do not retroactively grant existing users up to two free songs in the migration.
  Rationale: The request says the grant occurs when a user signs up. Retroactive top-ups change existing balances and should be a separate explicit product decision.
  Date/Author: 2026-06-11 / Codex

## Outcomes & Retrospective

Implementation is complete and specialist review found no blocking issues. The backend now grants the configured one-time signup songs, records the signup grant in `song_transactions`, disables default trial grants, tracks gift-funded song spends in `entitlements.gift_songs_used_total`, and exposes that field in billing payloads, the admin user list, and reporting. The iOS model decodes `gift_songs_used_total`, and `APIContractTests.swift` is now included in the test target so the contract coverage actually runs.

The first follow-up review found three gaps after implementation: the admin Users page needed an actual visible `Gift spent` column, the trial runtime fallback needed to fail closed if the `trial_config` row was missing, and the signup grant policy needed explicit review. The grant was briefly hard-coded to `2`, then corrected after product feedback: admins can change `free_tier_songs_grant`, while the default and migration seed remain `2`. The second specialist review found no blocking issues before that product correction.

Final verification passed. The full Node test suite initially failed inside the filesystem sandbox because repo-local fixture writes under `storage/` and `marketing/email/.test-fixtures/` were blocked with `EPERM`; rerunning the same `npm test` outside the sandbox passed with 588 tests, 582 passed, 6 skipped, and 0 failed.

## Context and Orientation

The relevant backend is a Node.js/Fastify app. The core files are:

- `src/services/subscription-manager.js`: creates free entitlements, activates trials, spends song credits, spends gift-wallet tokens, and builds the entitlement model.
- `src/routes/billing.js`: exposes billing plans, entitlements, receipt sync, trial activation, admin grants, and the API payload consumed by iOS.
- `src/routes/tracks.js`: creates draft tracks and consumes song entitlement on render endpoints.
- `src/services/feature-flags.js`: stores default feature flag values used when DB flags are missing.
- `migrations/pg/*.sql` and `migrations/*.sql`: production PostgreSQL and local/test SQLite migrations.
- `PorizoApp/PorizoApp/Models/BillingModels.swift`: iOS decoding of billing entitlements.
- `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift`: iOS create-flow entitlement gate.

Definitions used in this plan:

Free signup grant means the one-time `songs_remaining` balance inserted by `createFreeEntitlements()` when a user registers.

Trial songs means `trial_songs_remaining`, currently granted by `POST /billing/trial/activate`.

Gift wallet means one-off paid credits stored in `gift_wallet.balance`, credited by `gift_bundle_*` Apple consumables and spent when regular/trial songs are exhausted.

Rendered song means a `track_versions` row whose song entitlement was consumed. Use `track_versions.song_entitlement_consumed_at IS NOT NULL` for charged/generated usage, not `tracks` count.

Draft track means a `tracks` row created by the story/create flow before rendering. Draft tracks are not generated songs.

## Plan of Work

Execution will follow the selected loop: first review and update this plan, then implement the scoped database, backend, client, test, and documentation tasks, then run specialist subagent reviews for spec compliance and code quality, fix valid findings, and finally verify the two acceptance behaviors. The acceptance behaviors are that a new signup receives the admin-configured one-time song grant, seeded to two by default, and that gift-funded songs spent per user are visible through backend reporting/API payloads.

First, add a schema migration that creates `entitlements.gift_songs_used_total`, backfills it from `gift_wallet_transactions`, changes future free signup grants to two, disables future trial activation by default, and creates a reporting view that separates draft tracks from rendered songs.

Second, update backend code so new users receive two free signup songs and that grant is recorded in `song_transactions`. Update gift-token song spending so it increments both `songs_used_total` and `gift_songs_used_total`.

Third, expose the new gift-spent value through `getEntitlements()` and `buildEntitlementsPayload()`. If iOS needs this field for diagnostics or display, decode it in `BillingEntitlements` while keeping backwards-compatible defaults.

Fourth, update tests. The tests must prove that a new free user gets two signup songs, the trial endpoint no longer grants songs by default, gift-wallet render spend increments `gift_songs_used_total`, and reporting counts rendered songs separately from draft tracks.

Finally, update documentation so future reports and agents do not repeat the same mistake. The key rule is: user tier does not imply funding source. A `tier = free` user can still have paid one-off credits.

## Concrete Steps

### Task 1: Add the schema migration

Files:

- Create `migrations/pg/117_free_grant_and_song_usage_reporting.sql`.
- Create `migrations/117_free_grant_and_song_usage_reporting.sql`.

Step 1. Create the PostgreSQL migration with these operations:

    ALTER TABLE entitlements
      ADD COLUMN IF NOT EXISTS gift_songs_used_total INTEGER NOT NULL DEFAULT 0;

    UPDATE entitlements e
       SET gift_songs_used_total = COALESCE((
         SELECT COUNT(*)::INTEGER
           FROM gift_wallet_transactions gwt
          WHERE gwt.user_id = e.user_id
            AND gwt.type = 'song_spend'
            AND gwt.amount < 0
       ), 0);

    INSERT INTO feature_flags (id, value, updated_at, updated_by)
    VALUES ('free_tier_songs_grant', '2', CURRENT_TIMESTAMP, 'migration_117')
    ON CONFLICT (id) DO UPDATE SET
      value = '2',
      updated_at = CURRENT_TIMESTAMP,
      updated_by = 'migration_117';

    INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
    VALUES (1, 0, 7, 0, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      songs_allowed = 0,
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP;

    DROP VIEW IF EXISTS user_song_usage_summary;

    CREATE VIEW user_song_usage_summary AS
    SELECT
      e.user_id,
      e.tier,
      e.songs_remaining,
      e.trial_songs_remaining,
      e.songs_used_total,
      e.gift_songs_used_total,
      GREATEST(e.songs_used_total - e.gift_songs_used_total, 0) AS non_gift_songs_used_total,
      COALESCE(gw.balance, 0) AS gift_wallet_balance,
      COALESCE(track_counts.tracks_total, 0) AS tracks_total,
      COALESCE(track_counts.draft_tracks_total, 0) AS draft_tracks_total,
      COALESCE(version_counts.versions_total, 0) AS versions_total,
      COALESCE(version_counts.charged_versions_total, 0) AS charged_versions_total,
      COALESCE(version_counts.ready_versions_total, 0) AS ready_versions_total
    FROM entitlements e
    LEFT JOIN gift_wallet gw ON gw.user_id = e.user_id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*)::INTEGER AS tracks_total,
        COUNT(*) FILTER (WHERE status = 'draft')::INTEGER AS draft_tracks_total
      FROM tracks
      WHERE deleted_at IS NULL
      GROUP BY user_id
    ) track_counts ON track_counts.user_id = e.user_id
    LEFT JOIN (
      SELECT
        t.user_id,
        COUNT(tv.*)::INTEGER AS versions_total,
        COUNT(*) FILTER (WHERE tv.song_entitlement_consumed_at IS NOT NULL)::INTEGER AS charged_versions_total,
        COUNT(*) FILTER (WHERE tv.status IN ('completed', 'preview_ready', 'full_ready'))::INTEGER AS ready_versions_total
      FROM tracks t
      JOIN track_versions tv ON tv.track_id = t.id
      WHERE t.deleted_at IS NULL
      GROUP BY t.user_id
    ) version_counts ON version_counts.user_id = e.user_id;

Step 2. Create the SQLite mirror migration. SQLite does not support `FILTER` in older builds, so use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`:

    ALTER TABLE entitlements ADD COLUMN gift_songs_used_total INTEGER NOT NULL DEFAULT 0;

    UPDATE entitlements
       SET gift_songs_used_total = COALESCE((
         SELECT COUNT(*)
           FROM gift_wallet_transactions
          WHERE gift_wallet_transactions.user_id = entitlements.user_id
            AND gift_wallet_transactions.type = 'song_spend'
            AND gift_wallet_transactions.amount < 0
       ), 0);

    INSERT INTO feature_flags (id, value, updated_at, updated_by)
    VALUES ('free_tier_songs_grant', '2', CURRENT_TIMESTAMP, 'migration_117')
    ON CONFLICT(id) DO UPDATE SET
      value = '2',
      updated_at = CURRENT_TIMESTAMP,
      updated_by = 'migration_117';

    INSERT INTO trial_config (id, songs_allowed, duration_days, is_active, updated_at)
    VALUES (1, 0, 7, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      songs_allowed = 0,
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP;

    DROP VIEW IF EXISTS user_song_usage_summary;

    CREATE VIEW user_song_usage_summary AS
    SELECT
      e.user_id,
      e.tier,
      e.songs_remaining,
      e.trial_songs_remaining,
      e.songs_used_total,
      e.gift_songs_used_total,
      CASE
        WHEN e.songs_used_total - e.gift_songs_used_total < 0 THEN 0
        ELSE e.songs_used_total - e.gift_songs_used_total
      END AS non_gift_songs_used_total,
      COALESCE(gw.balance, 0) AS gift_wallet_balance,
      COALESCE(track_counts.tracks_total, 0) AS tracks_total,
      COALESCE(track_counts.draft_tracks_total, 0) AS draft_tracks_total,
      COALESCE(version_counts.versions_total, 0) AS versions_total,
      COALESCE(version_counts.charged_versions_total, 0) AS charged_versions_total,
      COALESCE(version_counts.ready_versions_total, 0) AS ready_versions_total
    FROM entitlements e
    LEFT JOIN gift_wallet gw ON gw.user_id = e.user_id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) AS tracks_total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_tracks_total
      FROM tracks
      WHERE deleted_at IS NULL
      GROUP BY user_id
    ) track_counts ON track_counts.user_id = e.user_id
    LEFT JOIN (
      SELECT
        t.user_id,
        COUNT(tv.id) AS versions_total,
        SUM(CASE WHEN tv.song_entitlement_consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS charged_versions_total,
        SUM(CASE WHEN tv.status IN ('completed', 'preview_ready', 'full_ready') THEN 1 ELSE 0 END) AS ready_versions_total
      FROM tracks t
      JOIN track_versions tv ON tv.track_id = t.id
      WHERE t.deleted_at IS NULL
      GROUP BY t.user_id
    ) version_counts ON version_counts.user_id = e.user_id;

Step 3. Validate migration syntax with the SQLite-backed targeted tests after Task 5. Do not run this migration manually against production during implementation unless this branch is ready to deploy.

### Task 2: Update backend defaults and entitlement model

Files:

- Modify `src/services/feature-flags.js`.
- Modify `src/services/subscription-manager.js`.
- Modify `src/routes/billing.js`.

Step 1. In `src/services/feature-flags.js`, change the default:

    free_tier_songs_grant: 2,

Keep `free_tier_poems_grant: 1` unchanged.

Step 2. In `src/services/subscription-manager.js`, add a new transaction type:

    FREE_SIGNUP_GRANT: "free_signup_grant",

Step 3. Update `createFreeEntitlements()` so it records a grant row only when the entitlement row is newly inserted. Replace the current direct `db.prepare(...).run(...)` flow with a transaction-shaped flow:

    async function createFreeEntitlements(userId, opts = {}) {
      const songsGrant = await getFeatureFlag(db, "free_tier_songs_grant");
      const poemsGrant = await getFeatureFlag(db, "free_tier_poems_grant");
      const now = opts.now || new Date().toISOString();
      const previewCountToday = opts.previewCountToday ?? 0;
      const previewCountResetAt =
        opts.previewCountResetAt || new Date(Date.now() + 86400000).toISOString();

      await db.transaction(async (query) => {
        const result = await query(
          `INSERT INTO entitlements (user_id, tier, songs_remaining, poems_remaining,
             preview_count_today, preview_count_reset_at, updated_at)
           VALUES (?, 'free', ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            userId,
            songsGrant,
            poemsGrant,
            previewCountToday,
            previewCountResetAt,
            now,
          ],
        );

        if ((result.changes ?? result.rowCount ?? 0) > 0 && songsGrant > 0) {
          await recordSongTransaction(
            query,
            userId,
            TRANSACTION_TYPES.FREE_SIGNUP_GRANT,
            songsGrant,
            0,
            songsGrant,
            "free_signup",
            userId,
            "Free signup song grant",
          );
        }
      });
    }

Step 4. In `getEntitlements()`, read and return `giftSongsUsedTotal`:

    giftSongsUsedTotal: toSafeInt(ent.gift_songs_used_total),

Step 5. In `src/routes/billing.js`, include the field in both the null payload and normal payload:

    gift_songs_used_total: 0,

and:

    gift_songs_used_total: toSafeInt(entitlements.giftSongsUsedTotal),

Step 6. Keep `available_song_credits` as ongoing songs plus gift wallet balance. Do not include spent counts in availability.

### Task 3: Count gift-funded render spend per user

File:

- Modify `src/services/subscription-manager.js`.

Step 1. In the gift-token branch of `spendSongInTransaction()`, change the entitlements update from:

    UPDATE entitlements SET
      songs_used_total = songs_used_total + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?

to:

    UPDATE entitlements SET
      songs_used_total = songs_used_total + 1,
      gift_songs_used_total = gift_songs_used_total + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?

Step 2. Leave regular and trial spends unchanged. They increment `songs_used_total` only.

Step 3. Leave gift-token spend records in `gift_wallet_transactions`. Do not duplicate gift spends in `song_transactions`; the new per-user column and summary view make the split explicit.

### Task 4: Keep the client compatible

Files:

- Modify `PorizoApp/PorizoApp/Models/BillingModels.swift`.
- Modify `PorizoApp/PorizoAppTests/APIContractTests.swift`.

Step 1. Add `giftSongsUsedTotal` to `BillingEntitlements`:

    let giftSongsUsedTotal: Int

Step 2. Add the coding key:

    case giftSongsUsedTotal = "gift_songs_used_total"

Step 3. Decode it with a default of zero:

    giftSongsUsedTotal = container.decodeFlexibleIntIfPresent(forKey: .giftSongsUsedTotal) ?? 0

Step 4. Update `fixture()` to accept `giftSongsUsedTotal: Int = 0` and include:

    "gift_songs_used_total": giftSongsUsedTotal,

Step 5. Add an API contract test that decodes:

    {"tier":"free","songs_remaining":0,"gift_wallet_balance":0,"gift_songs_used_total":2,"available_song_credits":0,"pay_per_song_enabled":true}

Expected:

    XCTAssertEqual(e.giftSongsUsedTotal, 2)
    XCTAssertFalse(e.canMakeSong)

### Task 5: Add backend regression tests

Files:

- Modify `test/subscription-manager.test.js`.
- Modify `test/billing-api.test.js`.
- Create `test/song-usage-summary.test.js`.
- Modify `test/plan-config.test.js` if it asserts trial defaults.

Step 1. In `test/subscription-manager.test.js`, add a `createFreeEntitlements` describe block:

    describe("createFreeEntitlements", () => {
      it("grants the configured one-time signup songs and records the grant", async () => {
        await manager.createFreeEntitlements(testUserId);

        const ent = await manager.getEntitlements(testUserId);
        assert.equal(ent.tier, "free");
        assert.equal(ent.baseSongsRemaining, 2);
        assert.equal(ent.songsRemaining, 2);
        assert.equal(ent.trialSongsRemaining, 0);

        const tx = await db.query(
          "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
          [testUserId, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
        );
        assert.equal(tx.rows.length, 1);
        assert.equal(Number(tx.rows[0].amount), 2);
        assert.equal(Number(tx.rows[0].balance_before), 0);
        assert.equal(Number(tx.rows[0].balance_after), 2);
      });

      it("does not duplicate the signup grant when entitlements already exist", async () => {
        await manager.createFreeEntitlements(testUserId);
        await manager.createFreeEntitlements(testUserId);

        const tx = await db.query(
          "SELECT * FROM song_transactions WHERE user_id = ? AND type = ?",
          [testUserId, TRANSACTION_TYPES.FREE_SIGNUP_GRANT],
        );
        assert.equal(tx.rows.length, 1);

        const ent = await manager.getEntitlements(testUserId);
        assert.equal(ent.songsRemaining, 2);
      });
    });

Step 2. Update gift-wallet spend tests in `test/subscription-manager.test.js` to assert the per-user column:

    const ent = await manager.getEntitlements(testUserId);
    assert.equal(ent.songsUsedTotal, 1);
    assert.equal(ent.giftSongsUsedTotal, 1);

Step 3. Add a mixed-spend test:

    it("tracks gift spend as a subset of total song spend", async () => {
      await db.query(
        `INSERT INTO entitlements (user_id, tier, songs_remaining, trial_songs_remaining, updated_at)
         VALUES (?, 'free', 1, 0, datetime('now'))`,
        [testUserId],
      );
      await seedGiftWallet(testUserId, 1);

      const first = await manager.spendSong(testUserId, "regular_track");
      assert.equal(first.source, "subscription");

      const second = await manager.spendSong(testUserId, "gift_track");
      assert.equal(second.source, "gift_token");

      const ent = await manager.getEntitlements(testUserId);
      assert.equal(ent.songsUsedTotal, 2);
      assert.equal(ent.giftSongsUsedTotal, 1);
    });

Step 4. Update trial tests. Because the default product rule disables future trial grants, any test that needs trial behavior must explicitly enable it:

    await db.query(
      "UPDATE trial_config SET songs_allowed = 2, duration_days = 7, is_active = 1, updated_at = datetime('now') WHERE id = 1",
    );

Add a separate test for the default:

    it("does not activate trial by default", async () => {
      await assert.rejects(
        () => manager.activateTrial(testUserId),
        /Free trial is currently disabled/,
      );
    });

Step 5. In `test/billing-api.test.js`, update payload assertions to include `gift_songs_used_total`, and update trial endpoint tests so the default response is `503 TRIAL_DISABLED` unless the test explicitly enables trial config.

Step 6. Create `test/song-usage-summary.test.js`:

    const { test } = require("node:test");
    const assert = require("node:assert/strict");
    const { getDatabase } = require("../src/database");

    test("user_song_usage_summary separates drafts, charged renders, and gift spend", async () => {
      const db = await getDatabase();
      const userId = `summary_user_${Date.now()}`;
      const readyTrack = "summary_track_ready";
      const draftTrack = "summary_track_draft";
      const now = new Date().toISOString();

      await db.query("INSERT INTO users (id, created_at) VALUES (?, ?)", [userId, now]);
      await db.query(
        "INSERT INTO entitlements (user_id, tier, songs_remaining, songs_used_total, gift_songs_used_total, updated_at) VALUES (?, 'free', 0, 2, 1, ?)",
        [userId, now],
      );
      await db.query(
        "INSERT INTO gift_wallet (user_id, balance, updated_at) VALUES (?, 0, ?)",
        [userId, now],
      );
      await db.query(
        "INSERT INTO tracks (id, user_id, status, created_at, updated_at) VALUES (?, ?, 'ready', ?, ?)",
        [readyTrack, userId, now, now],
      );
      await db.query(
        "INSERT INTO tracks (id, user_id, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)",
        [draftTrack, userId, now, now],
      );
      await db.query(
        "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at, song_entitlement_consumed_at) VALUES (?, ?, 1, 'full_ready', 'preview', 'h1', ?, ?)",
        ["summary_version_ready", readyTrack, now, now],
      );
      await db.query(
        "INSERT INTO track_versions (id, track_id, version_num, status, render_type, params_hash, created_at) VALUES (?, ?, 1, 'draft', 'preview', 'h2', ?)",
        ["summary_version_draft", draftTrack, now],
      );

      const result = await db.query(
        "SELECT * FROM user_song_usage_summary WHERE user_id = ?",
        [userId],
      );

      assert.equal(result.rows.length, 1);
      assert.equal(Number(result.rows[0].tracks_total), 2);
      assert.equal(Number(result.rows[0].draft_tracks_total), 1);
      assert.equal(Number(result.rows[0].versions_total), 2);
      assert.equal(Number(result.rows[0].charged_versions_total), 1);
      assert.equal(Number(result.rows[0].songs_used_total), 2);
      assert.equal(Number(result.rows[0].gift_songs_used_total), 1);
      assert.equal(Number(result.rows[0].non_gift_songs_used_total), 1);
    });

If the test schema requires non-null columns beyond these inserts, read `migrations/pg/088_repair_core_workflow_tables.sql` and adjust only the missing required columns. Do not add unrelated fields.

### Task 6: Update docs and reporting guidance

Files:

- Create `docs/entitlements-and-song-usage.md`.
- Optionally link it from `docs/architecture-and-flows.md` if the architecture doc has an entitlement section nearby.

Step 1. Create `docs/entitlements-and-song-usage.md` with these rules:

    # Entitlements And Song Usage

    New users receive the admin-configured one-time free signup song grant from `free_tier_songs_grant`, currently seeded to 2 song credits. The free subscription plan remains 0 songs per month; there is no monthly free refill.

    Trial song grants are disabled by default. Re-enabling `trial_config.is_active` must be a deliberate product decision because it adds songs on top of the signup grant.

    `tier = free` does not mean unpaid. A free-tier user can have paid one-off credits in `gift_wallet.balance`.

    Count generated songs from `track_versions.song_entitlement_consumed_at IS NOT NULL`, not from `tracks` or `create_completed` events. Tracks can be drafts.

    Use `entitlements.songs_used_total` for all rendered songs charged to any funding source. Use `entitlements.gift_songs_used_total` for the subset funded by paid gift-wallet credits.

    For per-user reporting, prefer `user_song_usage_summary`.

Step 2. Add one sentence to `docs/architecture-and-flows.md` near the entitlement table:

    Song usage reporting must distinguish draft tracks from charged renders. Use `user_song_usage_summary` or `track_versions.song_entitlement_consumed_at`, not raw `tracks` count.

## Validation and Acceptance

Run the targeted backend tests from the repository root:

    NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/subscription-manager.test.js test/billing-api.test.js test/song-usage-summary.test.js

Expected: all targeted tests pass. The new signup-grant test fails before implementation because only one song is granted and no free signup grant transaction exists.

Run the iOS model contract tests if Task 4 changes Swift:

    cd PorizoApp
    xcodebuild test -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16'

Expected: API contract tests pass, including the `gift_songs_used_total` decoding case.

Run lint:

    npm run lint

Expected: no lint errors in changed JavaScript files.

Run full backend tests after targeted tests pass:

    npm test

Expected: full suite passes. If full-repo validation reports pre-existing failures, treat them as in scope and fix them before final handoff unless Ambrose explicitly says otherwise.

Production acceptance after deploy:

Run a read-only production SQL check:

    export RAILWAY_API_TOKEN=$(security find-generic-password -a "$USER" -s "railway-abcobimma" -w 2>/dev/null)
    cat <<'SQL' | railway connect postgres
    SELECT id, value FROM feature_flags WHERE id = 'free_tier_songs_grant';
    SELECT songs_allowed, is_active FROM trial_config WHERE id = 1;
    SELECT column_name FROM information_schema.columns WHERE table_name = 'entitlements' AND column_name = 'gift_songs_used_total';
    SQL

Expected:

    free_tier_songs_grant = 2
    trial_config.songs_allowed = 0
    trial_config.is_active = 0
    entitlements.gift_songs_used_total exists

For a newly registered test account after deploy, `GET /billing/entitlements` should report:

    tier = free
    songs_remaining = 2
    base_songs_remaining = 2
    trial_songs_remaining = 0
    gift_songs_used_total = 0
    available_song_credits = 2

After rendering one free song and one paid gift-wallet song, reporting should show:

    songs_used_total = 2
    gift_songs_used_total = 1
    gift_wallet_balance = 0
    charged_versions_total = 2

## Idempotence and Recovery

The migrations are safe to run once through the repository migration runner. The PostgreSQL migration uses `ADD COLUMN IF NOT EXISTS`, absolute backfill assignment, and `ON CONFLICT` updates for config rows. The SQLite migration is for local/test databases and should run in a fresh test DB through `getDatabase()`.

If the migration deploys but the code does not, the new column is harmless. Existing code ignores it. The feature flag change to `2` affects new signups immediately through existing `createFreeEntitlements()`.

If disabling trials causes a client UX issue, the immediate rollback is:

    UPDATE trial_config SET songs_allowed = 2, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;

Only use that rollback if Ambrose accepts that free-tier users can receive signup songs plus trial songs.

Do not retroactively edit existing user balances unless there is a separate, explicit correction plan. Existing users may have already been shown old balances.

## Artifacts and Notes

Production investigation evidence from 2026-06-11:

    latest user: user_fc93478281059eb3b524e9cd
    tier: free
    songs_remaining: 0
    songs_used_total: 2
    gift_wallet_balance: 0
    tracks_total: 3
    versions_total: 3
    versions_charged: 2
    song_transactions spend rows: 1
    gift_wallet_transactions song_spend rows: 1

The unrendered third track had `track_status = draft`, `version_status = draft`, and no `song_entitlement_consumed_at`.

## Interfaces and Dependencies

Backend public payload:

`GET /billing/entitlements` returns the existing fields plus:

    gift_songs_used_total: number

Backend model:

`subscriptionManager.getEntitlements(userId)` returns:

    giftSongsUsedTotal: number

Database:

`entitlements` has:

    gift_songs_used_total INTEGER NOT NULL DEFAULT 0

`user_song_usage_summary` exposes:

    user_id
    tier
    songs_remaining
    trial_songs_remaining
    songs_used_total
    gift_songs_used_total
    non_gift_songs_used_total
    gift_wallet_balance
    tracks_total
    draft_tracks_total
    versions_total
    charged_versions_total
    ready_versions_total

No new third-party dependencies are required.
