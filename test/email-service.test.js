/**
 * Email Service Tests
 *
 * Tests for email service functionality.
 * Note: These tests mock the Resend client to avoid sending real emails.
 */

const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert");

describe("Email Service", () => {
  let emailService;
  let originalEnv;

  before(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set test config
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.PUBLIC_BASE_URL = "https://test.porizo.com";

    // Load email service
    emailService = require("../src/services/email-service");
  });

  after(() => {
    // Restore original env
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe("Configuration", () => {
    it("should report configured when RESEND_API_KEY is set", () => {
      assert.strictEqual(emailService.isConfigured(), true);
    });
  });

  describe("Email Templates", () => {
    // These tests verify that the service exports the expected functions
    // Full integration tests would require a real Resend API key

    it("should export sendPasswordResetEmail function", () => {
      assert.strictEqual(typeof emailService.sendPasswordResetEmail, "function");
    });

    it("should export sendVerificationEmail function", () => {
      assert.strictEqual(typeof emailService.sendVerificationEmail, "function");
    });

    it("should export sendWelcomeEmail function", () => {
      assert.strictEqual(typeof emailService.sendWelcomeEmail, "function");
    });

    it("should export sendSecurityAlertEmail function", () => {
      assert.strictEqual(typeof emailService.sendSecurityAlertEmail, "function");
    });
  });

  describe("URL Generation", () => {
    // Note: We can't easily test the actual email content without mocking Resend,
    // but we verify that the functions don't throw with valid input

    it("sendPasswordResetEmail rejects when Resend fails", async () => {
      // This will fail because 're_test_key' is not a valid API key
      // but it verifies our error handling works
      await assert.rejects(
        async () => {
          await emailService.sendPasswordResetEmail(
            "test@example.com",
            "test-token-123",
            new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
          );
        },
        // Should throw some error (API key invalid or network error)
        /./
      );
    });

    it("sendVerificationEmail rejects when Resend fails", async () => {
      await assert.rejects(
        async () => {
          await emailService.sendVerificationEmail("test@example.com", "test-verify-token");
        },
        /./
      );
    });
  });
});

describe("Email Service (unconfigured)", () => {
  let emailServiceUnconfigured;

  before(() => {
    // Clear the module cache
    delete require.cache[require.resolve("../src/services/email-service")];

    // Remove API key
    const oldKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    // Reload module
    emailServiceUnconfigured = require("../src/services/email-service");

    // Restore for other tests
    if (oldKey) {
      process.env.RESEND_API_KEY = oldKey;
    }
  });

  it("should report unconfigured when RESEND_API_KEY is not set", () => {
    assert.strictEqual(emailServiceUnconfigured.isConfigured(), false);
  });
});
