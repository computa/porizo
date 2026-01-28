/**
 * SMS Service
 *
 * Phone verification via Twilio SMS.
 * Handles sending verification codes and verifying them with rate limiting and security controls.
 */

const crypto = require("crypto");
const { smsLogger } = require("../utils/logger");

// Configuration
const config = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_PHONE_NUMBER,
  codeExpirationMinutes: 10,
  maxCodesPerHour: 5,
  maxVerificationAttempts: 5,
  appName: "Porizo",
};

// Twilio client (lazy-initialized)
let twilioClient = null;

// Database instance (initialized via initialize())
let db = null;

/**
 * Initialize the SMS service with database instance
 * @param {object} database - Database connection
 */
function initialize(database) {
  db = database;
}

/**
 * Get Twilio client (lazy initialization)
 */
function getClient() {
  if (!twilioClient) {
    if (!config.accountSid || !config.authToken) {
      throw new Error(
        "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required"
      );
    }
    if (!config.fromNumber) {
      throw new Error("TWILIO_PHONE_NUMBER environment variable is required");
    }
    const twilio = require("twilio");
    twilioClient = twilio(config.accountSid, config.authToken);
  }
  return twilioClient;
}

/**
 * Check if SMS service is configured
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(config.accountSid && config.authToken && config.fromNumber);
}

/**
 * Generate a cryptographically secure 6-digit code
 * @returns {string} 6-digit code
 */
function generateVerificationCode() {
  // Generate a random number between 0 and 999999, then pad to 6 digits
  const randomBytes = crypto.randomBytes(4);
  const randomInt = randomBytes.readUInt32BE(0);
  const code = (randomInt % 1000000).toString().padStart(6, "0");
  return code;
}

/**
 * Generate unique ID with prefix
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Mask a phone number for display (e.g., +1***...***1234)
 * @param {string} phoneNumber - Full phone number
 * @returns {string} Masked phone number
 */
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || phoneNumber.length < 8) {
    return "***";
  }
  const countryCode = phoneNumber.slice(0, 2);
  const lastFour = phoneNumber.slice(-4);
  return `${countryCode}***...***${lastFour}`;
}

/**
 * Normalize phone number to E.164 format
 * @param {string} phoneNumber
 * @returns {string}
 */
function normalizePhoneNumber(phoneNumber) {
  // Remove all non-digit characters except leading +
  let normalized = phoneNumber.replace(/[^\d+]/g, "");
  // Ensure it starts with +
  if (!normalized.startsWith("+")) {
    normalized = "+" + normalized;
  }
  return normalized;
}

/**
 * Check rate limit for sending verification codes
 * @param {string} phoneNumber - Normalized phone number
 * @returns {Promise<{allowed: boolean, retryAfterSeconds?: number}>}
 */
async function checkRateLimit(phoneNumber) {
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM phone_verifications
       WHERE phone_number = ? AND created_at > ?`
    )
    .get(phoneNumber, oneHourAgo.toISOString());

  const count = result?.count || 0;

  if (count >= config.maxCodesPerHour) {
    // Find the oldest code in the window to calculate retry time
    const oldest = await db
      .prepare(
        `SELECT created_at FROM phone_verifications
         WHERE phone_number = ? AND created_at > ?
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(phoneNumber, oneHourAgo.toISOString());

    if (oldest) {
      const oldestTime = new Date(oldest.created_at);
      const retryAfterMs = oldestTime.getTime() + 60 * 60 * 1000 - Date.now();
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }
    return { allowed: false, retryAfterSeconds: 60 };
  }

  return { allowed: true };
}

/**
 * Send a verification code to a phone number
 * @param {string} phoneNumber - Phone number in E.164 format (e.g., +12025551234)
 * @returns {Promise<{success: boolean, expiresAt?: string, maskedPhone?: string, error?: string, retryAfterSeconds?: number}>}
 */
async function sendVerificationCode(phoneNumber) {
  if (!db) {
    throw new Error("SMS service not initialized. Call initialize(db) first.");
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  // Check rate limit
  const rateCheck = await checkRateLimit(normalizedPhone);
  if (!rateCheck.allowed) {
    smsLogger.warn(
      { phone: maskPhoneNumber(normalizedPhone) },
      "Rate limit exceeded for verification code"
    );
    return {
      success: false,
      error: "Too many verification attempts. Please try again later.",
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    };
  }

  // Invalidate any existing unused codes for this phone
  await db
    .prepare(
      `UPDATE phone_verifications
       SET used_at = CURRENT_TIMESTAMP
       WHERE phone_number = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`
    )
    .run(normalizedPhone);

  // Generate new code
  const code = generateVerificationCode();
  const verificationId = generateId("pv");
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + config.codeExpirationMinutes);

  // Store verification record
  await db
    .prepare(
      `INSERT INTO phone_verifications (id, phone_number, code_hash, expires_at, attempts)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(
      verificationId,
      normalizedPhone,
      hashCode(code),
      expiresAt.toISOString()
    );

  // Send SMS via Twilio
  try {
    await getClient().messages.create({
      body: `Your ${config.appName} verification code is: ${code}. It expires in ${config.codeExpirationMinutes} minutes.`,
      from: config.fromNumber,
      to: normalizedPhone,
    });

    smsLogger.info(
      { phone: maskPhoneNumber(normalizedPhone), verificationId },
      "Verification code sent"
    );

    return {
      success: true,
      expiresAt: expiresAt.toISOString(),
      maskedPhone: maskPhoneNumber(normalizedPhone),
    };
  } catch (error) {
    // Handle Twilio-specific errors
    smsLogger.error(
      {
        phone: maskPhoneNumber(normalizedPhone),
        error: error.message,
        twilioCode: error.code,
      },
      "Failed to send verification SMS"
    );

    // Map common Twilio errors to user-friendly messages
    let userMessage = "Failed to send verification code. Please try again.";

    if (error.code === 21211) {
      userMessage = "Invalid phone number format.";
    } else if (error.code === 21614) {
      userMessage = "This phone number cannot receive SMS messages.";
    } else if (error.code === 21408) {
      userMessage = "This region is not supported for SMS verification.";
    } else if (error.code === 21610) {
      userMessage = "This phone number has opted out of SMS messages.";
    }

    return {
      success: false,
      error: userMessage,
    };
  }
}

/**
 * Hash verification code using SHA-256
 * @param {string} code - 6-digit code
 * @returns {string} Hashed code
 */
function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Verify a code for a phone number
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {string} code - 6-digit code to verify
 * @returns {Promise<{success: boolean, verified: boolean, remainingAttempts?: number, error?: string}>}
 */
async function verifyCode(phoneNumber, code) {
  if (!db) {
    throw new Error("SMS service not initialized. Call initialize(db) first.");
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const codeHash = hashCode(code);

  // Find active verification record for this phone
  const verification = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM phone_verifications
       WHERE phone_number = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(normalizedPhone);

  if (!verification) {
    smsLogger.warn(
      { phone: maskPhoneNumber(normalizedPhone) },
      "Verification attempt with no active code"
    );
    return {
      success: true,
      verified: false,
      error: "No active verification code. Please request a new code.",
    };
  }

  // Check if max attempts exceeded
  if (verification.attempts >= config.maxVerificationAttempts) {
    smsLogger.warn(
      { phone: maskPhoneNumber(normalizedPhone), verificationId: verification.id },
      "Max verification attempts exceeded"
    );
    // Mark as used to prevent further attempts
    await db
      .prepare("UPDATE phone_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(verification.id);

    return {
      success: true,
      verified: false,
      remainingAttempts: 0,
      error: "Too many failed attempts. Please request a new code.",
    };
  }

  // Increment attempt counter
  await db
    .prepare("UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?")
    .run(verification.id);

  // Check code using constant-time comparison
  const isValid = crypto.timingSafeEqual(
    Buffer.from(codeHash),
    Buffer.from(verification.code_hash)
  );

  if (isValid) {
    // Mark as used
    await db
      .prepare("UPDATE phone_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(verification.id);

    smsLogger.info(
      { phone: maskPhoneNumber(normalizedPhone), verificationId: verification.id },
      "Verification code verified successfully"
    );

    return {
      success: true,
      verified: true,
    };
  }

  const remainingAttempts =
    config.maxVerificationAttempts - verification.attempts - 1;

  smsLogger.warn(
    {
      phone: maskPhoneNumber(normalizedPhone),
      verificationId: verification.id,
      remainingAttempts,
    },
    "Verification code mismatch"
  );

  return {
    success: true,
    verified: false,
    remainingAttempts,
  };
}

/**
 * Get remaining verification attempts for a phone number
 * @param {string} phoneNumber - Phone number in E.164 format
 * @returns {Promise<{success: boolean, remainingAttempts: number, hasActiveCode: boolean}>}
 */
async function getRemainingAttempts(phoneNumber) {
  if (!db) {
    throw new Error("SMS service not initialized. Call initialize(db) first.");
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  const verification = await db
    .prepare(
      `SELECT attempts FROM phone_verifications
       WHERE phone_number = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(normalizedPhone);

  if (!verification) {
    return {
      success: true,
      remainingAttempts: config.maxVerificationAttempts,
      hasActiveCode: false,
    };
  }

  const remainingAttempts =
    config.maxVerificationAttempts - verification.attempts;

  return {
    success: true,
    remainingAttempts: Math.max(0, remainingAttempts),
    hasActiveCode: remainingAttempts > 0,
  };
}

/**
 * Clean up expired verification codes
 * Call this periodically (e.g., via cron job) to remove old records
 * @returns {Promise<{deleted: number}>}
 */
async function cleanupExpiredCodes() {
  if (!db) {
    throw new Error("SMS service not initialized. Call initialize(db) first.");
  }

  // Delete records older than 24 hours (well past expiration)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const result = await db
    .prepare("DELETE FROM phone_verifications WHERE created_at < ?")
    .run(oneDayAgo.toISOString());

  const deleted = result.changes || 0;

  if (deleted > 0) {
    smsLogger.info({ deleted }, "Cleaned up expired verification codes");
  }

  return { deleted };
}

module.exports = {
  initialize,
  isConfigured,
  sendVerificationCode,
  verifyCode,
  getRemainingAttempts,
  cleanupExpiredCodes,
};
