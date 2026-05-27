/**
 * Email Service
 *
 * Transactional email sending via Resend.
 * Handles password reset and email verification emails.
 */

const { Resend } = require("resend");
const { getStageCopy } = require("./share-followup-service");
const { buildUnsubscribeUrl } = require("../utils/unsubscribe-token");

// Configuration
const config = {
  apiKey: process.env.RESEND_API_KEY,
  fromEmail: process.env.RESEND_FROM_EMAIL || "Porizo <noreply@porizo.co>",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://porizo.co",
  appName: "Porizo",
};

/** Escape user-controlled strings for safe HTML interpolation */
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Resend client (lazy-initialized)
let resend = null;

/**
 * Get Resend client (lazy initialization)
 */
function getClient() {
  if (!resend) {
    if (!config.apiKey) {
      throw new Error("RESEND_API_KEY environment variable is required");
    }
    resend = new Resend(config.apiKey);
  }
  return resend;
}

/**
 * Check if email service is configured
 */
function isConfigured() {
  return Boolean(config.apiKey);
}

/**
 * Send password reset email
 * @param {string} email - Recipient email address
 * @param {string} token - Raw password reset token
 * @param {Date|string} expiresAt - Token expiration time
 */
async function sendPasswordResetEmail(email, token, expiresAt) {
  const resetUrl = `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const expiresDate = new Date(expiresAt);
  const safeMinutes = Math.max(
    1,
    Math.round((expiresDate - new Date()) / (1000 * 60)),
  );

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject: `Reset your ${config.appName} password`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">${config.appName}</h1>
  </div>

  <h2 style="margin-top: 0;">Reset Your Password</h2>

  <p>We received a request to reset your password. Click the button below to choose a new password:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${resetUrl}"
       style="display: inline-block; background-color: #7c3aed; color: white; text-decoration: none;
              padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Reset Password
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">
    This link will expire in ${safeMinutes} minutes. If you didn't request this reset,
    you can safely ignore this email.
  </p>

  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:
    <br><a href="${resetUrl}" style="color: #7c3aed; word-break: break-all;">${resetUrl}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  </p>
</body>
</html>
    `.trim(),
    text: `
Reset Your ${config.appName} Password

We received a request to reset your password.

Click this link to choose a new password:
${resetUrl}

This link will expire in ${safeMinutes} minutes.

If you didn't request this reset, you can safely ignore this email.

© ${new Date().getFullYear()} ${config.appName}
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }

  return { messageId: data.id };
}

/**
 * Send an admin-portal password reset email.
 *
 * Mirrors sendPasswordResetEmail but the link points at the admin SPA
 * (/admin/reset-password) and the copy makes the audience explicit. Kept
 * as a separate function — rather than parameterizing the existing one —
 * so a future copy/branding divergence doesn't risk leaking admin URLs to
 * end users (or vice versa).
 *
 * @param {string} email - Admin's email address
 * @param {string} token - Raw password reset token
 * @param {Date|string} expiresAt - Token expiration time
 */
async function sendAdminPasswordResetEmail(email, token, expiresAt) {
  const resetUrl = `${config.publicBaseUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
  const expiresDate = new Date(expiresAt);
  const safeMinutes = Math.max(
    1,
    Math.round((expiresDate - new Date()) / (1000 * 60)),
  );

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject: `Reset your ${config.appName} admin password`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Admin Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">${config.appName} Admin</h1>
  </div>

  <h2 style="margin-top: 0;">Reset Your Admin Password</h2>

  <p>We received a request to reset the password on your ${config.appName} admin account. Click the button below to choose a new password:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${resetUrl}"
       style="display: inline-block; background-color: #7c3aed; color: white; text-decoration: none;
              padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Reset Admin Password
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">
    This link will expire in ${safeMinutes} minutes. If you didn't request this reset,
    your account is still safe — ignore this email and the link will lapse.
  </p>

  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:
    <br><a href="${resetUrl}" style="color: #7c3aed; word-break: break-all;">${resetUrl}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. Admin access — authorized personnel only.
  </p>
</body>
</html>
    `.trim(),
    text: `
Reset Your ${config.appName} Admin Password

We received a request to reset the password on your ${config.appName} admin account.

Click this link to choose a new password:
${resetUrl}

This link will expire in ${safeMinutes} minutes.

If you didn't request this reset, your account is still safe — ignore this
email and the link will lapse.

© ${new Date().getFullYear()} ${config.appName} Admin
    `.trim(),
  });

  if (error) {
    throw new Error(
      `Failed to send admin password reset email: ${error.message}`,
    );
  }

  return { messageId: data.id };
}

/**
 * Send a confirmation/security-alert email after an admin password reset
 * completes. Lightweight by design — we don't want to surface IP or
 * user-agent details in email since they're easy to spoof and can mislead
 * the admin. The trigger fact ("your admin password just changed") is the
 * useful signal.
 *
 * @param {string} email
 * @param {{ event?: string, occurredAt?: Date|string }} [meta]
 */
async function sendAdminSecurityAlertEmail(email, meta = {}) {
  const occurredAt = meta.occurredAt ? new Date(meta.occurredAt) : new Date();
  const occurredLabel = occurredAt.toUTCString();

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject: `[${config.appName}] Your admin password was changed`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Password Changed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="margin-top: 0;">Your admin password was just changed</h2>

  <p>This is a confirmation that the password on your ${config.appName} admin account was just reset.</p>

  <p style="color: #666; font-size: 14px;">When: ${occurredLabel}</p>

  <p>If this was you, no further action is needed.</p>

  <p style="color: #b91c1c;">
    <strong>If this wasn't you:</strong> contact the ${config.appName} team immediately —
    your admin account may have been compromised.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName} Admin.
  </p>
</body>
</html>
    `.trim(),
    text: `
Your ${config.appName} admin password was just changed.

When: ${occurredLabel}

If this was you, no further action is needed.

If this wasn't you, contact the ${config.appName} team immediately — your
admin account may have been compromised.

© ${new Date().getFullYear()} ${config.appName} Admin
    `.trim(),
  });

  if (error) {
    throw new Error(
      `Failed to send admin security alert email: ${error.message}`,
    );
  }

  return { messageId: data.id };
}

/**
 * Send email verification email
 * @param {string} email - Recipient email address
 * @param {string} token - Raw verification token
 */
async function sendVerificationEmail(email, token) {
  const verifyUrl = `${config.publicBaseUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject: `Verify your ${config.appName} email`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">${config.appName}</h1>
  </div>

  <h2 style="margin-top: 0;">Verify Your Email Address</h2>

  <p>Thanks for signing up for ${config.appName}! Please verify your email address by clicking the button below:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${verifyUrl}"
       style="display: inline-block; background-color: #7c3aed; color: white; text-decoration: none;
              padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Verify Email
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:
    <br><a href="${verifyUrl}" style="color: #7c3aed; word-break: break-all;">${verifyUrl}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  </p>
</body>
</html>
    `.trim(),
    text: `
Verify Your ${config.appName} Email

Thanks for signing up for ${config.appName}!

Please verify your email address by clicking this link:
${verifyUrl}

© ${new Date().getFullYear()} ${config.appName}
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send verification email: ${error.message}`);
  }

  return { messageId: data.id };
}

/**
 * Send welcome email after successful registration
 * @param {string} email - Recipient email address
 * @param {string} name - User's display name
 */
async function sendWelcomeEmail(email, name) {
  const displayName = escapeHtml(name || "there");

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject: `Welcome to ${config.appName}! 🎵`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${config.appName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">${config.appName}</h1>
  </div>

  <h2 style="margin-top: 0;">Welcome, ${displayName}! 🎉</h2>

  <p>You're all set to create personalized songs for the people you love.</p>

  <p>Here's what you can do:</p>
  <ul>
    <li><strong>Enroll your voice</strong> – Record a few phrases so your songs sound like you</li>
    <li><strong>Create a song</strong> – Tell us who it's for and what occasion</li>
    <li><strong>Share the magic</strong> – Send your personalized song to someone special</li>
  </ul>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${config.publicBaseUrl}"
       style="display: inline-block; background-color: #7c3aed; color: white; text-decoration: none;
              padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Get Started
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">
    Questions? Just reply to this email – we're happy to help!
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  </p>
</body>
</html>
    `.trim(),
    text: `
Welcome to ${config.appName}, ${displayName}! 🎉

You're all set to create personalized songs for the people you love.

Here's what you can do:
- Enroll your voice – Record a few phrases so your songs sound like you
- Create a song – Tell us who it's for and what occasion
- Share the magic – Send your personalized song to someone special

Get started: ${config.publicBaseUrl}

Questions? Just reply to this email – we're happy to help!

© ${new Date().getFullYear()} ${config.appName}
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send welcome email: ${error.message}`);
  }

  return { messageId: data.id };
}

/**
 * Send security alert email (e.g., password changed, new device login)
 * @param {string} email - Recipient email address
 * @param {object} options - Alert details
 * @param {string} options.alertType - Type of alert: 'password_changed', 'new_device', 'account_locked'
 * @param {string} options.deviceInfo - Device/location info if applicable
 * @param {Date} options.timestamp - When the event occurred
 */
async function sendSecurityAlertEmail(email, options) {
  const { alertType, deviceInfo, timestamp } = options;
  const time = new Date(timestamp || Date.now()).toLocaleString();

  let subject, heading, message;

  switch (alertType) {
    case "password_changed":
      subject = `Your ${config.appName} password was changed`;
      heading = "Password Changed";
      message = `Your password was successfully changed on ${time}.`;
      break;
    case "new_device":
      subject = `New sign-in to your ${config.appName} account`;
      heading = "New Sign-In Detected";
      message = `A new device signed in to your account on ${time}.${deviceInfo ? ` Device: ${escapeHtml(deviceInfo)}` : ""}`;
      break;
    case "account_locked":
      subject = `Your ${config.appName} account has been locked`;
      heading = "Account Locked";
      message = `Your account was temporarily locked due to multiple failed login attempts. It will automatically unlock in 15 minutes.`;
      break;
    default:
      subject = `Security alert for your ${config.appName} account`;
      heading = "Security Alert";
      message = `A security-related event occurred on your account on ${time}.`;
  }

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to: email,
    subject,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #7c3aed; margin: 0;">${config.appName}</h1>
  </div>

  <h2 style="margin-top: 0;">🔒 ${heading}</h2>

  <p>${message}</p>

  <p style="color: #666; font-size: 14px;">
    If this wasn't you, please secure your account immediately by resetting your password.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">

  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  </p>
</body>
</html>
    `.trim(),
    text: `
${heading}

${message}

If this wasn't you, please secure your account immediately by resetting your password.

© ${new Date().getFullYear()} ${config.appName}
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send security alert email: ${error.message}`);
  }

  return { messageId: data.id };
}

/**
 * Send gift delivery email
 * @param {object} payload
 * @param {string} payload.to - Recipient email address
 * @param {string} payload.senderName - Display name of sender
 * @param {string} payload.shareUrl - Gift link
 * @param {string} payload.claimPin - Share PIN
 * @param {string} payload.contentType - "song" or "poem"
 * @param {string} [payload.message] - Optional sender message
 * @param {Array<{name: string, value: string}>} [payload.tags] - Optional provider tags
 */
async function sendGiftDeliveryEmail(payload) {
  const {
    to,
    senderName,
    recipientName,
    shareUrl,
    claimPin,
    contentType,
    contentTitle,
    occasion,
    message,
    tags,
  } = payload;

  const noun = contentType === "poem" ? "poem" : "song";
  const ctaLabel = contentType === "poem" ? "Read Your Poem" : "Listen Now";
  const contentIcon = contentType === "poem" ? "&#128214;" : "&#9835;";
  const safeSender = senderName || "A friend";
  const safeRecipient =
    typeof recipientName === "string" ? recipientName.trim() : "";
  const safeMessage = typeof message === "string" ? message.trim() : "";
  const safeTitle = typeof contentTitle === "string" ? contentTitle.trim() : "";
  const safeOccasion = typeof occasion === "string" ? occasion.trim() : "";
  const safeSenderHtml = escapeHtml(safeSender);
  const safeRecipientHtml = escapeHtml(safeRecipient);
  const safeMessageHtml = escapeHtml(safeMessage);
  const safeTitleHtml = escapeHtml(
    safeTitle || `A ${noun} for ${safeRecipient || "you"}`,
  );
  const safeOccasionHtml = escapeHtml(safeOccasion);

  const subject = safeRecipient
    ? `${safeRecipient}, ${safeSender} made you a ${noun} 🎁`
    : `${safeSender} made you a ${noun} 🎁`;
  const subheading = safeRecipient
    ? `A personal gift is waiting for you, ${safeRecipientHtml}.`
    : "A personal gift is waiting for you.";

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to,
    subject,
    tags: Array.isArray(tags) ? tags : undefined,
    html: `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Gift</title>
</head>
<body style="margin:0; padding:0; background:#F5F0EB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
<center>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F0EB;">
<tr><td align="center" style="padding: 24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#FFFAF5; border-radius:16px; overflow:hidden;">

  <tr><td align="center" style="padding: 32px 40px 16px;">
    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; color: #B0763F; letter-spacing: 1px;">${config.appName}</span>
  </td></tr>

  <tr><td align="center" style="padding: 8px 40px 4px;">
    <span style="font-size: 48px;">&#127873;</span>
  </td></tr>

  <tr><td align="center" style="padding: 12px 40px 8px;">
    <h1 style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: normal; color: #1A1A1A; line-height: 1.3;">
      ${safeSenderHtml} made you a ${noun}
    </h1>
  </td></tr>

  <tr><td align="center" style="padding: 0 40px 24px;">
    <p style="margin:0; font-size: 15px; color: #666666; line-height: 1.5;">${subheading}</p>
  </td></tr>

  ${
    safeMessage
      ? `
  <tr><td style="padding: 0 40px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="border-left: 3px solid #D4A574; padding: 16px 20px; background: #F8F6F3; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 16px; color: #1A1A1A; line-height: 1.6;">
          &ldquo;${safeMessageHtml}&rdquo;
        </p>
        <p style="margin: 0; font-size: 13px; color: #999999;">&mdash; ${safeSenderHtml}</p>
      </td></tr>
    </table>
  </td></tr>`
      : ""
  }

  <tr><td style="padding: 0 40px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #E8E0D8; border-radius: 12px; overflow: hidden;">
      <tr><td style="padding: 16px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="48" valign="top">
              <div style="width: 48px; height: 48px; border-radius: 10px; background: linear-gradient(135deg, #D4A574, #B0763F); text-align: center; line-height: 48px;">
                <span style="font-size: 22px; color: white;">${contentIcon}</span>
              </div>
            </td>
            <td style="padding-left: 14px;" valign="middle">
              <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #1A1A1A;">${safeTitleHtml}</p>
              ${safeOccasion ? `<p style="margin: 0;"><span style="display: inline-block; padding: 2px 10px; background: #FFF3E8; border-radius: 12px; font-size: 12px; color: #B0763F; font-weight: 500;">${safeOccasionHtml}</span></p>` : ""}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding: 0 40px 16px;">
    <a href="${escapeHtml(shareUrl)}" style="display: inline-block; background: #B0763F; color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 17px; font-weight: 600; letter-spacing: 0.3px;">
      ${ctaLabel}
    </a>
  </td></tr>

  <tr><td align="center" style="padding: 8px 40px 8px;">
    <p style="margin: 0; font-size: 14px; color: #666666;">
      Your claim PIN: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 3px; font-weight: 600; color: #1A1A1A; font-size: 16px;">${claimPin}</span>
    </p>
  </td></tr>
  <tr><td align="center" style="padding: 0 40px 32px;">
    <p style="margin: 0; font-size: 12px; color: #999999;">You'll need this PIN to unlock your gift in the app.</p>
  </td></tr>

  <tr><td style="padding: 0 40px;"><div style="height: 1px; background: #E8E0D8;"></div></td></tr>

  <tr><td align="center" style="padding: 20px 40px 28px;">
    <p style="margin: 0; font-size: 12px; color: #BBBBBB; line-height: 1.6;">
      Sent with love via <a href="https://porizo.co" style="color: #B0763F; text-decoration: none;">${config.appName}</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</center>
</body>
</html>
    `.trim(),
    text: `
${safeSender} made you a ${noun} on ${config.appName}.
${safeMessage ? `\n"${safeMessage}"\n` : ""}
Claim PIN: ${claimPin}
Open your gift: ${shareUrl}

You'll need the PIN to unlock your gift in the ${config.appName} app.
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send gift email: ${error.message}`);
  }

  return { messageId: data.id };
}

/**
 * Send a stage of the share-followup sequence. Driven by the stage copy
 * registry in share-followup-service so the sequence's source of truth
 * lives in one place. See docs/plans/2026-05-22-share-email-followup-sequence.md.
 *
 * @param {{ to: string, senderName?: string, recipientName?: string, trackTitle?: string, shareUrl?: string, stage: string }} payload
 * @returns {Promise<{ messageId: string | null }>}
 */
async function sendShareFollowupEmail(payload) {
  const {
    to,
    senderUserId,
    senderName,
    recipientName,
    trackTitle,
    shareUrl,
    stage,
  } = payload || {};
  const copy = getStageCopy(stage);
  if (!copy) {
    throw new Error(`Unknown share-followup stage: ${stage}`);
  }

  // One-click unsubscribe (footer link + RFC 8058 headers). Lifecycle emails
  // must offer opt-out; senderUserId identifies the recipient to suppress.
  const unsubscribeUrl = senderUserId
    ? buildUnsubscribeUrl(config.publicBaseUrl, senderUserId)
    : "";

  const safeSender =
    typeof senderName === "string" && senderName.trim()
      ? senderName.trim()
      : "";
  const safeRecipient =
    typeof recipientName === "string" && recipientName.trim()
      ? recipientName.trim()
      : "";
  const safeTitle =
    typeof trackTitle === "string" && trackTitle.trim()
      ? trackTitle.trim()
      : "";

  const ctaHref = /^https?:\/\//i.test(copy.ctaPath)
    ? copy.ctaPath
    : `${config.publicBaseUrl}${copy.ctaPath}`;

  const greeting = safeSender ? `Hi ${escapeHtml(safeSender)},` : "Hi,";
  const contextLine =
    safeRecipient && safeTitle
      ? `<p style="margin:0 0 16px; color:#4a4a4a; font-size:14px;">About the song you made for ${escapeHtml(safeRecipient)}${safeTitle ? ` (&ldquo;${escapeHtml(safeTitle)}&rdquo;)` : ""}.</p>`
      : "";

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to,
    subject: copy.subject,
    tags: [
      { name: "category", value: "share_followup" },
      { name: "stage", value: stage },
    ],
    ...(unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
    html: `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0; padding:0; background:#F5F0EB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
<center>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F0EB;">
<tr><td align="center" style="padding: 24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#FFFAF5; border-radius:16px; overflow:hidden;">
  <tr><td align="center" style="padding: 28px 40px 8px;">
    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; color: #B0763F; letter-spacing: 1px;">${escapeHtml(config.appName)}</span>
  </td></tr>
  <tr><td style="padding: 12px 40px 4px;">
    <h1 style="margin:0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: normal; color: #1A1A1A; line-height: 1.3;">${escapeHtml(copy.headline)}</h1>
  </td></tr>
  <tr><td style="padding: 8px 40px 4px;">
    <p style="margin:0 0 12px; font-size:15px; color:#1A1A1A;">${greeting}</p>
    ${contextLine}
    <p style="margin:0 0 20px; font-size:15px; color:#1A1A1A; line-height:1.55;">${escapeHtml(copy.body)}</p>
  </td></tr>
  <tr><td align="center" style="padding: 8px 40px 32px;">
    <a href="${escapeHtml(ctaHref)}" style="display:inline-block; padding:14px 28px; background:#B0763F; color:#FFFAF5; text-decoration:none; border-radius:999px; font-size:15px; font-weight:500;">${escapeHtml(copy.cta)}</a>
  </td></tr>
  ${
    shareUrl
      ? `<tr><td align="center" style="padding: 0 40px 24px;"><a href="${escapeHtml(shareUrl)}" style="font-size:13px; color:#888; text-decoration:underline;">Open the share link</a></td></tr>`
      : ""
  }
  <tr><td align="center" style="padding: 0 40px 28px; border-top:1px solid #EFE6DC;">
    <p style="margin:18px 0 4px; font-size:11px; color:#a09080;">You're receiving this because you created a song share on Porizo. <a href="${escapeHtml(config.publicBaseUrl)}/settings/notifications" style="color:#a09080;">Manage notifications</a>${unsubscribeUrl ? ` or <a href="${escapeHtml(unsubscribeUrl)}" style="color:#a09080;">unsubscribe</a>` : ""}.</p>
  </td></tr>
</table>
</td></tr>
</table>
</center>
</body>
</html>`,
  });

  if (error) {
    console.error(`Share-followup ${stage} email failed:`, error);
    return { messageId: null };
  }

  return { messageId: data ? data.id : null };
}

module.exports = {
  isConfigured,
  sendPasswordResetEmail,
  sendAdminPasswordResetEmail,
  sendAdminSecurityAlertEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendSecurityAlertEmail,
  sendGiftDeliveryEmail,
  sendShareFollowupEmail,
};
