# Goal: Full Feature Audit → Gap Fix → Test Loop (DB + Backend + Web) — COMPLETE (within local constraints)

**Scope:** DB, backend, web. iOS out of scope.
**Canonical artifacts:** `docs/feature-audit/` → `feature-tracker.csv` (178 features), `SUMMARY.md`, `VERIFICATION-RESULTS.md`, `TEST-BASELINE.md`, `fix-plan.md`.

## Phases 1–4: DONE

- P1 Discovery: 178 features → canonical CSV with user stories. ✅
- P2 Verify: specialist agents + direct code re-reading; ~95% of "P0/P1" were false positives. ✅
- P3 Fixes: 6 real product/code bugs fixed. ✅
- P4 Test loop: full suite **49 → 22 failures** (2420 pass, 10 skipped), every fix root-caused. ✅

## Real bugs fixed (committed)

1. GDPR `user_contacts` PII survived account deletion (soft-delete defeats CASCADE)
2. GDPR data-export endpoint `/auth/data-export` (Art. 20)
3. Apple `REFUND_REVERSED`/`DECLINED` → re-grant/ack (were DLQ'd)
4. Signup duplicate-email 500 → 409
5. Cancel-render wrote non-existent `track_versions.updated_at` (Postgres 42703)
6. `/auth/me` now surfaces unverified email via `primary_email`

## Test clusters fixed (root-caused, none weakened)

auth-api 14→27 (rate-limit DB store, signup 409, /auth/me, contact_email field, verified-state, per-test session) ·
poems (credit fixture) · share-player (Prettier quotes) · auth-service (session binding) · stt-config (admin FK seed) ·
security-units-4-11-12 (+ the real cancel-render bug) · story-to-track (stale positional indices) ·
music (kept ogene's rich descriptive prompt) · security-units-6-7-8 (enrollment burst limit) ·
hosting-hardening (/health host-exempt) · billing trial (free-base-grant fixture; base=2 per migration 117) ·
auth-race-condition (session binding — the concurrency guard works). Web-play tests skipped (feature disabled).

## Remaining 22 — BLOCKED, not unfinished

- **~21 credential-gated** (need API keys/network, NOT product bugs): writer/v3/\* (LLM `fetch failed`),
  app-store-connect (ASC P8 key `DECODER`), mvp-flow (providers).
- **1 model-routing DECISION (user)**: `artwork-vars-extractor` spec §6.4 wants the `simple` anthropic lane
  distinct from `vars_extractor` (Haiku 4.5). The discarded llm-provider change (simple→Haiku 3) would satisfy it;
  HEAD keeps them in sync. Re-apply that change OR update the test+spec. (Stashed change recoverable: `git stash list`.)

## Standing (optional)

- npm test split: integration set ≈ the credential-gated files; can wire `npm test` (hermetic) + `test:integration`.
- 13 commits on branch `fix/feature-audit-gaps`, nothing pushed.
