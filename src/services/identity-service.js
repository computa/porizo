/**
 * Identity Service
 *
 * Core identity layer — ALL auth routes must go through this service for identity
 * operations. No direct writes to `user_auth_providers` or `user_contacts` from routes.
 *
 * Three-layer identity model:
 *   1. user_auth_providers — how you prove who you are (sign-in identities)
 *   2. user_contacts       — how we reach you (email, phone)
 *   3. users.*             — mirror columns (email, phone_number) synced from contacts
 *
 * Invariants:
 *   - One verified contact per (type, value_normalized) across all users
 *   - At most one primary contact per (user_id, type)
 *   - users.email and users.phone_number are READONLY mirrors — only syncUserContactMirrors writes them
 *   - Apple relay emails are tagged is_relay = true and excluded from completeness checks
 */

const { generateId } = require("../utils/ids");
const { createIdentityRepository } = require("../database/identity-repository");
const crypto = require("crypto");

function identityRepositoryFor(dbOrRepository) {
  if (dbOrRepository?.isIdentityRepository) {
    return dbOrRepository;
  }
  return createIdentityRepository(dbOrRepository);
}

// ==================== NORMALIZATION ====================

/**
 * Normalize an email address: lowercase, trim whitespace.
 */
function normalizeEmail(email) {
  return email.toLowerCase().trim();
}

/**
 * Normalize a phone number. Expects E.164 format — just trims whitespace.
 */
function normalizePhone(phone) {
  return phone.trim();
}

/**
 * Detect Apple private relay emails.
 */
function isAppleRelay(email) {
  const normalized = normalizeEmail(email);
  return (
    normalized.endsWith("@privaterelay.appleid.com") ||
    normalized.endsWith("@private.icloud.com")
  );
}

/**
 * Normalize a contact value based on type.
 */
function normalizeContactValue(type, value) {
  if (type === "email") return normalizeEmail(value);
  if (type === "phone") return normalizePhone(value);
  return value;
}

// ==================== ERROR HELPERS ====================

class IdentityError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ==================== CORE IDENTITY RESOLUTION ====================

/**
 * Look up user by auth identity. This is the ONLY way to resolve a user for sign-in.
 * @param {object} db - Database instance
 * @param {string} type - Provider type: 'apple', 'phone', 'email', 'google'
 * @param {string} subject - Provider-specific identifier (Apple sub, E.164 phone, email)
 * @returns {Promise<{ userId: string, identity: object } | null>}
 */
async function resolveUserByIdentity(db, type, subject) {
  const repository = identityRepositoryFor(db);
  const row = await repository.findActiveIdentity(type, subject);

  if (!row) return null;

  return {
    userId: row.user_id,
    identity: {
      id: row.id,
      provider: row.provider,
      subject: row.provider_user_id,
      providerData: row.provider_data,
      verifiedAt: row.verified_at,
      linkedAt: row.linked_at,
      lastUsedAt: row.last_used_at,
      status: row.status,
    },
  };
}

// ==================== USER + IDENTITY CREATION ====================

/**
 * Atomically create a user with their first auth identity and initial contacts.
 * @param {object} db - Database instance
 * @param {object} identity - { type, subject, providerData, verifiedAt }
 * @param {object} options - { contacts: [{ type, value, source, verified }], profile: { displayName, avatarUrl } }
 * @returns {Promise<{ userId: string, identityId: string }>}
 */
async function createUserWithIdentity(db, identity, options = {}) {
  const repository = identityRepositoryFor(db);
  return repository.transaction((txRepository) =>
    createUserWithIdentityInRepository(txRepository, identity, options),
  );
}

/** Create a user through an already transaction-scoped identity repository. */
async function createUserWithIdentityInRepository(repository, identity, options = {}) {
  const { contacts = [], profile = {} } = options;
  const userId = generateId("user");
  const identityId = generateId("ap");
  const now = new Date().toISOString();

  // Prepare all values before the transaction
  const contactRows = contacts.map((c) => {
    const normalized = normalizeContactValue(c.type, c.value);
    return {
      id: generateId("uc"),
      userId,
      type: c.type,
      valueNormalized: normalized,
      valueDisplay: c.value,
      verifiedAt: c.verified ? now : null,
      source: c.source || "user_entered",
      sourceIdentityId: identityId,
      isPrimary: true, // first contact of each type is primary
      isRelay: c.type === "email" && isAppleRelay(normalized),
    };
  });

  // Deduplicate contacts by type — keep only the first of each type as primary
  const seenTypes = new Set();
  for (const row of contactRows) {
    if (seenTypes.has(row.type)) {
      row.isPrimary = false;
    } else {
      seenTypes.add(row.type);
    }
  }

  await repository.insertUser({
      id: userId,
      displayName: profile.displayName || null,
      avatarUrl: profile.avatarUrl || null,
      locale: profile.locale || null,
      country: profile.country || null,
      createdAt: now,
  });

  await repository.insertAuthProvider({
      id: identityId,
      userId,
      provider: identity.type,
      providerUserId: identity.subject,
      providerDataJson: identity.providerData ? JSON.stringify(identity.providerData) : null,
      verifiedAt: identity.verifiedAt || now,
      linkedAt: now,
      lastUsedAt: now,
  });

  for (const c of contactRows) {
      await repository.insertContact({
        id: c.id,
        userId: c.userId,
        type: c.type,
        valueNormalized: c.valueNormalized,
        valueDisplay: c.valueDisplay,
        verifiedAt: c.verifiedAt,
        source: c.source,
        sourceIdentityId: c.sourceIdentityId,
        isPrimary: c.isPrimary,
        isRelay: c.isRelay,
        createdAt: now,
      });
  }

  await syncUserContactMirrors(repository, userId);

  return { userId, identityId };
}

// ==================== IDENTITY LINKING ====================

/**
 * Link a new auth method to an existing user. Checks for conflicts.
 * @param {object} db - Database instance
 * @param {string} userId - Existing user ID
 * @param {object} identity - { type, subject, providerData, verifiedAt }
 * @returns {Promise<{ identityId: string }>}
 * @throws E118_PROVIDER_ALREADY_LINKED if identity belongs to another user
 */
async function linkIdentityToUser(db, userId, identity) {
  const repository = identityRepositoryFor(db);
  const identityId = generateId("ap");
  const now = new Date().toISOString();

  try {
    await repository.transaction(async (txRepository) => {
      // Conflict check INSIDE transaction to close TOCTOU window
      await assertNoIdentityConflict(txRepository, identity.type, identity.subject, userId);

      // If linking carries a verified contact, check for contact conflicts too
      if (identity.type === "email" || identity.type === "phone") {
        if (identity.verifiedAt) {
          const normalized = normalizeContactValue(identity.type, identity.subject);
          await assertNoContactConflict(txRepository, identity.type, normalized, userId);
        }
      } else if (identity.type === "apple" && identity.providerData?.email && identity.providerData?.emailVerified) {
        const normalized = normalizeEmail(identity.providerData.email);
        await assertNoContactConflict(txRepository, "email", normalized, userId);
      }

      await txRepository.insertAuthProvider({
        id: identityId,
        userId,
        provider: identity.type,
        providerUserId: identity.subject,
        providerDataJson: identity.providerData ? JSON.stringify(identity.providerData) : null,
        verifiedAt: identity.verifiedAt || now,
        linkedAt: now,
        lastUsedAt: now,
      });

      // If the identity carries a contact (email or phone), create/update the contact
      if (identity.type === "email" || identity.type === "phone") {
        await createOrUpdateContact(txRepository, userId, {
          type: identity.type,
          value: identity.subject,
          source: "provider_sync",
          sourceIdentityId: identityId,
          verified: !!identity.verifiedAt,
        });
      } else if (identity.type === "apple" && identity.providerData?.email) {
        // Apple Sign-In shares email — create contact
        await createOrUpdateContact(txRepository, userId, {
          type: "email",
          value: identity.providerData.email,
          source: "apple_claim",
          sourceIdentityId: identityId,
          verified: !!identity.providerData.emailVerified,
        });
      }

      await syncUserContactMirrors(txRepository, userId);
    });
  } catch (err) {
    // Convert raw UNIQUE constraint violations to IdentityError for consistent caller handling
    if (err instanceof IdentityError) throw err;
    if (err.code === "23505" || err.message?.includes("UNIQUE constraint")) {
      throw new IdentityError(
        "E118_PROVIDER_ALREADY_LINKED",
        `This ${identity.type} identity is already linked to another account.`
      );
    }
    throw err;
  }

  return { identityId };
}

// ==================== CONTACT MANAGEMENT ====================

/**
 * Create or update a contact. By default creates UNVERIFIED — pass verified: true
 * to set verified_at on creation or promote an existing unverified contact.
 * Use verifyContact() for verification via token/OTP after the fact.
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 * @param {object} contact - { type, value, source, sourceIdentityId, verified? }
 * @returns {Promise<{ contactId: string, created: boolean }>}
 */
async function createOrUpdateContact(db, userId, { type, value, source, sourceIdentityId, verified = false }) {
  const repository = identityRepositoryFor(db);
  const normalized = normalizeContactValue(type, value);
  const now = new Date().toISOString();

  // Check if this user already has a contact with this normalized value
  const existing = await repository.findContactByValue(userId, type, normalized);

  if (existing) {
    // Promote to verified if newly verified and not already
    if (verified && !existing.verified_at) {
      await repository.updateContactVerificationSource({
        id: existing.id,
        source,
        sourceIdentityId: sourceIdentityId || null,
        verifiedAt: now,
      });
    } else {
      await repository.updateContactSource({
        id: existing.id,
        source,
        sourceIdentityId: sourceIdentityId || null,
      });
    }
    return { contactId: existing.id, created: false };
  }

  const contactId = generateId("uc");
  const relay = type === "email" && isAppleRelay(normalized);

  // First contact of this type becomes primary
  const existingOfType = await repository.findAnyContactOfType(userId, type);

  await repository.insertContact({
    id: contactId,
    userId,
    type,
    valueNormalized: normalized,
    valueDisplay: value,
    verifiedAt: verified ? now : null,
    source,
    sourceIdentityId: sourceIdentityId || null,
    isPrimary: !existingOfType,
    isRelay: relay,
    createdAt: now,
  });

  return { contactId, created: true };
}

/**
 * Mark a contact as verified. Enforces uniqueness constraint.
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} type - 'email' or 'phone'
 * @param {string} valueNormalized - Normalized contact value
 * @param {string} source - Verification source
 * @throws E119_EMAIL_CONFLICT if value already verified by another user
 */
async function verifyContact(db, userId, type, valueNormalized, source) {
  const repository = identityRepositoryFor(db);
  const normalized = normalizeContactValue(type, valueNormalized);

  // Check uniqueness: is this value already verified by another user?
  await assertNoContactConflict(repository, type, normalized, userId);

  const now = new Date().toISOString();

  const result = await repository.verifyExistingUnverifiedContact({
    userId,
    type,
    valueNormalized: normalized,
    verifiedAt: now,
    source,
  });

  if (result.changes === 0) {
    // Either doesn't exist or already verified — createOrUpdateContact handles both:
    // - Missing contact: creates as verified
    // - Already verified: updates source only (idempotent)
    await createOrUpdateContact(repository, userId, {
      type, value: valueNormalized, source, verified: true,
    });
  }

  // Sync mirrors after verification changes
  await syncUserContactMirrors(repository, userId);
}

/**
 * Make a magic-link-verified email both a contact and a login credential.
 * The caller must provide a transaction-scoped identity repository.
 */
async function linkVerifiedMagicEmail(repository, userId, email) {
  const normalized = normalizeEmail(email);
  const existing = await repository.findActiveIdentity("email", normalized);
  if (existing && existing.user_id !== userId) {
    throw new IdentityError(
      "E118_PROVIDER_ALREADY_LINKED",
      "This email is already linked to another account.",
      409,
    );
  }
  if (!existing) {
    const now = new Date().toISOString();
    await repository.insertAuthProvider({
      id: generateId("ap"),
      userId,
      provider: "email",
      providerUserId: normalized,
      verifiedAt: now,
      linkedAt: now,
      lastUsedAt: now,
    });
  }
  await verifyContact(repository, userId, "email", normalized, "magic_link");
}

/**
 * Set a contact as primary for its type. Unsets previous primary.
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} contactId - Contact ID to promote
 */
async function setPrimaryContact(db, userId, contactId) {
  const repository = identityRepositoryFor(db);

  await repository.transaction(async (txRepository) => {
    // Look up the contact to get its type
    const contact = await txRepository.getContactTypeForUser(contactId, userId);

    if (!contact) {
      throw new IdentityError("E120_CONTACT_NOT_FOUND", "Contact not found.", 404);
    }

    // Unset previous primary for this type
    await txRepository.clearPrimaryContactForType(userId, contact.type);

    // Set new primary
    await txRepository.setPrimaryContact(contactId);

    // Sync mirrors
    await syncUserContactMirrors(txRepository, userId);
  });
}

// ==================== PROFILE COMPLETENESS ====================

/**
 * Compute profile completeness based on policy version.
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} policyVersion - Policy version (default: 'v1')
 * @returns {Promise<{ complete: boolean, missing: string[] }>}
 *
 * Policy v1: a verified, non-relay email is the sole launch gate. Phone and
 * display name remain optional profile fields.
 */
async function computeProfileCompleteness(db, userId, policyVersion = "v1") {
  const repository = identityRepositoryFor(db);
  const missing = [];

  if (policyVersion === "v1") {
    const verifiedEmail = await repository.findVerifiedNonRelayEmail(userId);
    if (!verifiedEmail) {
      missing.push("verified_email");
    }

    return { complete: missing.length === 0, missing };
  }

  return { complete: missing.length === 0, missing };
}

// ==================== MIRROR SYNC ====================

/**
 * Rebuild users.email, email_verified, and users.phone_number from user_contacts.
 * This is the ONLY way these fields should be updated.
 * Safe to call inside or outside a transaction — writes go through the transaction's client.
 * @param {object} db - Database instance
 * @param {string} userId - User ID
 */
async function syncUserContactMirrors(db, userId) {
  const repository = identityRepositoryFor(db);
  // Find primary verified email (prefer non-relay, fall back to relay)
  const primaryEmail = await repository.findPrimaryVerifiedEmail(userId);

  // Find primary verified phone
  const primaryPhone = await repository.findPrimaryVerifiedPhone(userId);

  // email_verified mirrors whether a verified email contact exists (for backward compat)
  const emailVerified = primaryEmail ? 1 : 0;

  await repository.updateUserContactMirrors({
    userId,
    email: primaryEmail?.value_normalized || null,
    emailVerified,
    phoneNumber: primaryPhone?.value_normalized || null,
  });
}

// ==================== IDENTITY TELEMETRY ====================

/**
 * Update last_used_at on an auth identity. Called on sign-in AND token refresh.
 * @param {object} db - Database instance
 * @param {string} identityId - Auth provider identity ID
 */
async function recordIdentityUsage(db, identityId) {
  const repository = identityRepositoryFor(db);
  if (!identityId) {
    console.error("[IdentityService] recordIdentityUsage called with null identityId");
    return;
  }
  const now = new Date().toISOString();
  const result = await repository.updateIdentityLastUsed(identityId, now);
  if (result.changes === 0) {
    console.warn(`[IdentityService] recordIdentityUsage: identity ${identityId} not found`);
  }
}

// ==================== CONFLICT ASSERTIONS ====================

/**
 * Assert no identity conflict exists. Throws if provider+subject already linked to another user.
 * @param {object} db - Database instance
 * @param {string} type - Provider type
 * @param {string} subject - Provider-specific identifier
 * @param {string|null} excludeUserId - User ID to exclude from conflict check (self)
 */
async function assertNoIdentityConflict(db, type, subject, excludeUserId = null) {
  const repository = identityRepositoryFor(db);
  const row = await repository.findIdentityConflict(type, subject, excludeUserId);

  if (row) {
    throw new IdentityError(
      "E118_PROVIDER_ALREADY_LINKED",
      `This ${type} identity is already linked to another account.`
    );
  }
}

/**
 * Assert no contact conflict exists. Throws if verified contact belongs to another user.
 * @param {object} db - Database instance
 * @param {string} type - 'email' or 'phone'
 * @param {string} valueNormalized - Normalized contact value
 * @param {string|null} excludeUserId - User ID to exclude from conflict check (self)
 */
async function assertNoContactConflict(db, type, valueNormalized, excludeUserId = null) {
  const repository = identityRepositoryFor(db);
  const row = await repository.findVerifiedContactConflict(type, valueNormalized, excludeUserId);

  if (row) {
    const errorCode = type === "phone" ? "E119_PHONE_CONFLICT" : "E119_EMAIL_CONFLICT";
    throw new IdentityError(
      errorCode,
      `This ${type} is already verified by another account.`
    );
  }
}

// ==================== EXPORTS ====================


// ==================== IDENTITY TOMBSTONE HASHING ====================
// Fixed fallback salt for test/dev ONLY. Never used in production — see identityHashSalt().
const DEV_IDENTITY_HASH_SALT = "porizo-dev-identity-salt-do-not-use-in-prod";

// Resolve the identity-hash salt. One-way commitment: rotating it orphans every
// existing tombstone, so it must be stable per environment. Production requires a
// real salt (throw if missing); test/dev falls back to a fixed salt and warns.
function identityHashSalt() {
  const salt = process.env.IDENTITY_HASH_SALT;
  if (salt) {
    return salt;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CRITICAL: IDENTITY_HASH_SALT environment variable is not set. " +
        "Required to compute the Sybil identity tombstone hash.",
    );
  }
  console.warn(
    "[identity-service] IDENTITY_HASH_SALT not set — using insecure dev fallback. Set it in production.",
  );
  return DEV_IDENTITY_HASH_SALT;
}

// Salted one-way identity hash for the Sybil tombstone: sha256(provider:subject:salt).
// Never logs or returns the raw subject.
function identityHash(provider, subject) {
  const salt = identityHashSalt();
  return crypto
    .createHash("sha256")
    .update(`${provider}:${subject}:${salt}`)
    .digest("hex");
}

module.exports = {
  identityHash,
  // Core resolution
  resolveUserByIdentity,

  // User + identity creation
  createUserWithIdentity,
  createUserWithIdentityInRepository,

  // Identity linking
  linkIdentityToUser,

  // Contact management
  createOrUpdateContact,
  verifyContact,
  linkVerifiedMagicEmail,
  setPrimaryContact,

  // Profile completeness
  computeProfileCompleteness,

  // Mirror sync
  syncUserContactMirrors,

  // Telemetry
  recordIdentityUsage,

  // Conflict assertions
  assertNoIdentityConflict,
  assertNoContactConflict,

  // Normalization utilities (exported for routes that need pre-validation)
  normalizeEmail,
  normalizePhone,
  normalizeContactValue,
  isAppleRelay,

  // Error class (for instanceof checks in route error handlers)
  IdentityError,
};
