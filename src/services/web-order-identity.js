"use strict";

const { nowIso } = require("../utils/common");
const { newUuid } = require("../utils/ids");
const { createIdentityRepository } = require("../database/identity-repository");
const { mergeGuestIntoUser } = require("./guest-merge");

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve identity at the moment an order transitions to `paid`.
 *
 * Branches (spec §5.2 convergence, edge cases #10, #27):
 *   (a) buyer is already a non-guest account  -> no-op
 *   (b) email matches an existing VERIFIED contact of a DIFFERENT user
 *       -> atomic guest→existing merge (9-table), order ends owned by target
 *   (c) email is new, or matches only an UNVERIFIED contact
 *       -> attach an unverified user_contacts row (source 'stripe_checkout')
 *          to the buyer guest + promote to account_status='active'
 *
 * NEVER auto-verifies from Stripe (buyers can typo or enter someone else's
 * address — the delivery magic link is the verification event). NEVER merges on
 * an unverified match (no account takeover via typo'd email).
 *
 * Runs inside the caller's transaction via `query`; returns the user id that
 * should own the order going forward.
 *
 * @param {Function} query - transactional (sql, params) => result
 * @param {Object} args
 * @param {string} args.buyerUserId
 * @param {string} args.email
 * @param {Object} args.identityRepository - transaction-scoped identity repository
 */
async function convergeOrderIdentity(
  query,
  { buyerUserId, email, name, identityRepository },
) {
  const normalized = normalizeEmail(email);
  const displayName = String(name || "").trim();
  // Populate the buyer's display_name only when it's currently empty — never
  // clobber a real name (matters for the merge-into-existing-account case, which
  // is why this is only applied on the guest-promotion branches below).
  const setDisplayNameIfEmpty = async (userId) => {
    if (!displayName) return;
    await query(
      "UPDATE users SET display_name = COALESCE(NULLIF(TRIM(display_name), ''), ?) WHERE id = ?",
      [displayName, userId],
    );
  };
  const buyer = await query(
    "SELECT id, account_status FROM users WHERE id = ?",
    [buyerUserId],
  );
  const buyerRow = buyer?.rows?.[0];
  if (!buyerRow) {
    throw new Error(`convergeOrderIdentity: buyer ${buyerUserId} not found`);
  }

  // (a) Already a real account — nothing to converge.
  if (buyerRow.account_status !== "guest") {
    return { outcome: "existing_account", userId: buyerUserId };
  }

  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    // No usable email — leave the guest as-is; delivery falls back to whatever
    // the caller has. Promote to active so the account can later be claimed.
    await query("UPDATE users SET account_status = 'active' WHERE id = ?", [
      buyerUserId,
    ]);
    await setDisplayNameIfEmpty(buyerUserId);
    return { outcome: "no_email", userId: buyerUserId };
  }

  const repo = identityRepository;

  // (b) verified contact of another user -> merge
  const verified = await repo.findActiveUserByVerifiedContact(
    "email",
    normalized,
  );
  if (verified && verified.id && verified.id !== buyerUserId) {
    await mergeGuestIntoUser(query, {
      guestUserId: buyerUserId,
      targetUserId: verified.id,
    });
    return { outcome: "merged", userId: verified.id, mergedFrom: buyerUserId };
  }

  // (c) new email, or an unverified match -> attach unverified contact to buyer.
  // Idempotent: if the buyer already has this contact, don't duplicate it.
  const existingContact = await repo.findContactByValue(
    buyerUserId,
    "email",
    normalized,
  );
  if (!existingContact) {
    const hasEmail = await repo.findAnyContactOfType(buyerUserId, "email");
    await repo.insertContact({
      id: newUuid(),
      userId: buyerUserId,
      type: "email",
      valueNormalized: normalized,
      valueDisplay: String(email || "").trim(),
      verifiedAt: null,
      source: "stripe_checkout",
      sourceIdentityId: null,
      isPrimary: !hasEmail,
      isRelay: false,
      createdAt: nowIso(),
    });
  }
  await query("UPDATE users SET account_status = 'active' WHERE id = ?", [
    buyerUserId,
  ]);
  await setDisplayNameIfEmpty(buyerUserId);
  return { outcome: "attached", userId: buyerUserId };
}

module.exports = {
  convergeOrderIdentity,
  normalizeEmail,
  createIdentityRepository,
};
