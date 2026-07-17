"use strict";

const { mergeGuestIntoUser } = require("./guest-merge");

/**
 * Reclaim guest-owned paid web orders at magic-link login time.
 *
 * The paid-transition convergence (`convergeOrderIdentity`) only re-owns a guest
 * order when the Stripe checkout email already matched a VERIFIED account. A
 * first-time buyer's email is new, so their paid order stays owned by the
 * (promoted) guest user. When that buyer later signs in with the checkout
 * email, the login may adopt a DIFFERENT account (or a fresh one), leaving the
 * paid order stranded behind `GET /web/orders`'s ownership check — the user is
 * signed in but the song is invisible.
 *
 * This closes that gap: at login, any guest-owned order whose checkout email
 * equals the just-verified login email is merged into the logging-in account,
 * so ownership catches up with the identity the buyer proved control of.
 *
 * Owner guardrail (why not `account_status = 'guest'`): the paid-transition
 * convergence PROMOTES the buyer guest to `account_status='active'` even when it
 * stays a shell (branch "no_email" and branch (c) both flip it — web-order-
 * identity.js:60,104). So the reclaimable owner is not identified by status but
 * by being a merge-safe SHELL: it has no active auth provider except possibly an
 * email factor for the very email being logged in. This mirrors the login
 * `isSafeEmailShell` rule (auth.js) and guarantees we never merge away a real
 * account that has its own login factor.
 *
 * Security invariants:
 *   - Match is on the EXACT normalized email that this login verified. A login
 *     never reaches an order whose checkout email differs (the ownership 404
 *     stays intact for everyone else).
 *   - Only merge-safe shell owners are reclaimed — a real account with any other
 *     auth factor is skipped (no account takeover, no data loss).
 *   - Only paid-or-later orders (a real purchase). A `pending`/`abandoned` order
 *     carries no delivered value and is left alone.
 *   - Never merges the login user into itself.
 *   - Idempotent: re-login finds nothing to move (the order already belongs to
 *     the login user).
 *
 * Runs inside the caller's login transaction via `query`; composes with the
 * session/entitlement writes. Never opens its own transaction.
 *
 * @param {Function} query - transactional (sql, params) => { rows }
 * @param {Object} args
 * @param {string} args.loginUserId - the account this login resolved to
 * @param {string} args.emailNormalized - the email this login verified (lowercased/trimmed)
 * @param {Object} args.identityRepository - transaction-scoped identity repository
 *   (needs listActiveAuthProvidersForUser)
 * @returns {Promise<{ reclaimed: number, guestUserIds: string[] }>}
 */
const RECLAIMABLE_STATUSES = [
  "paid",
  "rendering",
  "delivered",
  "failed",
  "refunded",
];

async function isMergeSafeShell(identityRepository, userId, email) {
  const providers =
    await identityRepository.listActiveAuthProvidersForUser(userId);
  // A shell has zero auth factors, or only the email factor for THIS email.
  return providers.every(
    (row) => row.provider === "email" && row.provider_user_id === email,
  );
}

async function reclaimGuestOrdersOnLogin(
  query,
  { loginUserId, emailNormalized, identityRepository },
) {
  const email = String(emailNormalized || "")
    .trim()
    .toLowerCase();
  if (!loginUserId || !email || !identityRepository) {
    return { reclaimed: 0, guestUserIds: [] };
  }

  // Distinct owners of a paid-or-later order placed with this exact email,
  // excluding the login user itself.
  const placeholders = RECLAIMABLE_STATUSES.map(() => "?").join(", ");
  const result = await query(
    `SELECT DISTINCT o.user_id AS owner_id
       FROM web_orders o
       JOIN users u ON u.id = o.user_id
      WHERE LOWER(o.email) = ?
        AND o.status IN (${placeholders})
        AND o.user_id <> ?
        AND u.deleted_at IS NULL`,
    [email, ...RECLAIMABLE_STATUSES, loginUserId],
  );

  const candidateOwnerIds = (result?.rows || [])
    .map((row) => row.owner_id)
    .filter(Boolean);

  const guestUserIds = [];
  for (const ownerId of candidateOwnerIds) {
    // Only reclaim merge-safe shells — never a real account with its own factor.
    if (await isMergeSafeShell(identityRepository, ownerId, email)) {
      await mergeGuestIntoUser(query, {
        guestUserId: ownerId,
        targetUserId: loginUserId,
      });
      guestUserIds.push(ownerId);
    }
  }

  return { reclaimed: guestUserIds.length, guestUserIds };
}

module.exports = {
  reclaimGuestOrdersOnLogin,
  RECLAIMABLE_STATUSES,
};
