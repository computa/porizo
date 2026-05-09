# No Song Mother's Day Campaign

Target: app users with valid email addresses who have not generated any successful song output.

Generation definition:

- Exclude users with any `tracks.status IN ('ready', 'preview_ready')`.
- Exclude users with any `track_versions.status IN ('full_ready', 'preview_ready', 'ready')`.

Suggested send flow:

1. Export a fresh cohort from production.
2. Send one test to `abcobimma@gmail.com`.
3. Confirm subject, rendering, cohort count, and exclusions.
4. Send only after explicit approval.

Subject: `Make a free Mother's Day song`

Preview: `Create a free personalized song gift before Mother's Day this Sunday.`
