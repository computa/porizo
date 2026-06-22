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

## Phase 4 FINAL (updated): suite 49 -> 33 failures (2412/2452 pass)

After user decisions: /auth/me CODE fix (primary_email surfaces unverified contacts);
auth-api verification-token field (contact_email). Story-to-track, security-units cover
(+ real cancel-render bug), poems, stt-config, auth-service, share-player all fixed.

Remaining 33 — precisely diagnosed:

- ~18 CREDENTIAL-GATED: writer/v3/\* (LLM ECONNREFUSED), app-store-connect (ASC key),
  mvp-flow (providers), artwork-vars-extractor (LLM). Not bugs.
- 3 WEB-PLAY (disabled per product): sharing-security, receiver-session, gifts assert the
  web-play-ENABLED contract; web play is currently OFF (per-share web_stream_allowed=0 +
  appOnly). Recommend: update to disabled contract OR skip until re-enabled — USER pick.
- 2 MUSIC "ogene": registry STILL has ogene (support: weak); weak styles are intentionally
  fallback-routed so the literal name drops from the prompt + getStylePrompt isn't exported
  where the test imports it. Tests assert the literal "ogene" string — stale. Needs USER
  confirm on intended fix (registry contradicts the "dropped" answer).
- 2 auth-api: 1 cross-test interference (passes alone), 1 stale verified-state assertion.
- 2 billing-api: trial base-grant model (test bypasses createFreeEntitlements; base-grant
  amount question) — intricate billing, flagged not guessed.
- ~3 hosting-hardening (allowlist enforce), security-units-6-7-8, auth-race-condition
  (concurrency/flaky), blog-editorial (passes alone — interference).

(superseded) earlier line:

## Phase 4 FINAL: suite 49 -> 34 failures (2411/2452 pass); 1 REAL prod bug found+fixed

Fixed clusters: auth-api 14->24, poems 18->19, share-player 0->1, auth-service 42->44,
stt-config 21->23, security-units-4-11-12 17->20, story-to-track 1->4.
REAL BUG: cancel-render wrote non-existent track_versions.updated_at (PG 42703) — fixed.
Commits on branch: 7cc9c80, 4d942ea, a8eef2b, 491bf4c, 211a4db, d473ec4.

Remaining 34 (categorized):

- ~22 CREDENTIAL-GATED (can't fix locally): writer/v3/\* (LLM ECONNREFUSED),
  app-store-connect (ASC P8 key), mvp-flow (providers), artwork-vars-extractor (LLM).
- 6 DESIGN cluster (YOUR active app-only/PIN web-playback area): sharing-security,
  receiver-session, gifts (web_stream_url/app_required true-vs-false), auth-api /auth/me
  email contract (primary_email vs email).
- 2 music "ogene" — is the ogene style still supported? (registry/design call)
- ~4 INVESTIGATION: hosting-hardening (allowlist 200-vs-421), billing-api (trial 0-vs-2),
  security-units-6-7-8, auth-race-condition (concurrency/flaky), blog-editorial (interference).

## Phase 4 progress (fixing fixable clusters)

- [x] auth-api rate-limit test bug: clearRateLimits(db) → 14→24 of 27 (commit 4d942ea)
- [x] poems credit fixture: seed poems_remaining → 18→19 (commit a8eef2b)
- [ ] music "ogene" style guide (false vs true) — REAL-vs-STALE: is 'ogene' still a supported style? needs product call
- [ ] mvp-flow ai_voice/RVC (402) — integration; needs credits seed AND provider creds
- [ ] ~8 TBD clusters (security-units, hosting-hardening, sharing-security, story-to-track-contract, gifts, receiver-session, billing-api, blog-editorial)
- [ ] 2 auth-api: /auth/me email contract (test checks `email`, route returns `primary_email`; unverified signup contact) — design call

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
