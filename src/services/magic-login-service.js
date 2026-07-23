"use strict";

const crypto = require("node:crypto");

const MAGIC_LOGIN_TTL_MS = 15 * 60 * 1000;
const MAGIC_LOGIN_RECOVERY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_SECRET_LENGTH = 512;
const PLATFORMS = new Set(["ios", "android", "web"]);
const PURPOSES = new Set(["login", "register", "add_email"]);

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("INVALID_MAGIC_LOGIN_EMAIL");
  }
  return normalized;
}

function requireSecret(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SECRET_LENGTH
  ) {
    return null;
  }
  return hashValue(value);
}

function validTransactionId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TRANSACTION_ID_LENGTH
  );
}

function recoveryKey() {
  const material = process.env.MAGIC_LOGIN_RECOVERY_KEY || process.env.JWT_SECRET;
  if (!material && process.env.NODE_ENV !== "test") {
    throw new Error("MAGIC_LOGIN_RECOVERY_KEY_REQUIRED");
  }
  return crypto
    .createHash("sha256")
    .update(material || "test-magic-login-recovery-key", "utf8")
    .digest();
}

function sealRecoveryResult(result, randomBytes) {
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", recoveryKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(result), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function openRecoveryResult(sealed) {
  if (!sealed || sealed.v !== 1) throw new Error("INVALID_MAGIC_LOGIN_RECOVERY");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    recoveryKey(),
    Buffer.from(sealed.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function createMagicLoginService({
  repository,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
  ttlMs = MAGIC_LOGIN_TTL_MS,
  recoveryTtlMs = MAGIC_LOGIN_RECOVERY_TTL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  if (!repository) throw new Error("MAGIC_LOGIN_REPOSITORY_REQUIRED");
  if (ttlMs <= 0 || ttlMs > MAGIC_LOGIN_TTL_MS) {
    throw new Error("INVALID_MAGIC_LOGIN_TTL");
  }

  function hashRequesterKey(requesterKey) {
    if (typeof requesterKey !== "string" || requesterKey.length === 0) {
      throw new Error("MAGIC_LOGIN_REQUESTER_KEY_REQUIRED");
    }
    return hashValue(requesterKey);
  }

  async function createTransaction({
    email,
    platform,
    purpose,
    requesterKey,
    ipAddress = null,
    accountId = null,
    authorizingSessionId = null,
  }) {
    if (!PLATFORMS.has(platform)) throw new Error("INVALID_MAGIC_LOGIN_PLATFORM");
    if (!PURPOSES.has(purpose)) throw new Error("INVALID_MAGIC_LOGIN_PURPOSE");
    if ((purpose === "add_email") !== Boolean(accountId)) {
      throw new Error("INVALID_MAGIC_LOGIN_ACCOUNT_BINDING");
    }
    if ((purpose === "add_email") !== Boolean(authorizingSessionId)) {
      throw new Error("INVALID_MAGIC_LOGIN_SESSION_BINDING");
    }

    const createdAtDate = now();
    const createdAt = createdAtDate.toISOString();
    const expiresAt = new Date(createdAtDate.getTime() + ttlMs).toISOString();
    const linkSecret = randomBytes(32).toString("base64url");
    const requestSecret = randomBytes(32).toString("base64url");
    const id = randomUUID();

    await repository.insert({
      id,
      platform,
      purpose,
      emailNormalized: normalizeEmail(email),
      accountId,
      authorizingSessionId,
      linkSecretHash: hashValue(linkSecret),
      requestSecretHash: hashValue(requestSecret),
      requesterKeyHash: hashRequesterKey(requesterKey),
      ipAddressHash: ipAddress ? hashValue(ipAddress) : null,
      maxAttempts,
      createdAt,
      expiresAt,
    });

    return {
      transactionId: id,
      linkSecret,
      requestSecret,
      expiresAt,
    };
  }

  async function exchange({
    transactionId,
    platform,
    linkSecret,
    requestSecret,
    consume = async () => ({}),
  }) {
    if (!validTransactionId(transactionId) || !PLATFORMS.has(platform)) {
      return { status: "invalid" };
    }
    const linkSecretHash = requireSecret(linkSecret);
    const requestSecretHash = requireSecret(requestSecret);
    if (!linkSecretHash || !requestSecretHash) return { status: "invalid" };

    return repository.withTransaction(async (transactionRepository) => {
      const exchangedAtDate = now();
      const exchangedAt = exchangedAtDate.toISOString();
      const recovered = await transactionRepository.claimRecovery({
        id: transactionId,
        platform,
        linkSecretHash,
        requestSecretHash,
        claimedAt: exchangedAt,
      });
      if (recovered) {
        return {
          status: "recovered",
          result: openRecoveryResult(recovered.recoveryResult),
        };
      }

      const transaction = await transactionRepository.findById(transactionId);
      if (
        !transaction ||
        transaction.platform !== platform ||
        transaction.status !== "pending" ||
        Date.parse(transaction.expiresAt) <= exchangedAtDate.getTime()
      ) {
        return { status: "invalid" };
      }

      const claimed = await transactionRepository.claimPending({
        id: transactionId,
        platform,
        linkSecretHash,
        requestSecretHash,
        consumedAt: exchangedAt,
      });
      if (!claimed) {
        await transactionRepository.recordFailedAttempt({
          id: transactionId,
          platform,
          attemptedAt: exchangedAt,
        });
        return { status: "invalid" };
      }

      const result = (await consume(transaction, transactionRepository)) || {};
      const stored = await transactionRepository.storeRecoveryResult({
        id: transactionId,
        requestSecretHash,
        result: sealRecoveryResult(result, randomBytes),
        recoveryExpiresAt: new Date(
          exchangedAtDate.getTime() + recoveryTtlMs,
        ).toISOString(),
        sessionId: result.sessionId || null,
      });
      if (stored.changes !== 1) {
        throw new Error("MAGIC_LOGIN_RECOVERY_RESULT_NOT_STORED");
      }
      return { status: "consumed", result };
    });
  }

  // A cross-browser Etsy code claim deliberately does not use the ordinary web
  // preauth cookie. Callers must authorize the transaction against a live,
  // server-side paid-code claim before this one-secret exchange can consume it.
  async function exchangeAuthorizedClaim({
    transactionId,
    platform,
    linkSecret,
    authorize,
    consume = async () => ({}),
  }) {
    if (
      !validTransactionId(transactionId) ||
      platform !== "web" ||
      typeof authorize !== "function"
    ) {
      return { status: "invalid" };
    }
    const linkSecretHash = requireSecret(linkSecret);
    if (!linkSecretHash) return { status: "invalid" };

    return repository.withTransaction(async (transactionRepository) => {
      const consumedAtDate = now();
      const consumedAt = consumedAtDate.toISOString();
      const transaction = await transactionRepository.findById(transactionId);
      if (
        !transaction ||
        transaction.platform !== platform ||
        transaction.purpose !== "login" ||
        transaction.status !== "pending" ||
        Date.parse(transaction.expiresAt) <= consumedAtDate.getTime() ||
        !(await authorize(transaction, transactionRepository))
      ) {
        return { status: "invalid" };
      }
      const claimed = await transactionRepository.claimPendingByLink({
        id: transactionId,
        platform,
        linkSecretHash,
        consumedAt,
      });
      if (!claimed) {
        await transactionRepository.recordFailedAttempt({
          id: transactionId,
          platform,
          attemptedAt: consumedAt,
        });
        return { status: "invalid" };
      }
      return {
        status: "consumed",
        result: (await consume(transaction, transactionRepository)) || {},
      };
    });
  }

  async function approve({ transactionId, platform, linkSecret }) {
    if (
      !validTransactionId(transactionId) ||
      !PLATFORMS.has(platform) ||
      platform === "web"
    ) {
      return { status: "invalid" };
    }
    const linkSecretHash = requireSecret(linkSecret);
    if (!linkSecretHash) return { status: "invalid" };

    return repository.withTransaction(async (transactionRepository) => {
      const approvedAt = now().toISOString();
      const approved = await transactionRepository.approvePending({
        id: transactionId,
        platform,
        linkSecretHash,
        approvedAt,
      });
      if (!approved) {
        await transactionRepository.recordFailedAttempt({
          id: transactionId,
          platform,
          attemptedAt: approvedAt,
        });
        return { status: "invalid" };
      }
      return { status: "approved" };
    });
  }

  async function status({ transactionId, platform, requestSecret }) {
    if (
      !validTransactionId(transactionId) ||
      !PLATFORMS.has(platform) ||
      platform === "web"
    ) {
      return { status: "invalid" };
    }
    const requestSecretHash = requireSecret(requestSecret);
    if (!requestSecretHash) return { status: "invalid" };
    const transaction = await repository.findByRequesterProof({
      id: transactionId,
      platform,
      requestSecretHash,
    });
    if (!transaction) return { status: "invalid" };
    if (transaction.status === "locked") {
      return { status: "locked", expiresAt: transaction.expiresAt };
    }
    if (transaction.status === "consumed") {
      return { status: "consumed", expiresAt: transaction.expiresAt };
    }
    if (Date.parse(transaction.expiresAt) <= now().getTime()) {
      return { status: "expired", expiresAt: transaction.expiresAt };
    }
    return {
      status: transaction.approvedAt ? "approved" : "pending",
      expiresAt: transaction.expiresAt,
    };
  }

  async function completeApproved({
    transactionId,
    platform,
    requestSecret,
    consume = async () => ({}),
  }) {
    if (
      !validTransactionId(transactionId) ||
      !PLATFORMS.has(platform) ||
      platform === "web"
    ) {
      return { status: "invalid" };
    }
    const requestSecretHash = requireSecret(requestSecret);
    if (!requestSecretHash) return { status: "invalid" };

    return repository.withTransaction(async (transactionRepository) => {
      const completedAtDate = now();
      const completedAt = completedAtDate.toISOString();
      const recovered = await transactionRepository.claimNativeRecovery({
        id: transactionId,
        platform,
        requestSecretHash,
        claimedAt: completedAt,
      });
      if (recovered) {
        return {
          status: "recovered",
          result: openRecoveryResult(recovered.recoveryResult),
        };
      }

      const transaction = await transactionRepository.findByRequesterProof({
        id: transactionId,
        platform,
        requestSecretHash,
      });
      if (
        !transaction ||
        transaction.status !== "pending" ||
        !transaction.approvedAt ||
        Date.parse(transaction.expiresAt) <= completedAtDate.getTime()
      ) {
        return { status: "invalid" };
      }
      const claimed = await transactionRepository.claimApproved({
        id: transactionId,
        platform,
        requestSecretHash,
        consumedAt: completedAt,
      });
      if (!claimed) return { status: "invalid" };

      const result = (await consume(transaction, transactionRepository)) || {};
      const stored = await transactionRepository.storeRecoveryResult({
        id: transactionId,
        requestSecretHash,
        result: sealRecoveryResult(result, randomBytes),
        recoveryExpiresAt: new Date(
          completedAtDate.getTime() + recoveryTtlMs,
        ).toISOString(),
        sessionId: result.sessionId || null,
      });
      if (stored.changes !== 1) {
        throw new Error("MAGIC_LOGIN_RECOVERY_RESULT_NOT_STORED");
      }
      return { status: "consumed", result };
    });
  }

  return {
    createTransaction,
    exchange,
    exchangeAuthorizedClaim,
    approve,
    status,
    completeApproved,
    hashRequesterKey,
  };
}

module.exports = {
  createMagicLoginService,
  MAGIC_LOGIN_TTL_MS,
  MAGIC_LOGIN_RECOVERY_TTL_MS,
};
