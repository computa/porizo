#!/usr/bin/env node
/**
 * One-off test send for the cold-intro template.
 *
 *   railway run --service porizo -- node scripts/test-cold-email-send.js [email]
 *
 * Pulls RESEND_API_KEY from the injected Railway env, substitutes
 * {{first_name}} in both html + text, and POSTs a single Resend email
 * to the recipient (defaults to abcobimma@gmail.com). Tagged so it doesn't
 * pollute the real campaign cohort.
 *
 * Does NOT touch the cold_email_recipients table — totally side-effect-free
 * relative to the daily sender.
 */

const fs = require("node:fs");
const path = require("node:path");

const RECIPIENT = process.argv[2] || "abcobimma@gmail.com";
const FIRST_NAME = process.argv[3] || "Ambrose";

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error(
    "RESEND_API_KEY missing — run via `railway run --service porizo`",
  );
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const htmlTpl = fs.readFileSync(
  path.join(root, "marketing/email/cold-intro.html"),
  "utf8",
);
const textTpl = fs.readFileSync(
  path.join(root, "marketing/email/cold-intro.txt"),
  "utf8",
);

const CAMPAIGN_ID = process.argv[4] || "mothers-day-2026";
const html = htmlTpl
  .replaceAll("{{campaign}}", CAMPAIGN_ID)
  .replaceAll("{{first_name}}", FIRST_NAME);
const text = textTpl
  .replaceAll("{{campaign}}", CAMPAIGN_ID)
  .replaceAll("{{first_name}}", FIRST_NAME);

const payload = {
  from: "Ambrose from Porizo <support@porizo.co>",
  to: [RECIPIENT],
  reply_to: "support@porizo.co",
  subject: "[TEST] A song from one memory",
  html,
  text,
  tags: [
    { name: "campaign", value: "cold-intro-test" },
    { name: "cohort", value: "preview" },
  ],
};

(async () => {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    console.log(`http=${res.status}`);
    console.log(body);
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error("error:", err.message);
    process.exit(1);
  }
})();
