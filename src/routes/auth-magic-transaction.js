const crypto = require("crypto");
const authService = require("../services/auth-service");
const identityService = require("../services/identity-service");
const {
  createAuthSessionRepository,
} = require("../database/auth-session-repository");
const {
  createAuthRefreshTokenRepository,
} = require("../database/auth-refresh-token-repository");
const {
  createAuthSecurityRepository,
} = require("../database/auth-security-repository");
const { createIdentityRepository } = require("../database/identity-repository");
const {
  reclaimGuestOrdersOnLogin,
} = require("../services/web-order-login-reclaim");
const { dbQuery } = require("../utils/db-adapter");
const { getClientIp } = require("../utils/client-ip");
const { generateId } = require("../utils/ids");

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "this email";
  return `${local.slice(0, 1)}***@${domain}`;
}

function createConsumeMagicTransaction({
  etsyCodeClaimService,
  etsyRedemptionService,
}) {
  return async function consumeMagicTransaction(
    transaction,
    transactionRepository,
    platform,
    request,
  ) {
    if (transaction.purpose === "add_email") {
      const txSessionRepository = createAuthSessionRepository(
        transactionRepository.db,
      );
      const authorizingSession =
        transaction.authorizingSessionId &&
        (await txSessionRepository.findActiveSession({
          userId: transaction.accountId,
          sessionId: transaction.authorizingSessionId,
        }));
      if (!authorizingSession) {
        const error = new Error("MAGIC_LOGIN_AUTHORIZATION_EXPIRED");
        error.code = "MAGIC_LOGIN_AUTHORIZATION_EXPIRED";
        throw error;
      }
      const txIdentityRepository = createIdentityRepository(
        transactionRepository.db,
      );
      await identityService.linkVerifiedMagicEmail(
        txIdentityRepository,
        transaction.accountId,
        transaction.emailNormalized,
      );
      return {
        userId: transaction.accountId,
        sessionId: null,
        contactVerified: true,
      };
    }
    if (transaction.purpose !== "login") {
      throw new Error("MAGIC_LOGIN_PURPOSE_NOT_SUPPORTED");
    }

    const txDb = transactionRepository.db;
    const transactionQuery = (sql, params) => dbQuery(txDb, sql, params);
    const etsyCodeClaim = etsyCodeClaimService
      ? await etsyCodeClaimService.findPendingForTransaction(transaction.id, {
          query: transactionQuery,
        })
      : null;
    if (
      etsyCodeClaim &&
      etsyCodeClaim.email_normalized !== transaction.emailNormalized
    ) {
      throw new Error("ETSY_CODE_CLAIM_EMAIL_MISMATCH");
    }
    const txIdentityRepository = createIdentityRepository(txDb);
    let owner = await txIdentityRepository.findActiveUserByVerifiedContact(
      "email",
      transaction.emailNormalized,
    );
    let isNewUser = false;
    if (!owner) {
      const legacyOwner = await txIdentityRepository.findActiveUserByAnyContact(
        "email",
        transaction.emailNormalized,
      );
      if (legacyOwner) {
        const activeProviders =
          await txIdentityRepository.listActiveAuthProvidersForUser(
            legacyOwner.id,
          );
        const isSafeEmailShell = activeProviders.every(
          (row) =>
            row.provider === "email" &&
            row.provider_user_id === transaction.emailNormalized,
        );
        if (isSafeEmailShell) {
          await identityService.verifyContact(
            txIdentityRepository,
            legacyOwner.id,
            "email",
            transaction.emailNormalized,
            "magic_link",
          );
          owner = { id: legacyOwner.id };
        } else {
          const error = new Error("LEGACY_ACCOUNT_RECOVERY_REQUIRED");
          error.code = "LEGACY_ACCOUNT_RECOVERY_REQUIRED";
          error.details = {
            masked_email: maskEmail(transaction.emailNormalized),
            auth_methods: activeProviders.map((row) => row.provider).join(","),
          };
          throw error;
        }
      } else {
        const created =
          await identityService.createUserWithIdentityInRepository(
            txIdentityRepository,
            {
              type: "email",
              subject: transaction.emailNormalized,
              verifiedAt: new Date().toISOString(),
            },
            {
              contacts: [
                {
                  type: "email",
                  value: transaction.emailNormalized,
                  source: "magic_link",
                  verified: true,
                },
              ],
            },
          );
        owner = { id: created.userId };
        isNewUser = true;
      }
    }

    await reclaimGuestOrdersOnLogin(
      (sql, params) => dbQuery(txDb, sql, params),
      {
        loginUserId: owner.id,
        emailNormalized: transaction.emailNormalized,
        identityRepository: txIdentityRepository,
      },
    );

    if (isNewUser) {
      await createAuthSecurityRepository(txDb).insertAuthEvent({
        id: generateId("evt"),
        userId: owner.id,
        eventType: "signup_success",
        metadataJson: JSON.stringify({
          method: "magic_email",
          name_supplied: false,
          platform,
        }),
      });
    }

    if (platform === "web") {
      const now = new Date();
      const webSessionToken = crypto.randomBytes(32).toString("base64url");
      const sessionId = `sess_${crypto.randomBytes(12).toString("hex")}`;
      const absoluteExpiresAt = new Date(
        now.getTime() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await createAuthSessionRepository(txDb).insertSession({
        id: sessionId,
        userId: owner.id,
        deviceName: request.headers["user-agent"],
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
        authMethod: "magic_email",
        platform: "web",
        authenticatedAt: now.toISOString(),
        idleExpiresAt: new Date(
          now.getTime() + 90 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        absoluteExpiresAt,
        lastRotatedAt: now.toISOString(),
        webSessionHash: crypto
          .createHash("sha256")
          .update(webSessionToken, "utf8")
          .digest("hex"),
      });
      if (etsyCodeClaim) {
        if (!etsyRedemptionService) {
          throw new Error("ETSY_CODE_REDEMPTION_SERVICE_REQUIRED");
        }
        await etsyRedemptionService.redeem({
          code: etsyCodeClaim.code,
          userId: owner.id,
          externalQuery: transactionQuery,
        });
        await etsyCodeClaimService.markConsumed(
          {
            claimId: etsyCodeClaim.id,
            ownerUserId: owner.id,
          },
          { query: transactionQuery },
        );
      }
      return {
        userId: owner.id,
        sessionId,
        webSessionToken,
        absoluteExpiresAt,
        isNewUser,
        identitySubject: transaction.emailNormalized,
      };
    }

    const issued = await authService.createSessionAndRefreshTokenInTransaction(
      owner.id,
      {
        platform,
        authMethod: "magic_email",
        deviceName: request.headers["user-agent"],
        userAgent: request.headers["user-agent"],
        ipAddress: getClientIp(request),
      },
      {
        sessionRepository: createAuthSessionRepository(txDb),
        refreshTokenRepository: createAuthRefreshTokenRepository(txDb),
      },
    );
    return {
      userId: owner.id,
      sessionId: issued.sessionId,
      tokenFamilyId: issued.tokenFamily,
      accessToken: authService.generateAccessToken(owner.id, {
        sessionId: issued.sessionId,
      }),
      refreshToken: issued.refreshToken,
      absoluteExpiresAt: issued.absoluteExpiresAt,
      isNewUser,
      identitySubject: transaction.emailNormalized,
    };
  };
}

module.exports = { createConsumeMagicTransaction };
