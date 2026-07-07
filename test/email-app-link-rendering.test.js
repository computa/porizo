"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const originalEnv = { ...process.env };
const resendPath = require.resolve("resend");
const originalResendModule = require.cache[resendPath];

afterEach(() => {
  delete require.cache[require.resolve("../src/services/email-service")];
  if (originalResendModule) {
    require.cache[resendPath] = originalResendModule;
  } else {
    delete require.cache[resendPath];
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function loadEmailService() {
  const sent = [];
  process.env.RESEND_API_KEY = "re_mock_email_links";
  process.env.PUBLIC_BASE_URL = "https://test.porizo.co";
  process.env.JWT_SECRET = "test-jwt-secret-email-app-link-rendering";

  delete require.cache[resendPath];
  require.cache[resendPath] = {
    id: resendPath,
    filename: resendPath,
    loaded: true,
    exports: {
      Resend: class MockResend {
        constructor() {
          this.emails = {
            send: async (payload) => {
              sent.push(payload);
              return { data: { id: "email_mock" }, error: null };
            },
          };
        }
      },
    },
  };

  delete require.cache[require.resolve("../src/services/email-service")];
  const emailService = require("../src/services/email-service");
  return { emailService, sent };
}

test("welcome email CTA opens the native create flow through /download intent", async () => {
  const { emailService, sent } = loadEmailService();

  await emailService.sendWelcomeEmail("user@example.com", "Ambrose");

  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /href="https:\/\/test\.porizo\.co\/download\?intent=create_song&amp;/);
  assert.match(sent[0].text, /Get started: https:\/\/test\.porizo\.co\/download\?intent=create_song&/);
});

test("share follow-up primary and secondary CTAs use app-open intents", async () => {
  const { emailService, sent } = loadEmailService();

  await emailService.sendShareFollowupEmail({
    to: "sender@example.com",
    senderUserId: "user_1",
    senderName: "Ambrose",
    recipientName: "Chioma",
    trackTitle: "A Thank You Song",
    shareUrl: "https://porizo.co/play/share_123",
    stage: "sender_7d",
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /href="https:\/\/test\.porizo\.co\/download\?intent=create_song&amp;/);
  assert.match(sent[0].html, /utm_campaign=sender_7d/);
  assert.match(sent[0].html, /utm_content=start_song_cta/);
  assert.match(sent[0].html, /intent=open_share&amp;share_id=share_123&amp;content_kind=song/);
});

test("gift delivery email maps gift URLs to app-open share intents", async () => {
  const { emailService, sent } = loadEmailService();

  await emailService.sendGiftDeliveryEmail({
    to: "recipient@example.com",
    senderName: "Ambrose",
    recipientName: "Sarah",
    shareUrl: "https://porizo.co/g/gift_123",
    claimPin: "123456",
    contentType: "song",
    contentTitle: "A Song for Sarah",
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /intent=open_share&amp;share_id=gift_123&amp;content_kind=song/);
  assert.match(sent[0].text, /Open your gift: https:\/\/test\.porizo\.co\/download\?intent=open_share&/);
});
