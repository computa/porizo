# Goal: Full Feature Audit → Gap Fix → Test Loop (DB + Backend + Web)

**Scope:** Complete DB, backend, web. **iOS OUT of scope.**
**Artifacts:** `docs/feature-audit/` → `feature-tracker.csv` (178), `SUMMARY.md`, `fix-plan.md`, `VERIFICATION-RESULTS.md`, `TEST-BASELINE.md`.

---

## Phase 1 — Discovery ✅ 178 features, canonical CSV.

## Phase 2 — Verify ✅ 45 "P0/P1" → mostly false positives (existing guards). See VERIFICATION-RESULTS.md.

## Phase 3 — Fixes ✅ (nothing committed)

- [x] **user_contacts PII survives account deletion** (real GDPR bug) — DELETE added in deleteUserAccount.
- [x] **Apple REFUND_REVERSED/DECLINED** handlers (re-grant / ack) — were DLQ'd as unknown.
- [x] **GDPR data-export endpoint** `GET /auth/data-export` (Article 20) + `exportUserData()`.
- [x] **Signup duplicate-email returned 500 → now 409** (found via tests; unique-violation now caught).

## Phase 4 — Test loop ✅ (baseline established) — see TEST-BASELINE.md

- [x] Found `npm test` glob bug: ran ~590/2452 tests. True baseline: 2452 tests, **49 fail**.
- [x] Categorized 49: ~27 env-gated (LLM/ASC keys), ~5 fixture (credits), ~6 auth-api refresh test-infra, 1 real bug (FIXED), 2 stale tests (FIXED), ~8 TBD.
- [x] Fixed 2 pre-existing failing tests (verify-email binding; REFUND song count).
- Touched files green: apple-webhook 19/19, auth-identity 27/27, auth-api 14→15.

## Open (need user decision / credentials)

- [ ] `npm test` glob: split hermetic vs integration tests (design decision).
- [ ] ~27 env-gated failures: need API keys (Suno/ElevenLabs/ASC/LLM) or mocks to run.
- [ ] ~6 auth-api refresh/session test-infra cluster: isolated investigation.
- [ ] ~5 credit-fixture failures + ~8 TBD clusters: triage.
- [ ] GDPR export endpoint: add dedicated test.
- [ ] Live user-story testing (Phase 4 full): blocked on credentials.

## Phase 5/6 — pending the above.

---

### Pending user decision: uncommitted `llm-provider.js` reverts to deprecated `claude-3-haiku-20240307` (recommend discard); `AGENTS.md` timestamp churn. Nothing committed/pushed this session.
