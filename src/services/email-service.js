/**
 * Email Service
 *
 * Transactional email sending via Resend.
 * Handles password reset and email verification emails.
 */

const { Resend } = require("resend");

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
  const safeMinutes = Math.max(1, Math.round((expiresDate - new Date()) / (1000 * 60)));

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
    shareUrl,
    claimPin,
    contentType,
    message,
    tags,
  } = payload;

  const noun = contentType === "poem" ? "poem" : "song";
  const subject = `You received a gifted ${noun} on ${config.appName}`;
  const safeSender = senderName || "Someone special";
  const safeMessage = typeof message === "string" ? message.trim() : "";
  const safeSenderHtml = escapeHtml(safeSender);
  const safeMessageHtml = escapeHtml(safeMessage);

  const { data, error } = await getClient().emails.send({
    from: config.fromEmail,
    to,
    subject,
    tags: Array.isArray(tags) ? tags : undefined,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Gift</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #b0763f; margin: 0;">${config.appName}</h1>
  </div>

  <h2 style="margin-top: 0;">A gift is waiting for you</h2>
  <p><strong>${safeSenderHtml}</strong> sent you a personalized ${noun}.</p>

  ${safeMessage ? `<p style="padding: 12px 14px; background: #f8f6f3; border-radius: 8px;"><strong>Message:</strong><br>${safeMessageHtml}</p>` : ""}

  <p><strong>Claim PIN:</strong> <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 2px;">${claimPin}</span></p>

  <div style="text-align: center; margin: 28px 0;">
    <a href="${shareUrl}" style="display: inline-block; background-color: #b0763f; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">
      Open Your Gift
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">For privacy and playback, open this gift in the ${config.appName} app.</p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;">
  <p style="color: #999; font-size: 12px; text-align: center;">
    © ${new Date().getFullYear()} ${config.appName}. All rights reserved.
  </p>
</body>
</html>
    `.trim(),
    text: `
${safeSender} sent you a personalized ${noun} on ${config.appName}.

${safeMessage ? `Message: ${safeMessage}\n` : ""}
Claim PIN: ${claimPin}
Open your gift: ${shareUrl}

For privacy and playback, open this gift in the ${config.appName} app.
    `.trim(),
  });

  if (error) {
    throw new Error(`Failed to send gift email: ${error.message}`);
  }

  return { messageId: data.id };
}

module.exports = {
  isConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendSecurityAlertEmail,
  sendGiftDeliveryEmail,
};
