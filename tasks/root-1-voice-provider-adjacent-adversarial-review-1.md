# Root 1 Voice-Provider Adjacent SQL — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex local adversarial pass
Scope: Adjacent `voice_provider_profiles` / `voice_provider_jobs` SQL moved
behind `voice-provider-profile-repository.js` and
`voice-provider-profile-service.js`.

## Files Reviewed

- `src/database/voice-provider-profile-repository.js` — owns remaining
  voice-provider profile/job persistence.
- `src/services/voice-provider-profile-service.js` — service facade over
  repository operations.
- `src/services/suno-voice-persona-service.js` — job execution revalidation and
  source-audio retry resets now call the service facade.
- `src/workflows/runner.js` — Suno persona lane due-job selection and heartbeat
  now call the service facade.
- `src/routes/enrollment.js` — voice-profile deletion audit prefetch now calls
  the service facade.
- `src/services/auth-service.js` — account deletion now lists/scrubs/deletes
  voice-provider rows through the service facade.
- `test/voice-provider-profile-repository.test.js`
- `test/suno-voice-persona-service.test.js`
- `test/auth-service.test.js`
- `test/critical-fixes.test.js`

## Attack Vectors Checked

1. Due-job selection accidentally includes future `next_attempt_at` jobs.
2. Due-job selection accidentally includes exhausted jobs.
3. Due-job selection accidentally includes non-Suno providers.
4. Due-job ordering changes and starves older pending jobs.
5. Runner starts more persona jobs than available concurrency slots.
6. Runner no longer disables the persona lane when the table is unavailable.
7. Heartbeat updates a job locked by another runner.
8. Heartbeat updates a terminal or non-running job.
9. Job/profile/session revalidation joins the wrong provider profile.
10. Job/profile mismatch reaches a provider call before failing.
11. Consent falls back to `consent_version` instead of scoped consent.
12. Deleted voice/profile state is missed during between-step rechecks.
13. Bad-source retry reset clears the wrong fields for same-task retry.
14. Fresh-cover retry reset leaves stale task/audio/upload fields.
15. Account deletion audit leaks remote persona/task/audio/source URL data.
16. Account deletion leaves voice-provider jobs behind.
17. Voice-profile deletion loses provider-profile local audit metadata.
18. The service facade changes status transition row-change semantics.
19. The production tree still contains direct `voice_provider_*` SQL outside the
    repository.
20. The new repository methods fail under the transaction-scoped DB adapter.

## Findings

### P3 — VERIFIED — Account-deletion comment overstated provider-row evidence retention

Scenario: `auth-service.deleteUserAccount()` scrubs provider-profile raw IDs and
then deletes `voice_profiles`. Because `voice_provider_profiles.voice_profile_id`
has `ON DELETE CASCADE`, provider-profile rows may be deleted after the scrub.
The durable evidence is the retained audit row, not the provider-profile row.

Smallest fix: update the comment to describe the real contract: raw provider IDs
are scrubbed before parent voice rows are deleted, and the retained audit row
keeps only local lifecycle metadata.

Status: fixed in this pass.

## Termination

P0 findings: 0
P1 findings: 0

This slice terminates for code-review-detectable P0/P1 issues. Remaining risk is
empirical: full-suite validation and production-adapter behavior should still be
validated by the normal `npm test` and deployment smoke gates.
