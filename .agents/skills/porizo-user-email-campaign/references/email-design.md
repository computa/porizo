# Porizo Email Design Reference

Use a warm, concise, founder/product tone. The email should feel like a useful follow-up, not a newsletter.

## Deliverability Defaults

Use these defaults unless Ambrose explicitly overrides them:

- From: `Ambrose from Porizo <support@porizo.co>`.
- Reply-To: `support@porizo.co`.
- Never use `noreply@porizo.co` or any "no-reply" sender.
- Prefer `https://porizo.co/...` CTA/product links because link URLs should match the `porizo.co` sending domain.
- Use a Porizo-owned redirect or landing URL for App Store opens instead of direct App Store links where possible.
- Host images on `porizo.co`, or attach the brandmark inline with CID for test and one-off sends.
- Keep a complete plain-text version.
- Avoid SVG images in email body.

## Structure

1. Preview text.
2. Greeting using first name when available.
3. One reason for writing.
4. One useful detail or question.
5. One primary CTA.
6. Reply/support footer.

## HTML Shell

Use inline CSS because email clients strip styles:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{subject}}</title>
  </head>
  <body style="margin:0;background:#f7f2ec;color:#26211d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      {{preview_text}}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2ec;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffaf4;border:1px solid #eadfd3;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 8px;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.15;color:#30251f;">Porizo</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px;font-size:16px;line-height:1.6;color:#3b332d;">
                {{body_html}}
                <p style="margin:28px 0;">
                  <a href="{{cta_url}}" style="display:inline-block;background:#c96543;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 20px;font-weight:700;">
                    {{cta_label}}
                  </a>
                </p>
                <p style="margin:20px 0 0;color:#6f6259;font-size:14px;">
                  You can reply to this email if anything felt confusing or broken.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f1e6dc;color:#75685f;font-size:12px;line-height:1.5;">
                Porizo, Acuoos Pty Ltd<br>
                Support: <a href="mailto:support@porizo.co" style="color:#8a4f39;">support@porizo.co</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

## Copy Defaults

For recent signup follow-up:

- Subject: `How did your Porizo song go?`
- Preview: `A quick check-in on your song gift experience.`
- CTA: `Open Porizo`
- CTA URL: prefer `https://porizo.co/download` or the current Porizo-owned app-open redirect.

For incomplete first song:

- Subject: `Want help finishing your first song?`
- Preview: `Your song gift can still be finished in a few taps.`
- CTA: `Finish your song`
- CTA URL: prefer `https://porizo.co/download` or the current Porizo-owned app-open redirect.

For voice enrollment:

- Subject: `Your voice setup is ready to try`
- Preview: `Try making a song in your own voice.`
- CTA: `Try My Voice`
- CTA URL: prefer `https://porizo.co/download` or the current Porizo-owned app-open redirect.

## Plain Text

Always include a complete plain-text version:

```text
Hi {{name_or_there}},

{{reason}}

{{main_message}}

{{cta_label}}: {{cta_url}}

You can reply to this email if anything felt confusing or broken.

Porizo
Support: support@porizo.co
```
