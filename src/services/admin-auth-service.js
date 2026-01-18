/**
 * Admin Authentication Service
 *
 * Handles admin email/password authentication, session management,
 * and account lockout for the admin dashboard.
 */

const bcrypt = require("bcrypt");
const crypto = require("crypto");

// Configuration
const config = {
  bcryptCost: 12,
  sessionDurationMs: 8 * 60 * 60 * 1000, // 8 hours
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

/**
 * Generate unique ID with prefix
 */
function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

// ==================== ADMIN AUTHENTICATION ====================

/**
 * Login with email and password
 * Returns session token on success, error on failure
 */
async function login(email, password, ip, userAgent) {
  if (!db) throw new Error("AdminAuthService not initialized");

  const admin = db
    .prepare("SELECT * FROM admin_users WHERE email = ?")
    .get(email.toLowerCase());

  if (!admin) {
    return { success: false, error: "Invalid credentials" };
  }

  // Check if account is locked
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const remainingMs = new Date(admin.locked_until) - new Date();
    const remainingMins = Math.ceil(remainingMs / 60000);
    return {
      success: false,
      error: `Account locked. Try again in ${remainingMins} minutes.`,
    };
  }

  // Verify password
  const valid = await bcrypt.compare(password, admin.password_hash);

  if (!valid) {
    // Increment failed count
    const newCount = (admin.failed_login_count || 0) + 1;
    const lockUntil =
      newCount >= config.maxFailedLoginAttempts
        ? new Date(
            Date.now() + config.lockoutDurationMinutes * 60 * 1000
          ).toISOString()
        : null;

    db.prepare(
      "UPDATE admin_users SET failed_login_count = ?, locked_until = ? WHERE id = ?"
    ).run(newCount, lockUntil, admin.id);

    const attemptsRemaining = config.maxFailedLoginAttempts - newCount;
    if (attemptsRemaining > 0) {
      return {
        success: false,
        error: `Invalid credentials. ${attemptsRemaining} attempts remaining.`,
      };
    }
    return {
      success: false,
      error: `Account locked for ${config.lockoutDurationMinutes} minutes.`,
    };
  }

  // Reset failed count, update last login
  db.prepare(
    "UPDATE admin_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), admin.id);

  // Create session
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const sessionId = generateId("admsess");
  const expiresAt = new Date(
    Date.now() + config.sessionDurationMs
  ).toISOString();

  db.prepare(`
    INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, created_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    admin.id,
    tokenHash,
    expiresAt,
    new Date().toISOString(),
    ip || null,
    userAgent || null
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
function validateSession(token) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = db
    .prepare(
      `
    SELECT s.*, a.email, a.display_name, a.role
    FROM admin_sessions s
    JOIN admin_users a ON s.admin_id = a.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `
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
function logout(token) {
  if (!db) throw new Error("AdminAuthService not initialized");
  if (!token) return { success: false };

  const tokenHash = hashToken(token);
  db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
  return { success: true };
}

/**
 * Get current admin info from token
 */
function getAdminInfo(token) {
  return validateSession(token);
}

/**
 * Create a new admin (superadmin only)
 */
async function createAdmin(email, password, displayName, role = "admin") {
  if (!db) throw new Error("AdminAuthService not initialized");

  const hash = await bcrypt.hash(password, config.bcryptCost);
  const id = generateId("adm");

  try {
    db.prepare(
      `
      INSERT INTO admin_users (id, email, password_hash, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(id, email.toLowerCase(), hash, displayName, role, new Date().toISOString());
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
  db.prepare(
    "UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?"
  ).run(hash, new Date().toISOString(), adminId);

  // Invalidate all sessions for this admin
  db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(adminId);
  return { success: true };
}

/**
 * List all admins (for superadmin)
 */
function listAdmins() {
  if (!db) throw new Error("AdminAuthService not initialized");

  return db
    .prepare(
      `
    SELECT id, email, display_name, role, created_at, last_login_at
    FROM admin_users
    ORDER BY created_at DESC
  `
    )
    .all();
}

/**
 * Cleanup expired sessions (run periodically)
 */
function cleanupExpiredSessions() {
  if (!db) return;

  const result = db
    .prepare("DELETE FROM admin_sessions WHERE expires_at < ?")
    .run(new Date().toISOString());
  return result.changes;
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
};
