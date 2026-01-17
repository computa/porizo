const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ISSUER = "porizo-device";
const DEFAULT_TTL_DAYS = Number(process.env.DEVICE_TOKEN_TTL_DAYS || 30);

let cachedSecret = null;

function getSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }
  const envSecret = process.env.DEVICE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (envSecret) {
    cachedSecret = envSecret;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DEVICE_TOKEN_SECRET is required in production.");
  }

  cachedSecret = crypto.randomBytes(32).toString("hex");
  console.warn("[DeviceToken] DEVICE_TOKEN_SECRET not set; using ephemeral dev secret.");
  return cachedSecret;
}

function issueDeviceToken({ userId, deviceId, platform, appVersion }) {
  const secret = getSecret();
  return jwt.sign(
    {
      sub: userId,
      device_id: deviceId,
      platform,
      app_version: appVersion || null,
    },
    secret,
    {
      issuer: ISSUER,
      expiresIn: `${DEFAULT_TTL_DAYS}d`,
    }
  );
}

function verifyDeviceToken(token) {
  const secret = getSecret();
  return jwt.verify(token, secret, { issuer: ISSUER });
}

module.exports = {
  issueDeviceToken,
  verifyDeviceToken,
};
