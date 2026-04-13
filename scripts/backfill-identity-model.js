#!/usr/bin/env node

/**
 * Backfill Identity Model
 *
 * Migrates existing data into the three-layer identity model:
 *   1. user_auth_providers — backfill verified_at, linked_at, last_used_at
 *   2. user_contacts       — create from phones, emails, Apple claims
 *   3. users.*             — authoritative mirror rebuild from contacts
 *
 * Provenance-aware: verified_at comes from the original verification event
 * (phone_verifications, email_verification_tokens/auth_events, provider validation), never fabricated.
 *
 * Usage: node scripts/backfill-identity-model.js [--dry-run] [--verbose]
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { getDatabase } = require(path.join(__dirname, "..", "src", "database", "index.js"));
const {
  normalizeEmail,
  normalizePhone,
  isAppleRelay,
  syncUserContactMirrors,
} = require(path.join(__dirname, "..", "src", "services", "identity-service.js"));

// ==================== CLI FLAGS ====================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const VERBOSE = args.includes("--verbose");

// ==================== LOGGING ====================

function log(msg) {
  console.log(`[backfill] ${msg}`);
}

function verbose(msg) {
  if (VERBOSE) console.log(`[backfill:verbose] ${msg}`);
}

function warn(msg) {
  console.warn(`[backfill:WARN] ${msg}`);
}

function fatal(msg) {
  console.error(`[backfill:FATAL] ${msg}`);
}

const { generateId } = require(path.join(__dirname, "..", "src", "utils", "ids.js"));

// ==================== BATCH HELPER ====================

const BATCH_CONCURRENCY = 10;

/**
 * Process items in parallel batches with bounded concurrency.
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to call per item
 * @param {number} [concurrency=BATCH_CONCURRENCY] - Max parallel tasks
 */
async function processBatch(items, fn, concurrency = BATCH_CONCURRENCY) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.all(batch.map(fn));
  }
}

// ==================== MAIN ====================

async function main() {
  log(`Starting identity model backfill${DRY_RUN ? " (DRY RUN)" : ""}...`);

  const db = await getDatabase({ provider: "postgres" });

  const stats = {
    usersProcessed: 0,
    identitiesBackfilled: 0,
    contactsCreated: { email: 0, phone: 0 },
    relayEmailsDetected: 0,
    mirrorsRebuilt: 0,
    conflictsFound: 0,
    skippedExistingContacts: 0,
    // Provenance audit: tracks WHERE each verified_at came from.
    // left_unverified is derived in printSummary (total - sum of positive counters).
    provenance: {
      phone_verifications: 0,      // Direct verification record
      email_verification_token: 0,  // Token use timestamp
      auth_event_email_verified: 0, // Audit event fallback
      apple_token_validated: 0,     // Apple identity token (legitimate: validated at sign-in)
      google_token_validated: 0,    // Google identity token (legitimate: validated at sign-in)
      apple_email_claim: 0,         // Apple emailVerified claim (legitimate: Apple verified)
      total_decisions: 0,           // Total provenance decisions made (incremented at every return)
    },
  };

  const conflicts = [];

  try {
    // ================================================================
    // PHASE 0: Pre-flight schema check
    // ================================================================
    log("Phase 0: Verifying required schema...");
    await verifySchema(db);

    // ================================================================
    // PHASE 1: Backfill auth identity metadata (provenance-aware)
    // ================================================================
    log("Phase 1: Backfilling auth identity metadata...");
    await backfillIdentityMetadata(db, stats);

    // ================================================================
    // PHASE 2: Build user_contacts from existing data
    // ================================================================
    log("Phase 2: Building user_contacts...");
    await buildUserContacts(db, stats, conflicts);

    // ================================================================
    // PHASE 3: Conflict detection (hard failure)
    // ================================================================
    log("Phase 3: Checking for cross-user conflicts...");
    await detectConflicts(db, stats, conflicts);

    if (conflicts.length > 0) {
      stats.conflictsFound = conflicts.length;
      const reportPath = path.join(__dirname, "conflict-report.json");
      fs.writeFileSync(reportPath, JSON.stringify(conflicts, null, 2));
      fatal(`Found ${conflicts.length} conflict(s). Report written to ${reportPath}`);
      printSummary(stats);
      await db.close();
      process.exit(1);
    }

    // ================================================================
    // PHASE 4: Rebuild mirrors
    // ================================================================
    log("Phase 4: Rebuilding user mirror columns...");
    await rebuildMirrors(db, stats);

    // ================================================================
    // DONE
    // ================================================================
    printSummary(stats);
  } finally {
    await db.close();
  }
}

// ==================== PHASE 0: SCHEMA VERIFICATION ====================

async function verifySchema(db) {
  const requiredColumns = [
    { table: "user_auth_providers", column: "verified_at", migration: "090_auth_identities_columns.sql" },
    { table: "user_auth_providers", column: "linked_at", migration: "090_auth_identities_columns.sql" },
    { table: "user_auth_providers", column: "status", migration: "090_auth_identities_columns.sql" },
  ];

  const requiredTables = [
    { table: "user_contacts", migration: "091_user_contacts.sql" },
    { table: "phone_verifications", migration: "037_phone_auth.sql" },
  ];

  // Check required tables exist
  for (const { table, migration } of requiredTables) {
    const result = await db.prepare(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = ?
      ) AS exists`
    ).get(table);

    if (!result || !result.exists) {
      throw new Error(
        `Required table '${table}' does not exist. Run migration ${migration} first.`
      );
    }
  }

  // Check required columns exist
  for (const { table, column, migration } of requiredColumns) {
    const result = await db.prepare(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ? AND column_name = ?
      ) AS exists`
    ).get(table, column);

    if (!result || !result.exists) {
      throw new Error(
        `Required column '${table}.${column}' does not exist. Run migration ${migration} first.`
      );
    }
  }

  log("  Schema verified OK");
}

// ==================== PHASE 1: IDENTITY METADATA ====================

async function backfillIdentityMetadata(db, stats) {
  // Get all auth providers that are missing verified_at or linked_at
  const providers = await db.prepare(
    `SELECT uap.id, uap.user_id, uap.provider, uap.provider_user_id,
            uap.provider_data, uap.created_at, uap.verified_at, uap.linked_at
     FROM user_auth_providers uap
     JOIN users u ON u.id = uap.user_id
     WHERE u.deleted_at IS NULL
     ORDER BY uap.created_at`
  ).all();

  log(`  Found ${providers.length} auth identities to process`);

  for (const prov of providers) {
    const updates = {};

    // linked_at: always use created_at if missing
    if (!prov.linked_at) {
      updates.linked_at = prov.created_at;
    }

    // verified_at: provenance-aware per provider type
    if (!prov.verified_at) {
      const verifiedAt = await resolveVerifiedAt(db, prov, stats);
      if (verifiedAt) {
        updates.verified_at = verifiedAt;
      }
    }

    if (Object.keys(updates).length === 0) {
      verbose(`  Identity ${prov.id} (${prov.provider}) already has metadata, skipping`);
      continue;
    }

    verbose(`  Identity ${prov.id} (${prov.provider}/${prov.provider_user_id}): setting ${Object.keys(updates).join(", ")}`);

    if (!DRY_RUN) {
      const setClauses = [];
      const params = [];
      for (const [col, val] of Object.entries(updates)) {
        setClauses.push(`${col} = ?`);
        params.push(val);
      }
      params.push(prov.id);

      await db.prepare(
        `UPDATE user_auth_providers SET ${setClauses.join(", ")} WHERE id = ?`
      ).run(...params);
    }

    stats.identitiesBackfilled++;
  }

  log(`  Backfilled ${stats.identitiesBackfilled} identities`);
}

/**
 * Determine verified_at for an auth provider using provenance.
 * Returns ISO timestamp or null if provenance cannot be established.
 */
async function resolveVerifiedAt(db, prov, stats) {
  switch (prov.provider) {
    case "phone": {
      // Look up phone_verifications for a matching verified record
      const phoneVerif = await db.prepare(
        `SELECT verified_at FROM phone_verifications
         WHERE phone_number = ? AND verified_at IS NOT NULL
         ORDER BY verified_at DESC LIMIT 1`
      ).get(prov.provider_user_id);

      if (phoneVerif) {
        verbose(`    Phone ${prov.provider_user_id}: verified_at from phone_verifications`);
        stats.provenance.phone_verifications++;
        stats.provenance.total_decisions++;
        return phoneVerif.verified_at;
      }

      warn(`    Phone ${prov.provider_user_id}: no verification record, leaving unverified`);
      stats.provenance.total_decisions++;
      return null;
    }

    case "apple": {
      // OAuth token validation at sign-in IS the verification event — created_at is when we confirmed it.
      verbose(`    Apple ${prov.provider_user_id}: verified_at = created_at (token validated at creation)`);
      stats.provenance.apple_token_validated++;
      stats.provenance.total_decisions++;
      return prov.created_at;
    }

    case "email": {
      // Delegate to shared query logic (same queries used in buildContactsForUser)
      const verifiedAt = await resolveVerifiedEmailAt(db, prov.user_id);
      if (verifiedAt) {
        verbose(`    Email ${prov.provider_user_id}: verified_at from email provenance`);
        // Attribute to the more specific source for audit
        stats.provenance.email_verification_token++;
        stats.provenance.total_decisions++;
        return verifiedAt;
      }

      verbose(`    Email ${prov.provider_user_id}: no verification provenance, leaving unverified`);
      stats.provenance.total_decisions++;
      return null;
    }

    case "google": {
      // Same reasoning as Apple — OAuth token validation IS verification.
      verbose(`    Google ${prov.provider_user_id}: verified_at = created_at (token validated at creation)`);
      stats.provenance.google_token_validated++;
      stats.provenance.total_decisions++;
      return prov.created_at;
    }

    default:
      warn(`    Unknown provider type '${prov.provider}' for identity ${prov.id}`);
      stats.provenance.total_decisions++;
      return null;
  }
}

// ==================== PHASE 2: BUILD USER CONTACTS ====================

async function buildUserContacts(db, stats, conflicts) {
  const users = await db.prepare(
    `SELECT id, email, email_verified, phone_number, created_at
     FROM users WHERE deleted_at IS NULL ORDER BY created_at`
  ).all();

  stats.usersProcessed = users.length;
  log(`  Processing ${users.length} users`);

  await processBatch(users, (user) => buildContactsForUser(db, user, stats, conflicts));

  log(`  Created ${stats.contactsCreated.phone} phone + ${stats.contactsCreated.email} email contacts`);
  log(`  Detected ${stats.relayEmailsDetected} Apple relay emails`);
  log(`  Skipped ${stats.skippedExistingContacts} already-existing contacts`);
}

async function buildContactsForUser(db, user, stats, conflicts) {
  // Fetch core columns for all providers; provider_data only for Apple (avoids large JSON for others)
  const providers = await db.prepare(
    `SELECT id, provider, provider_user_id,
            CASE WHEN provider = 'apple' THEN provider_data ELSE NULL END AS provider_data,
            created_at, verified_at
     FROM user_auth_providers
     WHERE user_id = ? AND status = 'active'
     ORDER BY created_at`
  ).all(user.id);

  const hasAppleProvider = providers.some((p) => p.provider === "apple");

  // Track contacts we create for this user to determine primary
  const createdByType = { email: [], phone: [] };

  // ---- Phone contacts from phone providers ----
  for (const prov of providers.filter((p) => p.provider === "phone")) {
    const phone = prov.provider_user_id;
    const normalized = normalizePhone(phone);

    if (await contactExists(db, user.id, "phone", normalized)) {
      verbose(`  User ${user.id}: phone contact ${normalized} already exists`);
      stats.skippedExistingContacts++;
      continue;
    }

    const verifiedAt = prov.verified_at || null;

    verbose(`  User ${user.id}: creating phone contact ${normalized} (verified: ${!!verifiedAt})`);

    if (!DRY_RUN) {
      const contactId = generateId("uc");
      await db.prepare(
        `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, source_identity_id, is_primary, is_relay, created_at)
         VALUES (?, ?, 'phone', ?, ?, ?, 'phone_otp', ?, false, false, ?)`
      ).run(contactId, user.id, normalized, phone, verifiedAt, prov.id, prov.created_at);
      createdByType.phone.push({ contactId, verifiedAt });
    }
    stats.contactsCreated.phone++;
  }

  // ---- Email contacts from users.email ----
  if (user.email) {
    const normalized = normalizeEmail(user.email);

    if (await contactExists(db, user.id, "email", normalized)) {
      verbose(`  User ${user.id}: email contact ${normalized} already exists`);
      stats.skippedExistingContacts++;
    } else {
      const relay = isAppleRelay(normalized);
      if (relay) stats.relayEmailsDetected++;

      // Determine source: if user has Apple provider, email likely came from Apple claim
      const source = hasAppleProvider ? "apple_claim" : "user_entered";

      // Prefer real verification provenance. The mirror flag alone is not enough.
      const verifiedAt = await resolveVerifiedEmailAt(db, user.id);

      verbose(`  User ${user.id}: creating email contact ${normalized} (relay: ${relay}, source: ${source}, verified: ${!!verifiedAt})`);

      if (!DRY_RUN) {
        const contactId = generateId("uc");
        await db.prepare(
          `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, source_identity_id, is_primary, is_relay, created_at)
           VALUES (?, ?, 'email', ?, ?, ?, ?, ?, false, ?, ?)`
        ).run(
          contactId, user.id, normalized, user.email, verifiedAt, source,
          // Link to Apple provider if that's the source
          hasAppleProvider ? providers.find((p) => p.provider === "apple")?.id || null : null,
          relay, user.created_at
        );
        createdByType.email.push({ contactId, verifiedAt });
      }
      stats.contactsCreated.email++;
    }
  }

  // ---- Apple provider_data emails not already covered ----
  for (const prov of providers.filter((p) => p.provider === "apple")) {
    let providerData;
    try {
      providerData = prov.provider_data ? JSON.parse(prov.provider_data) : null;
    } catch {
      warn(`  User ${user.id}: could not parse provider_data for Apple identity ${prov.id} — skipping Apple email contact`);
      stats.parseErrors = (stats.parseErrors || 0) + 1;
      continue;
    }

    if (!providerData?.email) continue;

    const appleEmail = normalizeEmail(providerData.email);

    // Skip if this is a relay email (already covered above if user.email matched)
    // or if it already exists as a contact
    if (await contactExists(db, user.id, "email", appleEmail)) {
      verbose(`  User ${user.id}: Apple claim email ${appleEmail} already exists as contact`);
      stats.skippedExistingContacts++;
      continue;
    }

    // Only create if it's a non-relay email not already in contacts
    if (isAppleRelay(appleEmail)) {
      // Relay emails from Apple that weren't caught above
      stats.relayEmailsDetected++;
    }

    const relay = isAppleRelay(appleEmail);
    // Provenance: Apple's emailVerified claim IS verification — Apple verified the address.
    // prov.created_at is when we received and validated this claim. Not fabricated.
    const verifiedAt = providerData.emailVerified ? prov.created_at : null;
    stats.provenance.total_decisions++;
    if (verifiedAt) stats.provenance.apple_email_claim++;

    verbose(`  User ${user.id}: creating Apple claim email ${appleEmail} (relay: ${relay}, verified: ${!!verifiedAt})`);

    if (!DRY_RUN) {
      const contactId = generateId("uc");
      await db.prepare(
        `INSERT INTO user_contacts (id, user_id, type, value_normalized, value_display, verified_at, source, source_identity_id, is_primary, is_relay, created_at)
         VALUES (?, ?, 'email', ?, ?, ?, 'apple_claim', ?, false, ?, ?)`
      ).run(contactId, user.id, appleEmail, providerData.email, verifiedAt, prov.id, relay, prov.created_at);
      createdByType.email.push({ contactId, verifiedAt });
    }
    stats.contactsCreated.email++;
  }

  // ---- Set deterministic primary ----
  // First verified contact of each type; if none verified, first contact.
  if (!DRY_RUN) {
    for (const type of ["email", "phone"]) {
      await setDeterministicPrimary(db, user.id, type);
    }
  }
}

/**
 * Check if a contact already exists for this user+type+value.
 * Used for idempotency — safe to run the script multiple times.
 */
async function contactExists(db, userId, type, valueNormalized) {
  const row = await db.prepare(
    `SELECT id FROM user_contacts WHERE user_id = ? AND type = ? AND value_normalized = ?`
  ).get(userId, type, valueNormalized);
  return !!row;
}

async function resolveVerifiedEmailAt(db, userId) {
  const tokenUse = await db.prepare(
    `SELECT used_at FROM email_verification_tokens
     WHERE user_id = ? AND used_at IS NOT NULL
     ORDER BY used_at DESC LIMIT 1`
  ).get(userId);

  if (tokenUse?.used_at) {
    return tokenUse.used_at;
  }

  const event = await db.prepare(
    `SELECT created_at FROM auth_events
     WHERE user_id = ? AND event_type = 'email_verified'
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId);

  return event?.created_at || null;
}

/**
 * Set deterministic primary: first verified contact of this type.
 * If none verified, first contact by created_at.
 */
async function setDeterministicPrimary(db, userId, type) {
  // First: unset all primaries for this user+type
  await db.prepare(
    `UPDATE user_contacts SET is_primary = false WHERE user_id = ? AND type = ?`
  ).run(userId, type);

  // Pick the primary: first verified, then first overall
  const primary = await db.prepare(
    `SELECT id FROM user_contacts
     WHERE user_id = ? AND type = ?
     ORDER BY
       CASE WHEN verified_at IS NOT NULL THEN 0 ELSE 1 END,
       created_at ASC
     LIMIT 1`
  ).get(userId, type);

  if (primary) {
    await db.prepare(
      `UPDATE user_contacts SET is_primary = true WHERE id = ?`
    ).run(primary.id);
  }
}

// ==================== PHASE 3: CONFLICT DETECTION ====================

async function detectConflicts(db, stats, conflicts) {
  // Duplicate verified phones across different users
  const dupPhones = await db.prepare(
    `SELECT value_normalized, array_agg(DISTINCT user_id) AS user_ids
     FROM user_contacts
     WHERE type = 'phone' AND verified_at IS NOT NULL
     GROUP BY value_normalized
     HAVING COUNT(DISTINCT user_id) > 1`
  ).all();

  for (const dup of dupPhones) {
    conflicts.push({
      type: "duplicate_verified_phone",
      value: dup.value_normalized,
      user_ids: dup.user_ids,
    });
    warn(`  Duplicate verified phone ${dup.value_normalized} across users: ${dup.user_ids}`);
  }

  // Duplicate verified emails across different users
  const dupEmails = await db.prepare(
    `SELECT value_normalized, array_agg(DISTINCT user_id) AS user_ids
     FROM user_contacts
     WHERE type = 'email' AND verified_at IS NOT NULL
     GROUP BY value_normalized
     HAVING COUNT(DISTINCT user_id) > 1`
  ).all();

  for (const dup of dupEmails) {
    conflicts.push({
      type: "duplicate_verified_email",
      value: dup.value_normalized,
      user_ids: dup.user_ids,
    });
    warn(`  Duplicate verified email ${dup.value_normalized} across users: ${dup.user_ids}`);
  }

  // Check for ambiguous primary (more than one primary per user+type)
  // This shouldn't happen given our deterministic set, but check anyway
  const ambiguousPrimary = await db.prepare(
    `SELECT user_id, type, COUNT(*) AS cnt
     FROM user_contacts
     WHERE is_primary = true
     GROUP BY user_id, type
     HAVING COUNT(*) > 1`
  ).all();

  for (const amb of ambiguousPrimary) {
    conflicts.push({
      type: "ambiguous_primary",
      user_id: amb.user_id,
      contact_type: amb.type,
      count: amb.cnt,
    });
    warn(`  Ambiguous primary: user ${amb.user_id} has ${amb.cnt} primary ${amb.type} contacts`);
  }

  if (conflicts.length === 0) {
    log("  No conflicts found");
  }
}

// ==================== PHASE 4: REBUILD MIRRORS ====================

async function rebuildMirrors(db, stats) {
  // Get all non-deleted users who have at least one contact
  const usersWithContacts = await db.prepare(
    `SELECT DISTINCT uc.user_id
     FROM user_contacts uc
     JOIN users u ON u.id = uc.user_id
     WHERE u.deleted_at IS NULL`
  ).all();

  log(`  Rebuilding mirrors for ${usersWithContacts.length} users`);

  await processBatch(usersWithContacts, async ({ user_id }) => {
    if (!DRY_RUN) {
      await syncUserContactMirrors(db, user_id);
    }
    stats.mirrorsRebuilt++;
  });

  log(`  Rebuilt ${stats.mirrorsRebuilt} mirrors`);
}

// ==================== SUMMARY ====================

function printSummary(stats) {
  console.log("\n====================================");
  console.log("  BACKFILL SUMMARY");
  if (DRY_RUN) console.log("  ** DRY RUN — no writes performed **");
  console.log("====================================");
  console.log(`  Users processed:           ${stats.usersProcessed}`);
  console.log(`  Identities backfilled:     ${stats.identitiesBackfilled}`);
  console.log(`  Phone contacts created:    ${stats.contactsCreated.phone}`);
  console.log(`  Email contacts created:    ${stats.contactsCreated.email}`);
  console.log(`  Relay emails detected:     ${stats.relayEmailsDetected}`);
  console.log(`  Existing contacts skipped: ${stats.skippedExistingContacts}`);
  console.log(`  Mirrors rebuilt:           ${stats.mirrorsRebuilt}`);
  console.log(`  Conflicts found:           ${stats.conflictsFound}`);
  if (stats.parseErrors) console.log(`  Parse errors (skipped):    ${stats.parseErrors}`);
  console.log("------------------------------------");
  console.log("  VERIFICATION PROVENANCE AUDIT");
  console.log("------------------------------------");
  const p = stats.provenance;
  const verified = p.phone_verifications + p.email_verification_token
    + p.auth_event_email_verified + p.apple_token_validated
    + p.google_token_validated + p.apple_email_claim;
  const leftUnverified = p.total_decisions - verified;
  console.log(`  phone_verifications record: ${p.phone_verifications}`);
  console.log(`  email_verification_token:   ${p.email_verification_token}`);
  console.log(`  auth_event (email_verified): ${p.auth_event_email_verified}`);
  console.log(`  Apple token (validated):    ${p.apple_token_validated}`);
  console.log(`  Google token (validated):   ${p.google_token_validated}`);
  console.log(`  Apple email claim:          ${p.apple_email_claim}`);
  console.log(`  Left unverified (derived):  ${leftUnverified}`);
  console.log(`  Total decisions:            ${p.total_decisions}`);
  console.log("====================================\n");
}

// ==================== RUN ====================

main().catch((err) => {
  fatal(err.message);
  console.error(err.stack);
  process.exit(1);
});
