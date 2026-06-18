/**
 * Admin Authentication Service
 *
 * Handles admin email/password authentication, session management,
 * and account lockout for the admin dashboard.
 */

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { generateId } = require("../utils/ids");

const MAX_SESSION_DURATION_HOURS = 24;
const DEFAULT_SESSION_DURATION_HOURS = MAX_SESSION_DURATION_HOURS;

function getSessionDurationMs() {
  const rawHours = process.env.ADMIN_SESSION_DURATION_HOURS;
  const parsedHours =
    rawHours === undefined ? DEFAULT_SESSION_DURATION_HOURS : Number(rawHours);
  const durationHours = Number.isFinite(parsedHours)
    ? Math.min(Math.max(parsedHours, 1), MAX_SESSION_DURATION_HOURS)
    : DEFAULT_SESSION_DURATION_HOURS;

  return durationHours * 60 * 60 * 1000;
}

// Configuration
const config = {
  bcryptCost: 12,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
};

// Database instance (initialized via initialize())
let db = null;

/**
 * Initialize the admin auth service with database instance
 */
function initialize(database) {
  db = database;
}

// ==================== TOKEN UTILITIES ====================

/**
 * Generate a cryptographically secure random token (32 bytes = 256 bits)
 */
function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash a token using SHA-256 for storage
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const DEFAULT_SEEDED_ADMIN_ID = "adm_initial";
const DEFAULT_SEEDED_ADMIN_EMAIL = "admin@porizo.app";
const DEFAULT_SEEDED_ADMIN_PASSWORD = "admin123";

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production";
}

function allowDefaultAdminLoginInProduction() {
  return process.env.ALLOW_DEFAULT_ADMIN_LOGIN_IN_PRODUCTION === "true";
}

function isDefaultSeededAdmin(admin) {
  if (!admin) return false;
  return (
    admin.id === DEFAULT_SEEDED_ADMIN_ID &&
    admin.email?.toLowerCase() === DEFAULT_SEEDED_ADMIN_EMAIL
  );
}

function shouldBlockDefaultSeededAdminLogin(admin, password) {
  return (
    isProductionEnvironment() &&
    !allowDefaultAdminLoginInProduction() &&
    isDefaultSeededAdmin(admin) &&
    password === DEFAULT_SEEDED_ADMIN_PASSWORD
  );
}

// ==================== ADMIN AUTHENTICATION ====================

/**
 * Login with email and password
 * Returns session token on success, error on failure
 */
async function login(email, password, ip, userAgent) {
  if (!db) throw new Error("AdminAuthService not initialized");

  // Single generic failure response for EVERY failure mode (unknown email,
  // locked account, wrong password, disabled default-seeded admin). Returning
  // identical {success:false, error:"Invalid credentials"} for all cases keeps
  // this endpoint from being an account-enumeration / lockout-state oracle.
  // Lockout state is still tracked server-side; the real reason is logged, not
  // returned to the client.
  const GENERIC_FAILURE = { success: false, error: "Invalid credentials" };

  const admin = await db
    .prepare("SELECT * FROM admin_users WHERE email = ?")
    .get(email.toLowerCase());

  if (!admin) {
    console.warn("[Admin:login] failed — unknown email");
    return GENERIC_FAILURE;
  }

  // Honor an active lockout server-side, but do not reveal it to the client.
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    console.warn(
      `[Admin:login] failed — account locked adminId=${admin.id} until=${admin.locked_until}`,
    );
    return GENERIC_FAILURE;
  }

  // Verify password
  const valid = await bcrypt.compare(password, admin.password_hash);

  if (!valid) {
    // Increment failed count and set lockout when threshold reached. Kept
    // server-side; the response stays generic regardless of remaining attempts.
    const newCount = (admin.failed_login_count || 0) + 1;
    const lockUntil =
      newCount >= config.maxFailedLoginAttempts
        ? new Date(
            Date.now() + config.lockoutDurationMinutes * 60 * 1000,
          ).toISOString()
        : null;

    await db
      .prepare(
        "UPDATE admin_users SET failed_login_count = ?, locked_until = ? WHERE id = ?",
      )
      .run(newCount, lockUntil, admin.id);

    if (lockUntil) {
      console.warn(
        `[Admin:login] failed — wrong password, account now locked adminId=${admin.id} until=${lockUntil}`,
      );
    } else {
      console.warn(
        `[Admin:login] failed — wrong password adminId=${admin.id} failedCount=${newCount}`,
      );
    }
    return GENERIC_FAILURE;
  }

  if (shouldBlockDefaultSeededAdminLogin(admin, password)) {
    console.warn(
      `[Admin:login] failed — default seeded admin credentials disabled in production adminId=${admin.id}`,
    );
    return GENERIC_FAILURE;
  }

  // Reset failed count, update last login
  await db
    .prepare(
      "UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
    )
    .run(new Date().toISOString(), admin.id);

  // Create session
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const sessionId = generateId("admsess");
  const expiresAt = new Date(Date.now() + getSessionDurationMs()).toISOString();

  await db
    .prepare(
      `
    INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, created_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      sessionId,
      admin.id,
      tokenHash,
      expiresAt,
      new Date().toISOString(),
      ip || null,
      userAgent || null,
    );

  return {
    success: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
    },
    expiresAt,
  };
}

/**
 * Validate session token
 * Returns admin info if valid, null if invalid/expired
 */
async function validateSession(token) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db
    .prepare(
      `
    SELECT s.*, a.email, a.display_name, a.role
    FROM admin_sessions s
    JOIN admin_users a ON s.admin_id = a.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `,
    )
    .get(tokenHash, new Date().toISOString());

  if (!session) return null;

  return {
    adminId: session.admin_id,
    email: session.email,
    displayName: session.display_name,
    role: session.role,
  };
}

/**
 * Logout (delete session)
 */
async function logout(token) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (!token) return { success: false };

  const tokenHash = hashToken(token);
  await db
    .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
    .run(tokenHash);
  return { success: true };
}

/**
 * Get current admin info from token
 */
function getAdminInfo(token) {
  return validateSession(token);
}

const ALLOWED_ADMIN_ROLES = new Set(["viewer", "admin", "superadmin"]);

/**
 * Create a new admin (superadmin only)
 */
async function createAdmin(email, password, displayName, role = "admin") {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (!ALLOWED_ADMIN_ROLES.has(role)) {
    return { success: false, error: "Invalid admin role" };
  }

  const hash = await bcrypt.hash(password, config.bcryptCost);
  const id = generateId("adm");

  try {
    await db
      .prepare(
        `
      INSERT INTO admin_users (id, email, password_hash, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        email.toLowerCase(),
        hash,
        displayName,
        role,
        new Date().toISOString(),
      );
    return { success: true, id };
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return { success: false, error: "Email already exists" };
    }
    throw err;
  }
}

/**
 * Change password (invalidates all sessions)
 */
async function changePassword(adminId, newPassword) {
  if (!db) throw new Error("AdminAuthService not initialized");

  const hash = await bcrypt.hash(newPassword, config.bcryptCost);
  await db
    .prepare(
      "UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?",
    )
    .run(hash, new Date().toISOString(), adminId);

  // Invalidate all sessions for this admin
  await db
    .prepare("DELETE FROM admin_sessions WHERE admin_id = ?")
    .run(adminId);
  return { success: true };
}

/**
 * List all admins (for superadmin)
 */
async function listAdmins() {
  if (!db) throw new Error("AdminAuthService not initialized");

  return await db
    .prepare(
      `
    SELECT id, email, display_name, role, created_at, last_login_at
    FROM admin_users
    ORDER BY created_at DESC
  `,
    )
    .all();
}

/**
 * Cleanup expired sessions (run periodically)
 */
async function cleanupExpiredSessions() {
  if (!db) return;

  const result = await db
    .prepare("DELETE FROM admin_sessions WHERE expires_at < ?")
    .run(new Date().toISOString());
  return result.changes;
}

// ==================== PASSWORD RESET ====================

// Reset tokens are short-lived: 30 minutes between request and use. Long
// enough for an admin to find the email, short enough that a leaked token
// is unlikely to outlive the leak.
const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Look up an admin by their (lowercased) email.
 *
 * Returns null when not found; callers must still respond with a generic
 * "if an account exists..." message to avoid account enumeration.
 */
async function findAdminByEmail(email) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof email !== "string" || email.length === 0) return null;

  const normalized = email.toLowerCase().trim();
  return await db
    .prepare("SELECT * FROM admin_users WHERE email = ?")
    .get(normalized);
}

/**
 * Look up an admin by id (used after a successful reset to send the
 * security-alert email).
 */
async function findAdminById(adminId) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof adminId !== "string" || adminId.length === 0) return null;

  return await db
    .prepare("SELECT * FROM admin_users WHERE id = ?")
    .get(adminId);
}

/**
 * Mint a password-reset token for an admin.
 *
 * Returns `{ token, expiresAt }`. The raw `token` is the value that goes in
 * the reset email — we never persist it. Only the SHA-256 hash is stored,
 * so a DB compromise alone cannot forge resets.
 *
 * @param {string} adminId
 * @param {{ ipAddress?: string|null }} [options]
 */
async function createPasswordResetToken(adminId, options = {}) {
  if (!db) throw new Error("AdminAuthService not initialized");

  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + PASSWORD_RESET_TOKEN_TTL_MS).toISOString();
  const id = generateId("apt"); // admin password token

  await db
    .prepare(
      `INSERT INTO admin_password_reset_tokens
       (id, admin_id, token_hash, expires_at, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      adminId,
      tokenHash,
      expiresAt,
      options.ipAddress || null,
      new Date(now).toISOString(),
    );

  return { token, expiresAt, tokenId: id };
}

/**
 * Verify a raw reset token and resolve it to its admin.
 *
 * Throws on any failure mode (no match, expired, already used) so the
 * caller can return a single generic "invalid or expired link" response
 * without leaking which mode applied.
 */
async function verifyPasswordResetToken(rawToken) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    throw new Error("INVALID_TOKEN");
  }

  const tokenHash = hashToken(rawToken);
  const row = await db
    .prepare(
      `SELECT id, admin_id, expires_at, used_at
       FROM admin_password_reset_tokens
       WHERE token_hash = ?`,
    )
    .get(tokenHash);

  if (!row) throw new Error("INVALID_TOKEN");
  if (row.used_at) throw new Error("INVALID_TOKEN");
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error("INVALID_TOKEN");
  }

  return { adminId: row.admin_id, tokenId: row.id };
}

/**
 * Mark a single reset token as used.
 */
async function markPasswordResetTokenUsed(tokenId) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof tokenId !== "string" || tokenId.length === 0) return;

  await db
    .prepare("UPDATE admin_password_reset_tokens SET used_at = ? WHERE id = ?")
    .run(new Date().toISOString(), tokenId);
}

/**
 * Invalidate every unused reset token belonging to an admin.
 *
 * Called after a successful reset so any other still-valid tokens that
 * leaked alongside the one we just consumed can't be used to re-reset
 * the password.
 */
async function invalidateAllPasswordResetTokens(adminId) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof adminId !== "string" || adminId.length === 0) return;

  await db
    .prepare(
      `UPDATE admin_password_reset_tokens
       SET used_at = ?
       WHERE admin_id = ? AND used_at IS NULL`,
    )
    .run(new Date().toISOString(), adminId);
}

/**
 * Clear failed-login counter and any active lockout.
 *
 * Used after a successful password reset so an admin who was locked out
 * (e.g., a brute-force attempt that triggered the threshold) can sign back
 * in immediately with their new password. Without this, a successful
 * reset would still leave them locked.
 */
async function clearLockout(adminId) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (typeof adminId !== "string" || adminId.length === 0) return;

  await db
    .prepare(
      `UPDATE admin_users
       SET failed_login_count = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), adminId);
}

module.exports = {
  initialize,
  login,
  validateSession,
  logout,
  getAdminInfo,
  createAdmin,
  changePassword,
  listAdmins,
  cleanupExpiredSessions,
  // Password reset
  findAdminByEmail,
  findAdminById,
  createPasswordResetToken,
  verifyPasswordResetToken,
  markPasswordResetTokenUsed,
  invalidateAllPasswordResetTokens,
  clearLockout,
};
