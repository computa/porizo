---
name: porizo-user-email-campaign
description: Plan, query, design, send, and check targeted Porizo user email campaigns. Use when Codex needs to email a cohort of Porizo users through Resend, including asking Ambrose for the cohort, brainstorming the message, filtering production DB recipients, writing HTML/text email content, sending through Resend MCP or CLI, and checking sent email status.
---

# Porizo User Email Campaign

## Operating Rules

Treat every run as a live user communication workflow. Do not send any email until Ambrose explicitly approves the final cohort, subject, body, sender, and send count.

Use this loop every time:

1. Ask Ambrose which cohort to target.
2. Brainstorm the topic, promise, tone, and call to action with Ambrose.
3. Query the DB read-only and produce recipient counts plus a small redacted sample.
4. Draft both HTML and plain-text email.
5. Send one test email to Ambrose first.
6. Review Resend deliverability insights on the test email and fix any `Needs attention` items before cohort send.
7. After approval, send the cohort email through Resend MCP when available, otherwise the Resend CLI.
8. Check delivery status/logs and report IDs, counts, failures, and next actions.

Never infer a sensitive cohort from protected traits. Use product behavior cohorts, for example recent signups, created one song, no song yet, voice enrolled, subscription tier, inactive after signup, Apple Ads users, country, or app-version-related cohorts.

## Required Questions

Ask these before querying or drafting:

- Cohort: who should receive it and who should be excluded?
- Goal: what user behavior or product outcome should the email drive?
- Message: what should the email say, and what should it not say?
- CTA: app open, reply, finish song, enroll voice, try My Voice, update app, or feedback?
- Send mode: test only, small pilot, or full cohort after approval?

If Ambrose gives a vague cohort, propose 2-4 precise SQL-friendly cohort definitions and ask him to pick one.

## Cohort Query

Read [cohort-sql.md](references/cohort-sql.md) before writing production SQL.

Use Railway remote execution for production DB access unless a first-class DB connection is already available in the current environment. Prefer read-only queries until final send bookkeeping is explicitly requested.

For every cohort query:

- Select `user_id`, normalized `email`, `display_name`, and useful segmentation fields.
- Require a valid email.
- Exclude deleted, locked, bounced, unsubscribed, and obvious test/reviewer accounts unless Ambrose explicitly asks otherwise.
- Deduplicate by normalized email.
- Limit preview queries first.
- Produce a count query before exporting the full recipient list.

Do not paste full recipient lists into chat. Report counts and a redacted sample such as `a***@gmail.com`.

## Email Design

Read [email-design.md](references/email-design.md) before composing HTML.

Draft:

- Subject: short, specific, no clickbait.
- Preview text: one sentence under 90 characters.
- Plain text: complete fallback with CTA URL.
- HTML: responsive, inline CSS, Porizo tone, single primary CTA, support footer.
- Sender: use a real reply-capable identity. Prefer `Ambrose from Porizo <support@porizo.co>` unless Ambrose requests a different verified sender.
- Links: keep CTA and product links on the sending domain (`porizo.co`) whenever possible, using a Porizo redirect/landing URL for App Store opens. External links are acceptable only when necessary and should be minimized.
- Images: host remote images on the sending domain, or attach brand images inline with CID for one-off sends and tests.

Do not use `noreply@porizo.co` or any "no-reply" sender. Use `support@porizo.co` as reply-to unless Ambrose asks for a different verified address.

Avoid overpromising AI voice quality, guarantees, or timelines. For product follow-up, ask for experience and make replying easy.

## Deliverability Insight Checklist

Before any real cohort send, inspect the Resend test email insights and resolve all `Needs attention` items. At minimum verify:

- Link URLs match the sending domain where possible. If the sender is `@porizo.co`, prefer `https://porizo.co/...` links over direct third-party links such as App Store URLs.
- Sender is not `no-reply` or `noreply`.
- Images are hosted on `porizo.co` or attached inline with CID.
- Plain-text version is present.
- Email body size is small.
- SVG images are avoided.
- Custom click/open tracking domains are configured and passing when visible in Resend.
- DMARC is valid.

Treat `Possible improvements` as recommendations, but fix `Needs attention` before sending unless Ambrose explicitly approves proceeding.

## Sending

Prefer the Resend MCP server if the `resend` MCP tools are available in the active session:

- Use `send-email` for one-off/test messages or small explicitly approved batches.
- Use Resend contact/broadcast tools only when the current API key has full access and Ambrose approves list management.
- Check sent emails with MCP list/get tools when available.

Fallback to CLI when MCP tools are unavailable:

```bash
resend emails send --from "Ambrose from Porizo <support@porizo.co>" --to "<recipient>" --subject "<subject>" --text "<plain text>"
```

For multiple recipients, prefer batch JSON and `resend emails batch --file <file>`. Keep generated recipient files under `/tmp` unless Ambrose asks to persist campaign artifacts.

Always send a test to Ambrose before the real cohort. For cohorts above 50 recipients, recommend a pilot batch first.

## Post-Send Checks

After sending:

- Capture Resend email IDs or batch IDs.
- Check status for at least the test email.
- Summarize sent count, skipped count, failures, and provider errors.
- If updating campaign/engagement tables, use explicit campaign IDs and record only after successful sends.
- If there are failures, do not retry blindly; classify them first.

## Safety Defaults

If there is uncertainty about consent or unsubscribe status, pause and ask Ambrose.

If the Resend key is sending-only, sending still works, but domain/contact/broadcast/log-management tools may fail. Use the CLI/MCP email send and email get/list tools only, or ask Ambrose for a full-access key if list management is required.
