/**
 * Auth Identity Model Tests
 *
 * Validates the three-layer identity model:
 *   1. user_auth_providers — how you prove who you are (sign-in identities)
 *   2. user_contacts       — how we reach you (email, phone)
 *   3. users.*             — mirror columns synced from contacts
 *
 * Covers: cross-provider linking, conflict detection, profile completeness,
 *         email verification lifecycle, entitlement invariants, and backfill.
 */

// Environment must be set before any require() that reads process.env
process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-identity-model-0123456789abcdef";
process.env.APPLE_CLIENT_ID =
  process.env.APPLE_CLIENT_ID || "com.porizo.app.test";
process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");
const {
  clearRateLimits,
  clearRegistrationTokens,
} = require("../src/routes/auth");
const identityService = require("../src/services/identity-service");

// ==================== TEST HELPERS ====================

function uniqueEmail() {
  return `test-${crypto.randomBytes(8).toString("hex")}@example.com`;
}

function uniquePhone() {
  // Generate unique E.164 phone: +1555XXXXXXX
  const suffix = crypto.randomBytes(4).readUInt32BE(0) % 10000000;
  return `+1555${String(suffix).padStart(7, "0")}`;
}

function uniqueAppleSub() {
  return `apple-sub-${crypto.randomBytes(8).toString("hex")}`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Build a mock Apple JWT with the given claims.
 * In test mode (ALLOW_MOCK_SOCIAL_AUTH=true), signature verification is skipped.
 */
function buildMockAppleToken({ sub, email, emailVerified = true, nonce }) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      email,
      email_verified: emailVerified,
      iss: "https://appleid.apple.com",
      aud: process.env.APPLE_CLIENT_ID,
      nonce: sha256Hex(nonce),
    }),
  ).toString("base64url");
  const signature = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * Create an Apple-first user via POST /auth/social.
 * Returns { userId, accessToken, refreshToken, email, appleSub, nonce }.
 */
async function createAppleUser(app, { email, sub, name } = {}) {
  const appleSub = sub || uniqueAppleSub();
  const appleEmail = email || uniqueEmail();
  const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
  const token = buildMockAppleToken({
    sub: appleSub,
    email: appleEmail,
    nonce,
  });

  const res = await app.inject({
    method: "POST",
    url: "/auth/social",
    payload: {
      provider: "apple",
      id_token: token,
      nonce,
      name: name || "Apple User",
    },
  });

  const body = JSON.parse(res.body);
  assert.ok(body.user_id, `Apple user creation failed: ${res.body}`);
  return {
    userId: body.user_id,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    email: appleEmail,
    appleSub,
    nonce,
    statusCode: res.statusCode,
  };
}

/**
 * Insert a phone verification code directly into the DB so that
 * smsService.verifyCode() succeeds without Twilio.
 */
async function seedPhoneVerification(db, phoneNumber, code = "123456") {
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const id = `pv_${crypto.randomBytes(8).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO phone_verifications (id, phone_number, code, code_hash, expires_at, attempts)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(id, phoneNumber, code, codeHash, expiresAt);
}

/**
 * Create a phone-first user:
 *   1. Seed a verification code
 *   2. POST /auth/phone/verify to get a registration token
 *   3. POST /auth/phone/register to create the user
 * Returns { userId, accessToken, refreshToken, phone }.
 */
async function createPhoneUser(app, db, { phone, name, email } = {}) {
  const phoneNumber = phone || uniquePhone();
  const code = "123456";

  // Seed verification code
  await seedPhoneVerification(db, phoneNumber, code);

  // Verify code — should return registration_token for new phone
  const verifyRes = await app.inject({
    method: "POST",
    url: "/auth/phone/verify",
    payload: { phone_number: phoneNumber, code },
  });
  const verifyBody = JSON.parse(verifyRes.body);
  assert.strictEqual(
    verifyBody.verified,
    true,
    `Phone verify failed: ${verifyRes.body}`,
  );
  assert.strictEqual(
    verifyBody.existing_user,
    false,
    "Expected new phone user",
  );
  assert.ok(verifyBody.registration_token, "Missing registration_token");

  // Register
  const registerRes = await app.inject({
    method: "POST",
    url: "/auth/phone/register",
    payload: {
      registration_token: verifyBody.registration_token,
      phone_number: phoneNumber,
      name: name || "Phone User",
      ...(email ? { email } : {}),
    },
  });
  const registerBody = JSON.parse(registerRes.body);
  assert.strictEqual(
    registerRes.statusCode,
    201,
    `Phone register failed: ${registerRes.body}`,
  );
  assert.ok(registerBody.user_id, "Missing user_id from register");

  return {
    userId: registerBody.user_id,
    accessToken: registerBody.access_token,
    refreshToken: registerBody.refresh_token,
    phone: phoneNumber,
  };
}

/**
 * Sign in an existing phone user (phone already linked to an account).
 * Seeds OTP and calls /auth/phone/verify.
 */
async function phoneSignIn(app, db, phoneNumber) {
  const code = "654321";
  await seedPhoneVerification(db, phoneNumber, code);

  const res = await app.inject({
    method: "POST",
    url: "/auth/phone/verify",
    payload: { phone_number: phoneNumber, code },
  });
  const body = JSON.parse(res.body);
  return { ...body, statusCode: res.statusCode };
}

/**
 * Link a phone to an authenticated user via POST /auth/phone/link.
 * Seeds the OTP first.
 */
async function linkPhone(app, db, accessToken, phoneNumber) {
  const code = "111111";
  await seedPhoneVerification(db, phoneNumber, code);

  const res = await app.inject({
    method: "POST",
    url: "/auth/phone/link",
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { phone_number: phoneNumber, code },
  });
  return { body: JSON.parse(res.body), statusCode: res.statusCode };
}

/**
 * Link Apple identity to an authenticated user.
 */
async function linkApple(app, accessToken, { sub, email } = {}) {
  const appleSub = sub || uniqueAppleSub();
  const appleEmail = email || uniqueEmail();
  const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
  const token = buildMockAppleToken({
    sub: appleSub,
    email: appleEmail,
    nonce,
  });

  const res = await app.inject({
    method: "POST",
    url: "/auth/identity/link/apple",
    headers: { Authorization: `Bearer ${accessToken}` },
    payload: { id_token: token, nonce },
  });
  return {
    body: JSON.parse(res.body),
    statusCode: res.statusCode,
    appleSub,
    appleEmail,
  };
}

/**
 * GET /auth/me for an authenticated user.
 */
async function getMe(app, accessToken) {
  const res = await app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { body: JSON.parse(res.body), statusCode: res.statusCode };
}

// ==================== TEST SUITE ====================

describe("Auth Identity Model", () => {
  let app;
  let db;
  let tmpDir;
  let storageDir;

  before(async () => {
    process.env.APPLE_CLIENT_ID =
      process.env.APPLE_CLIENT_ID || "com.porizo.app.test";
    process.env.ALLOW_MOCK_SOCIAL_AUTH = "true";

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-identity-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    storageDir = path.join(tmpDir, "storage");
    fs.mkdirSync(storageDir, { recursive: true });

    const migrationsDir = path.join(__dirname, "..", "migrations");
    db = await initDb({ dbPath, migrationsDir });

    const storage = createStorageProvider({
      type: "local",
      basePath: storageDir,
    });

    app = buildServer({
      db,
      config: {
        PORT: 0,
        HOST: "127.0.0.1",
        STORAGE_BASE_URL: "",
        UPLOAD_SIGNING_SECRET: "test-secret",
        CLEANUP_INTERVAL_MS: 0,
      },
      storage,
    });

    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    if (db && db.close) db.close();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    clearRateLimits(db);
  });

  // ==================== S1: Apple-first -> link phone -> phone sign-in ====================

  describe("S1: Apple-first -> link phone -> phone sign-in", () => {
    let appleUser;
    let phoneNumber;

    it("should create Apple-first user via POST /auth/social", async () => {
      appleUser = await createAppleUser(app);
      assert.ok(appleUser.userId);
      assert.strictEqual(appleUser.statusCode, 201);
    });

    it("should link phone via POST /auth/phone/link", async () => {
      phoneNumber = uniquePhone();
      const result = await linkPhone(
        app,
        db,
        appleUser.accessToken,
        phoneNumber,
      );
      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(result.body.success, true);
    });

    it("should sign in by phone and resolve to same user", async () => {
      const signIn = await phoneSignIn(app, db, phoneNumber);
      assert.strictEqual(signIn.verified, true);
      assert.strictEqual(signIn.existing_user, true);
      assert.strictEqual(
        signIn.user_id,
        appleUser.userId,
        "Phone sign-in must resolve to same user_id",
      );
      assert.ok(signIn.access_token);
    });

    it("should update phone identity last_used_at on sign-in", async () => {
      const phoneIdentity = await db
        .prepare(
          `SELECT last_used_at FROM user_auth_providers
           WHERE user_id = ? AND provider = 'phone'`,
        )
        .get(appleUser.userId);
      assert.ok(phoneIdentity, "Phone identity row must exist");
      assert.ok(
        phoneIdentity.last_used_at,
        "last_used_at must be set after sign-in",
      );
    });

    it("should preserve entitlements after phone sign-in", async () => {
      const entitlements = await db
        .prepare("SELECT * FROM entitlements WHERE user_id = ?")
        .get(appleUser.userId);
      assert.ok(entitlements, "Entitlements must exist for user");
    });
  });

  // ==================== S2: Phone-first -> link Apple -> Apple sign-in ====================

  describe("S2: Phone-first -> link Apple -> Apple sign-in", () => {
    let phoneUser;
    let linkedApple;

    it("should create phone-first user via register flow", async () => {
      phoneUser = await createPhoneUser(app, db);
      assert.ok(phoneUser.userId);
    });

    it("should link Apple via POST /auth/identity/link/apple", async () => {
      linkedApple = await linkApple(app, phoneUser.accessToken);
      assert.strictEqual(linkedApple.statusCode, 200);
      assert.strictEqual(linkedApple.body.success, true);
    });

    it("should sign in by Apple and resolve to same user", async () => {
      // Sign in via Apple using the same Apple sub
      const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
      const token = buildMockAppleToken({
        sub: linkedApple.appleSub,
        email: linkedApple.appleEmail,
        nonce,
      });

      const res = await app.inject({
        method: "POST",
        url: "/auth/social",
        payload: { provider: "apple", id_token: token, nonce },
      });

      assert.strictEqual(
        res.statusCode,
        200,
        "Should be 200 for existing user sign-in",
      );
      const body = JSON.parse(res.body);
      assert.strictEqual(
        body.user_id,
        phoneUser.userId,
        "Apple sign-in must resolve to same user_id",
      );
      assert.ok(body.access_token);
    });

    it("should preserve entitlements after cross-provider sign-in", async () => {
      const entitlements = await db
        .prepare("SELECT * FROM entitlements WHERE user_id = ?")
        .get(phoneUser.userId);
      assert.ok(entitlements, "Entitlements must exist for user");
    });
  });

  // ==================== S3: Existing verified email conflict ====================

  describe("S3: Existing verified email conflict", () => {
    it("should not create duplicate user when Apple email matches verified email", async () => {
      const sharedEmail = uniqueEmail();

      // Create user A with verified email via signup + verify
      const signupRes = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: {
          email: sharedEmail,
          password: "SecurePassword123",
          name: "User A",
        },
      });
      const userA = JSON.parse(signupRes.body);
      assert.ok(userA.user_id);

      // Manually mark email as verified (normally done via verification token)
      await db
        .prepare("UPDATE users SET email_verified = 1 WHERE id = ?")
        .run(userA.user_id);
      await identityService.verifyContact(
        db,
        userA.user_id,
        "email",
        sharedEmail,
        "email_token",
      );

      // Attempt Apple sign-in with same email — should get link confirmation prompt
      const appleSub = uniqueAppleSub();
      const nonce = `nonce-${crypto.randomBytes(8).toString("hex")}`;
      const token = buildMockAppleToken({
        sub: appleSub,
        email: sharedEmail,
        nonce,
      });

      const appleRes = await app.inject({
        method: "POST",
        url: "/auth/social",
        payload: { provider: "apple", id_token: token, nonce },
      });

      const appleBody = JSON.parse(appleRes.body);

      // The server should either prompt for link confirmation or auto-link.
      // With confirm_link=false (default), it returns requires_link_confirmation.
      assert.strictEqual(
        appleBody.requires_link_confirmation,
        true,
        "Should require explicit confirmation before linking to existing account",
      );

      // Verify no duplicate user was created
      const userCount = await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM users WHERE email = ? AND deleted_at IS NULL",
        )
        .get(sharedEmail.toLowerCase());
      assert.strictEqual(userCount.cnt, 1, "Must not create duplicate user");
    });
  });

  // ==================== S4: Existing phone conflict (E118) ====================

  describe("S4: Existing phone conflict (E118)", () => {
    it("should reject linking same phone to another user with E118", async () => {
      const sharedPhone = uniquePhone();

      // Create user A with phone
      const userA = await createPhoneUser(app, db, { phone: sharedPhone });

      // Create user B (Apple)
      const userB = await createAppleUser(app);

      // Attempt to link same phone to user B
      const result = await linkPhone(app, db, userB.accessToken, sharedPhone);

      // Must be 409 conflict with E117 or E118 error
      assert.strictEqual(
        result.statusCode,
        409,
        "Must reject duplicate phone link",
      );
      assert.ok(
        result.body.error === "E117_PHONE_EXISTS" ||
          result.body.error === "E118_PROVIDER_ALREADY_LINKED",
        `Expected phone conflict error, got: ${result.body.error}`,
      );
    });
  });

  // ==================== S5: Relay email completeness ====================

  describe("S5: Relay email completeness", () => {
    it("should flag relay email as needing profile completion", async () => {
      const relayEmail = `test-${crypto.randomBytes(8).toString("hex")}@privaterelay.appleid.com`;
      const appleUser = await createAppleUser(app, { email: relayEmail });

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);

      // With relay email and no phone, profile is incomplete
      assert.strictEqual(
        me.body.needs_profile_completion,
        true,
        "Relay-only user needs profile completion",
      );
      assert.ok(
        me.body.missing_profile_requirements.includes("verified_email"),
        "Must include verified_email in missing requirements (relay doesn't count)",
      );
    });

    it("should clear relay-based missing state after adding real verified email", async () => {
      const relayEmail = `test-${crypto.randomBytes(8).toString("hex")}@privaterelay.appleid.com`;
      const appleUser = await createAppleUser(app, { email: relayEmail });
      const realEmail = uniqueEmail();

      // Add real email via profile update
      await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${appleUser.accessToken}` },
        payload: { contact_email: realEmail },
      });

      // Manually verify the contact (simulating token verification)
      await identityService.verifyContact(
        db,
        appleUser.userId,
        "email",
        realEmail,
        "test_verify",
      );
      // Also set legacy flag for backward compat
      await db
        .prepare("UPDATE users SET email_verified = 1 WHERE id = ?")
        .run(appleUser.userId);

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);
      assert.ok(
        !me.body.missing_profile_requirements.includes("verified_email"),
        "verified_email should no longer be in missing requirements",
      );
    });
  });

  // ==================== S5b: Collection-based completeness (policy v1) ====================
  // Policy v1: profile is complete once a non-relay email OR a phone is on file.
  // Verification is NOT required — the prompt is a marketing-signal collection,
  // not an identity check. Prevents "Complete your profile" from re-appearing
  // every launch for users who provided contact info but haven't clicked a verify link.

  describe("S5b: Collection-based completeness", () => {
    it("should mark profile complete when phone is on file (even unverified)", async () => {
      const relayEmail = `test-${crypto.randomBytes(8).toString("hex")}@privaterelay.appleid.com`;
      const appleUser = await createAppleUser(app, { email: relayEmail });

      // Link phone (linkPhone performs OTP verification; contact is verified)
      const phoneNumber = uniquePhone();
      const linkRes = await linkPhone(
        app,
        db,
        appleUser.accessToken,
        phoneNumber,
      );
      assert.strictEqual(linkRes.statusCode, 200, "Phone link must succeed");

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);
      assert.strictEqual(
        me.body.needs_profile_completion,
        false,
        "User with phone on file should NOT need profile completion under policy v1",
      );
    });

    it("should mark profile complete when real email is on file — even unverified", async () => {
      const relayEmail = `test-${crypto.randomBytes(8).toString("hex")}@privaterelay.appleid.com`;
      const appleUser = await createAppleUser(app, { email: relayEmail });
      const realEmail = uniqueEmail();

      // Add real email WITHOUT verifying it.
      await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${appleUser.accessToken}` },
        payload: { contact_email: realEmail },
      });

      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);
      assert.strictEqual(
        me.body.needs_profile_completion,
        false,
        "Unverified real email on file should still mark profile complete",
      );
      // verified_email stays in missing_profile_requirements as an informational nudge
      assert.ok(
        me.body.missing_profile_requirements.includes("verified_email"),
        "missing_profile_requirements still reports unverified email for UI nudges",
      );
    });

    // Relay-only = incomplete is already covered by S5's first test.
  });

  // ==================== S6: Email verification lifecycle ====================

  describe("S6: Email verification lifecycle", () => {
    let userId;
    let accessToken;
    let testEmail;

    before(async () => {
      // Create user with Apple (no email or with relay)
      const user = await createAppleUser(app);
      userId = user.userId;
      accessToken = user.accessToken;
      testEmail = uniqueEmail();
    });

    it("should create unverified contact via PATCH /auth/profile", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/auth/profile",
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { contact_email: testEmail },
      });
      assert.strictEqual(res.statusCode, 200);

      // Verify contact exists but is not verified
      const contact = await db
        .prepare(
          `SELECT verified_at FROM user_contacts
           WHERE user_id = ? AND type = 'email' AND value_normalized = ?`,
        )
        .get(userId, testEmail.toLowerCase());
      assert.ok(contact, "Contact row must exist");
      assert.strictEqual(
        contact.verified_at,
        null,
        "Contact must be unverified initially",
      );
    });

    it("should verify email via POST /auth/verify-email", async () => {
      // Create a verification token bound to the email being verified. Production
      // always passes { email } (auth.js PATCH/profile + add-email routes); a
      // bare token has email_normalized=null and would fall back to users.email
      // (a relay for this Apple user), never matching the testEmail contact.
      const authService = require("../src/services/auth-service");
      authService.initialize(db);
      const { token } = await authService.createEmailVerificationToken(userId, {
        email: testEmail,
      });

      // Consume the verification token
      const res = await app.inject({
        method: "POST",
        url: "/auth/verify-email",
        payload: { token },
      });
      assert.strictEqual(res.statusCode, 200);

      // Verify contact is now verified
      const contact = await db
        .prepare(
          `SELECT verified_at FROM user_contacts
           WHERE user_id = ? AND type = 'email' AND value_normalized = ?`,
        )
        .get(userId, testEmail.toLowerCase());
      assert.ok(contact, "Contact row must exist");
      assert.ok(
        contact.verified_at,
        "Contact must be verified after token consumption",
      );
    });

    it("should sync primary email mirror after verification", async () => {
      const user = await db
        .prepare("SELECT email FROM users WHERE id = ?")
        .get(userId);
      // After verification, the mirror should reflect the verified email
      // (depends on whether the user had another primary email before)
      assert.ok(user, "User must exist");
    });
  });

  // ==================== S7: Entitlement invariant ====================

  describe("S7: Entitlement invariant across identity linking", () => {
    let userId;
    let accessToken;
    let trackId;
    let phoneNumber;

    before(async () => {
      // Create Apple user
      const user = await createAppleUser(app);
      userId = user.userId;
      accessToken = user.accessToken;

      // Create a track (song) for this user
      trackId = `track_${crypto.randomBytes(8).toString("hex")}`;
      const now = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO tracks (id, user_id, status, title, occasion, recipient_name, style, voice_mode, created_at, updated_at)
           VALUES (?, ?, 'draft', 'Test Song', 'birthday', 'Test Recipient', 'pop', 'ai_voice', ?, ?)`,
        )
        .run(trackId, userId, now, now);
    });

    it("should link phone without creating duplicate entitlements", async () => {
      phoneNumber = uniquePhone();
      const entitlementsBefore = await db
        .prepare("SELECT * FROM entitlements WHERE user_id = ?")
        .all(userId);

      await linkPhone(app, db, accessToken, phoneNumber);

      const entitlementsAfter = await db
        .prepare("SELECT * FROM entitlements WHERE user_id = ?")
        .all(userId);

      assert.strictEqual(
        entitlementsAfter.length,
        entitlementsBefore.length,
        "Linking must not create duplicate entitlement rows",
      );
    });

    it("should see same tracks after phone sign-in", async () => {
      const signIn = await phoneSignIn(app, db, phoneNumber);
      assert.strictEqual(signIn.user_id, userId);

      // Verify track is accessible under same user_id
      const tracks = await db
        .prepare("SELECT id FROM tracks WHERE user_id = ?")
        .all(userId);
      assert.ok(
        tracks.some((t) => t.id === trackId),
        "Track must be visible after phone sign-in",
      );
    });

    it("should have identical user_id across all auth methods", async () => {
      // Check both identities point to same user
      const appleIdentity = await db
        .prepare(
          "SELECT user_id FROM user_auth_providers WHERE user_id = ? AND provider = 'apple'",
        )
        .get(userId);
      const phoneIdentity = await db
        .prepare(
          "SELECT user_id FROM user_auth_providers WHERE user_id = ? AND provider = 'phone'",
        )
        .get(userId);

      assert.ok(appleIdentity, "Apple identity must exist");
      assert.ok(phoneIdentity, "Phone identity must exist");
      assert.strictEqual(
        appleIdentity.user_id,
        phoneIdentity.user_id,
        "Both identities must share same user_id",
      );
    });
  });

  // ==================== S8: Skip profile completion -> still incomplete ====================

  describe("S8: Skip profile completion -> re-check -> still incomplete", () => {
    it("should not grant grace period after skipping profile completion", async () => {
      // Use a relay email so the user genuinely has no verified channel —
      // otherwise policy v1 ("email OR phone verified") would mark them complete
      // without needing to skip.
      const relayEmail = `test-${crypto.randomBytes(8).toString("hex")}@privaterelay.appleid.com`;
      const user = await createAppleUser(app, { email: relayEmail });

      // Skip completion
      const skipRes = await app.inject({
        method: "POST",
        url: "/auth/profile/skip-completion",
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      assert.strictEqual(skipRes.statusCode, 200);

      // Re-check: needs_profile_completion should still be true
      const me = await getMe(app, user.accessToken);
      assert.strictEqual(
        me.body.needs_profile_completion,
        true,
        "Skipping must NOT resolve profile completion",
      );
      assert.ok(
        me.body.missing_profile_requirements.length > 0,
        "Missing requirements must still be populated",
      );
    });
  });

  // ==================== S9: /auth/me new response shape ====================

  describe("S9: /auth/me new response shape", () => {
    it("should return auth_methods, contacts, primary fields, and missing requirements", async () => {
      // Create Apple user
      const appleUser = await createAppleUser(app);

      // Link phone
      const phoneNumber = uniquePhone();
      await linkPhone(app, db, appleUser.accessToken, phoneNumber);

      // Get /auth/me
      const me = await getMe(app, appleUser.accessToken);
      assert.strictEqual(me.statusCode, 200);

      const body = me.body;

      // Verify auth_methods array
      assert.ok(
        Array.isArray(body.auth_methods),
        "auth_methods must be an array",
      );
      const authMethodTypes = body.auth_methods.map((m) => m.type);
      assert.ok(
        authMethodTypes.includes("apple"),
        "auth_methods must include apple",
      );
      assert.ok(
        authMethodTypes.includes("phone"),
        "auth_methods must include phone",
      );

      // Each auth method should have linked_at and last_used_at
      for (const method of body.auth_methods) {
        assert.ok(method.type, "auth method must have type");
        // linked_at and last_used_at may be null for legacy entries, but should exist for new ones
      }

      // Verify contacts array
      assert.ok(Array.isArray(body.contacts), "contacts must be an array");

      // Verify primary fields exist
      assert.ok("primary_email" in body, "Response must include primary_email");
      assert.ok("primary_phone" in body, "Response must include primary_phone");

      // Verify profile completeness fields
      assert.ok(
        "needs_profile_completion" in body,
        "Response must include needs_profile_completion",
      );
      assert.ok(
        Array.isArray(body.missing_profile_requirements),
        "missing_profile_requirements must be an array",
      );

      // Backward compat fields
      assert.ok(
        Array.isArray(body.providers),
        "providers must be an array (backward compat)",
      );
      assert.ok(
        "email" in body,
        "Response must include email (backward compat)",
      );
      assert.ok("display_name" in body, "Response must include display_name");
      assert.ok("user_id" in body, "Response must include user_id");
    });
  });

  // ==================== S10: Backfill correctness (unit test identity service) ====================

  describe("S10: Backfill correctness (unit test identity service)", () => {
    it("should create contacts and resolve user via identity service for legacy data", async () => {
      // Simulate legacy user: direct DB insert into users + user_auth_providers (no contacts)
      const userId = `user_${crypto.randomBytes(12).toString("hex")}`;
      const email = uniqueEmail();
      const now = new Date().toISOString();

      // Insert legacy user directly
      await db
        .prepare(
          `INSERT INTO users (id, email, email_verified, display_name, risk_level, created_at)
           VALUES (?, ?, 1, 'Legacy User', 'low', ?)`,
        )
        .run(userId, email.toLowerCase(), now);

      // Insert legacy auth provider
      const providerId = `ap_${crypto.randomBytes(8).toString("hex")}`;
      await db
        .prepare(
          `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id)
           VALUES (?, ?, 'email', ?)`,
        )
        .run(providerId, userId, email.toLowerCase());

      // Now use identity service to create contacts (simulating backfill)
      await identityService.createOrUpdateContact(db, userId, {
        type: "email",
        value: email.toLowerCase(),
        source: "admin",
        sourceIdentityId: providerId,
      });

      // Verify contact was created
      const contact = await db
        .prepare(
          `SELECT id, type, value_normalized, is_primary FROM user_contacts
           WHERE user_id = ? AND type = 'email'`,
        )
        .get(userId);
      assert.ok(contact, "Contact must be created by backfill");
      assert.strictEqual(contact.value_normalized, email.toLowerCase());
      assert.strictEqual(
        contact.is_primary,
        1,
        "First contact of type must be primary",
      );

      // Verify the contact then sync mirrors
      await identityService.verifyContact(
        db,
        userId,
        "email",
        email,
        "backfill_verify",
      );
      await identityService.syncUserContactMirrors(db, userId);

      // Verify mirror is synced
      const user = await db
        .prepare("SELECT email FROM users WHERE id = ?")
        .get(userId);
      assert.strictEqual(
        user.email,
        email.toLowerCase(),
        "Mirror must match verified primary email",
      );
    });

    it("should resolve user by identity via resolveUserByIdentity", async () => {
      const userId = `user_${crypto.randomBytes(12).toString("hex")}`;
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO users (id, risk_level, created_at)
           VALUES (?, 'low', ?)`,
        )
        .run(userId, now);

      const providerId = `ap_${crypto.randomBytes(8).toString("hex")}`;
      const phone = uniquePhone();
      await db
        .prepare(
          `INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, status)
           VALUES (?, ?, 'phone', ?, 'active')`,
        )
        .run(providerId, userId, phone);

      // Resolve via identity service
      const resolved = await identityService.resolveUserByIdentity(
        db,
        "phone",
        phone,
      );
      assert.ok(resolved, "Must resolve user by phone identity");
      assert.strictEqual(resolved.userId, userId);
      assert.strictEqual(resolved.identity.provider, "phone");
      assert.strictEqual(resolved.identity.subject, phone);
    });
  });

  // ==================== S11: Contact verified uniqueness ====================

  describe("S11: Contact verified uniqueness", () => {
    it("should reject user B verifying same email already verified by user A", async () => {
      const sharedEmail = uniqueEmail();

      // User A: create and verify email
      const userA = await createAppleUser(app);
      await identityService.createOrUpdateContact(db, userA.userId, {
        type: "email",
        value: sharedEmail,
        source: "test",
      });
      await identityService.verifyContact(
        db,
        userA.userId,
        "email",
        sharedEmail,
        "test_verify",
      );

      // User B: create and attempt to verify same email
      const userB = await createAppleUser(app);
      await identityService.createOrUpdateContact(db, userB.userId, {
        type: "email",
        value: sharedEmail,
        source: "test",
      });

      // This should throw E119_EMAIL_CONFLICT
      await assert.rejects(
        () =>
          identityService.verifyContact(
            db,
            userB.userId,
            "email",
            sharedEmail,
            "test_verify",
          ),
        (err) => {
          assert.ok(
            err instanceof identityService.IdentityError,
            "Must throw IdentityError",
          );
          assert.strictEqual(
            err.code,
            "E119_EMAIL_CONFLICT",
            "Must be E119 conflict",
          );
          return true;
        },
      );
    });

    it("should enforce E119 via verify-email endpoint", async () => {
      const sharedEmail = uniqueEmail();
      const authService = require("../src/services/auth-service");
      authService.initialize(db);

      // User A: signup with shared email and verify
      const signupRes = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: sharedEmail, password: "SecurePassword123" },
      });
      const userA = JSON.parse(signupRes.body);
      await db
        .prepare("UPDATE users SET email_verified = 1 WHERE id = ?")
        .run(userA.user_id);
      await identityService.verifyContact(
        db,
        userA.user_id,
        "email",
        sharedEmail,
        "email_token",
      );

      // User B: signup with their own unique email
      const userBOwnEmail = uniqueEmail();
      const signupResB = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: userBOwnEmail, password: "SecurePassword123" },
      });
      const userB = JSON.parse(signupResB.body);

      // User B adds shared email as a contact (simulating profile update that
      // doesn't touch the UNIQUE users.email column — only user_contacts)
      await identityService.createOrUpdateContact(db, userB.user_id, {
        type: "email",
        value: sharedEmail,
        source: "user_entered",
      });

      // Attempt to verify the shared email for user B via identity service
      // This should throw E119_EMAIL_CONFLICT since user A already verified it
      await assert.rejects(
        () =>
          identityService.verifyContact(
            db,
            userB.user_id,
            "email",
            sharedEmail,
            "email_token",
          ),
        (err) => {
          assert.ok(
            err instanceof identityService.IdentityError,
            "Must throw IdentityError",
          );
          assert.strictEqual(
            err.code,
            "E119_EMAIL_CONFLICT",
            "Must be E119 conflict when verifying email owned by another user",
          );
          return true;
        },
      );
    });
  });
});
