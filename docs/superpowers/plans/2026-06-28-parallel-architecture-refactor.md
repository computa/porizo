# Parallel Architecture Refactor Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the architecture refactor from the committed `refactor` branch by terminating Root 1 repository extraction first, then advancing the gated roots in small, mergeable, validated slices.

**Architecture:** The controller stays on branch `refactor` and integrates short-lived worker branches. Route, service, job, and workflow files should stop owning persistence; they should own HTTP/workflow orchestration, validation, authorization, response shaping, and provider/service calls. Persistence moves behind aggregate repositories that accept the injected `db`, follow existing repository patterns, and preserve current wire behavior.

**Tech Stack:** Node.js CommonJS, Fastify, sql.js/PostgreSQL-compatible database adapters, Node built-in test runner, ESLint, Git worktrees, Codex multi-agent workers.

---

## Current Baseline

- Branch: `refactor`
- Refactor baseline commit: `43d8d9dd refactor: extract repository architecture boundaries`
- Previous baseline before refactor program: `89a349ff docs(audit): per-feature post-fix test coverage map (178 features)`
- Current working-tree requirement before each worker wave: `git status --short` prints no tracked changes except the controller's active integration edits.
- Current Root 1 scan target:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows
```

Root 1 is complete only when that scan has no direct persistence hits outside comments that describe an injected database contract. Repository files under `src/database/**` may continue to own SQL.

### Current Execution Update - 2026-06-28

- Root 1 is complete locally. The final runner wave moved voice-profile, app-config, stale-recovery, step-history, DLQ, fairness, track/version, risk/audit, and job-lifecycle persistence behind repositories/services.
- The Root 1 gate is clean: `rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows` returns no matches.
- Full-suite validation exposed and fixed a post-extraction runner race: manual `await runner.tick()` now waits for dispatched jobs to settle, while interval-driven production ticks keep background dispatch. Focused validation passes for `test/critical-fixes.test.js` and adjacent runner workflow suites.
- Fresh agents from the runner wave were closed after completion. One older stale MCP-side agent remains unresponsive and is not part of the active execution queue.
- Root 4 Slice 1 is committed: `fetchResponse` centralizes provider HTTP response retries and aborting timeouts; Whisper transcription/alignment and ElevenLabs voice clone/delete/conversion/listing use it. A review agent caught timeout and non-idempotent retry risks before commit; the patch now aborts timed-out attempts, does not retry timeouts by default, and keeps voice clone/delete retries opt-in to avoid duplicate remote resources.
- Root 4 Slice 2 is committed: `61fb9d9b refactor: centralize provider boot config`. `src/providers/provider-config.js` centralizes boot-time provider and storage runtime config for both `server.js` and `worker.js`. This removes server/worker drift around ElevenLabs music availability, Replicate RVC/Demucs fields, HF token, and storage S3/KMS/upload-signing config. Focused provider/storage validation, lint, diff check, and the full `npm test` suite passed before commit (2,938 pass / 23 skipped / 0 fail).
- Root 4 Slice 3 routes `/health/providers` through the same normalized provider-config factory instead of direct `process.env` reads, and pins the admin route guard so valid admin access cannot hide a 500 behind a loose auth assertion.
- Root 4 Slice 4 centralizes `music_provider_config` defaults, JSON parsing, lenient persisted-read normalization, strict admin patch validation, Suno-only routing normalization, Suno model allowlisting, reroll clamps, and style override sanitation in `src/providers/provider-config.js`; admin-service and runner now consume the same helpers.
- Root 4 Slice 5 moves Whisper/OpenAI transcription credentials into normalized provider runtime config. Story audio routes and runner lyric alignment now pass explicit Whisper config, and `src/providers/whisper.js` no longer reads `process.env.OPENAI_API_KEY` directly.
- Root 4 Slice 6 replaces provider-side manual local track-version directory construction in `music.js` and `suno.js` with the shared `getVersionDir()` helper.
- Root 4 Slice 7 replaces runner-side manual local track-version directory construction with `getVersionDir()` in S3 upload, placeholder output, DLQ auto-reprocess cleanup, ready cover generation, ready lyric alignment, and ready cleanup paths. The storage path scan for `path.join(storageDir, "tracks", ...)` is now clean across providers and runner.
- Root 4 Slice 10 routes Suno provider audio artifact downloads through
  `fetchResponse`, adding aborting timeout and retryable 502/503/504 handling
  to the remaining raw provider download path.
- Root 3b gift extraction is in progress locally: gift delivery helpers, provider dispatch, webhooks, route registration, and gift runtime startup moved from `server.js` into `src/plugins/gift-delivery.js`. Registration is intentionally synchronous from `buildServer()` to preserve existing direct test/runtime decorators such as `app.dispatchGiftById()` and `app.expireGiftReservations()`.
- Root 5 step-handler extraction is committed. Step handlers now live under
  `src/workflows/steps/`, `runner.js` owns orchestration, and the remaining
  Root 5 cleanup candidate is the Suno polling/recovery helper pair.
- Root 6 Step 1 moved public mobile app-config composition out of
  `AdminService` into `src/services/client-config-service.js`; the later Root 6
  facade-reduction pass removed the legacy compatibility delegate.
- Root 6 Step 1 is committed as `f6faea73`. The next Root 6 slice extracted
  the read-only admin metrics routes into `src/routes/admin/metrics.js` and
  added route-level coverage for `/admin/dashboard/metrics/jobs`.
- Root 6 metrics route split is committed as `b2ab7f3b`. The next Root 6 slice
  extracted the read-only admin story-session routes into
  `src/routes/admin/story-sessions.js` and tightened route coverage for auth,
  default ordering, and detail payload shape.
- Root 6 story-session route split is committed as `f5bf0f3a`. The next Root 6
  slice extracted admin moderation queue/override routes into
  `src/routes/admin/moderation.js` and tightened route coverage for
  unauthenticated access plus superadmin-only override behavior.
- Root 6 moderation route split is committed as `4d1874ea`. The next Root 6
  slice extracted the read-only music diagnostics route into
  `src/routes/admin/music-diagnostics.js`.
- Root 6 music diagnostics route split is committed as `bfe7cd4e`. The next
  Root 6 slice extracted admin job/DLQ/step-history routes into
  `src/routes/admin/job-ops.js` and added route-level coverage.
- Root 6 job-ops route split is committed as `fcd528cf`. The next Root 6 slice
  extracted admin feature-flag routes into `src/routes/admin/feature-flags.js`
  and added route-level coverage.
- Root 6 feature-flag route split is committed as `415356ac`. The next Root 6
  slice extracted admin demo-share routes into
  `src/routes/admin/demo-shares.js` and expanded route-level characterization.
- Root 6 demo-share route split is committed as `093ff0a6`. The next Root 6
  slice extracted admin security observability/audit routes into
  `src/routes/admin/security-observability.js` while leaving security
  config/App Store sync and `/admin/auth/*` for separate, higher-risk slices.
- Root 6 security observability route split is committed as `38a28d34`. The
  next Root 6 slice extracted user read routes into
  `src/routes/admin/users-read.js`.
- Root 6 user-read route split is committed as `b10f4120`. The next Root 6
  slice extracted admin user session and voice-profile control routes into
  `src/routes/admin/user-session-controls.js`.
- Root 6 user session/voice control route split is committed as `9ba74ca3`.
  The next Root 6 slice extracted non-entitlement admin user mutation routes
  into `src/routes/admin/user-mutations.js`.
- Root 6 user mutation route split is committed as `4fa5065b`. The next Root 6
  slice extracted admin song/poem share-management routes into
  `src/routes/admin/shares.js`.
- Root 6 share-management route split is committed as `622fee95`. The next
  Root 6 slice extracted admin webhook-health into
  `src/routes/admin/webhook-health.js`.
- Root 6 webhook-health route split is committed as `48e020ee`. The next Root
  6 slice extracted admin growth/attribution routes into
  `src/routes/admin/growth.js`.
- Root 6 growth route split is committed as `aef0d568`. The next Root 6 slice
  extracted admin KPI dashboard routes into `src/routes/admin/kpis.js`.
- Root 6 KPI route split is committed as `480c104a`. The next Root 6 slice
  extracted admin funnel analytics routes into
  `src/routes/admin/analytics.js`.
- Root 6 analytics route split is committed as `d83ae6da`. The next Root 6
  slice moved attribution health into the existing
  `src/routes/admin/growth.js` boundary.
- Root 6 attribution-health follow-up is committed as `2e371736`. The next
  Root 6 slice extracted admin gift-ops routes into
  `src/routes/admin/gift-ops.js`.
- Root 6 gift-ops route split is committed as `68a40107`. The next Root 6
  slice extracted admin blog CMS routes into `src/routes/admin/blog.js`.
- Root 6 blog CMS route split is committed as `923d3b84`. The next Root 6
  slice extracted admin track-transfer routes into
  `src/routes/admin/track-transfer.js`.
- Root 6 track-transfer route split is committed as `b6ce90eb`. The next Root
  6 slice added provider/queue route characterization and extracted those
  routes into `src/routes/admin/provider-queue-control.js`.
- Root 6 provider/queue route split is committed as `4ff034a7`. The next Root
  6 slice added STT/music config route characterization and extracted those
  routes into `src/routes/admin/provider-config.js`.
- Root 6 provider-config route split is committed as `4d19a24a`. The next Root
  6 slice added onboarding-sample route characterization and extracted those
  routes into `src/routes/admin/onboarding-samples.js`.
- Root 6 onboarding-sample route split is committed as `9227c8f9`. The next
  Root 6 slice moved the public mobile `/app/config` route registration into
  `src/routes/client-config.js`, keeping the existing client config contract
  test green.
- Root 6 client-config route split is committed as `678f979c`. The next Root 6
  slice added blend-analysis route characterization and extracted diagnostics
  handlers into `src/routes/admin/blend-analysis.js`.
- Root 6 blend-analysis route split is committed as `0be8a136`. The next Root
  6 slice added security config/App Store sync route characterization and
  extracted those handlers into `src/routes/admin/security-config.js`.
- Root 6 security-config route split is committed as `fc08bf1b`. The next Root
  6 slice extracted admin SPA/static serving into
  `src/routes/admin/static-ui.js`, keeping the existing hosting hardening
  coverage green.
- Root 6 static UI route split is committed as `42d6d45a`. The next Root 6
  slice extracted the large admin marketing/cold-email/campaign route group
  into `src/routes/admin/marketing.js`, keeping the focused marketing route and
  repository suites green.
- Root 6 marketing route split is committed as `497ffef6`. The next Root 6
  slice extracted billing dashboard, entitlement mutation, complimentary
  upgrade, plan, and gift-bundle admin routes into
  `src/routes/admin/billing.js`.
- Root 6 billing route split is committed as `eb9986b6`. The next Root 6 slice
  added admin-auth route characterization and extracted `/admin/auth/*` into
  `src/routes/admin/auth.js`.
- Root 6 admin-auth route split is committed as `47574500`. The Root 6
  route-split sweep passed: `src/routes/admin.js` has no direct
  `app.get/post/put/delete/patch` handlers, the selected admin/client-config
  validation set passed 28/28, lint passed, and the architecture map is updated
  with the new route ownership. Remaining Root 6 decomposition is
  service-boundary work, not route-handler extraction.

## File Structure Map

### Existing Files To Modify

- `src/routes/sharing.js`  
  Owns share/player/claim HTTP contracts. It should delegate all share-token, track, track-version, gift-order, receiver-session, and notification lookup/update persistence.

- `src/routes/tracks.js`  
  Owns track API contracts, render request validation, billing/service orchestration, and response mapping. It should delegate track, track-version, entitlement, usage, and library persistence.

- `src/routes/poems.js`  
  Owns poem API contracts, poem generation orchestration, OG variant dispatching, and response mapping. It should delegate poem, entitlement, gift snapshot, share-token, and library persistence.

- `src/routes/story.js`  
  Owns story flow API contracts and orchestration. It should delegate story-session, display-name, track/poem bridge, and entitlement persistence to `src/database/story-repository.js`.

- `src/routes/enrollment.js`  
  Owns enrollment HTTP contracts, upload validation, audio/provider orchestration, and response mapping. It should delegate the remaining enrollment-session/artifact persistence to `src/database/enrollment-session-repository.js`.

- `src/routes/billing.js` and `src/services/subscription-manager.js`  
  Own billing HTTP contracts and subscription reconciliation orchestration. They should delegate subscriptions, entitlements, plan, trial, receipt, and tombstone persistence to billing/subscription repositories.

- `src/workflows/runner.js`  
  Owns render workflow orchestration. It should delegate job selection, job claims, step history, track/track-version updates, user risk updates, audit insertions, blocked-user reads, and provider artifact persistence.

- `src/jobs/artwork-job.js`  
  Owns scheduled artwork job orchestration. It should delegate any direct artwork-job row persistence to `src/database/artwork-job-repository.js`.

- `src/routes/admin.js`  
  Owns admin HTTP contracts and authorization. It should not regain broad SQL ownership; remaining direct persistence should move to the existing `admin-*` repositories.

### Repository Files To Extend Or Create

- Extend `src/database/share-token-repository.js` for share-token read/update methods that belong to the share aggregate.
- Extend `src/database/receiver-session-repository.js` for receiver claim/session methods used by share routes.
- Extend `src/database/track-version-repository.js` for generic track/version read and status helpers shared by routes and workflow code.
- Extend `src/database/track-library-repository.js` for track library/list/remove helpers only.
- Extend `src/database/poem-library-repository.js` for poem library/list/remove helpers only.
- Extend `src/database/story-repository.js` for story-session and story-flow persistence.
- Extend `src/database/enrollment-session-repository.js` for enrollment-session lifecycle/artifact persistence.
- Extend `src/database/artwork-job-repository.js` for artwork job polling/update persistence.
- Extend `src/database/admin-billing-repository.js` and `src/database/subscription-sync-repository.js` only for billing/admin dashboard and subscription-sync persistence that already belongs there.
- Create `src/database/subscription-entitlements-repository.js` for billing route and subscription-manager entitlement/subscription operations that do not belong to admin dashboard or sync-job repositories.

### Tests And Validation Files

- Existing targeted contract suites:
  - `test/share-flow.test.js`
  - `test/sharing-security.test.js`
  - `test/share-token-repository.test.js`
  - `test/tracks.test.js`
  - `test/track-library-repository.test.js`
  - `test/track-version-repository.test.js`
  - `test/poems.test.js`
  - `test/poem-library-repository.test.js`
  - `test/story-start.test.js`
  - `test/story-to-track-contract.test.js`
  - `test/story-repository.test.js`
  - `test/voice-enrollment.test.js`
  - `test/enrollment-session-repository.test.js`
  - `test/billing-api.test.js`
  - `test/subscription-manager.test.js`
  - `test/subscription-sync-repository.test.js`
  - `test/workflows/render-contract.test.js`
  - `test/workflows/personalized-highway.test.js`
  - `test/job-durability-repository.test.js`
  - `test/admin-billing-repository.test.js`
- Add new tests only when a public contract touched by a slice lacks existing characterization coverage. Code extraction is the first priority; test additions must be targeted, not broad snapshots.

## Parallel Agent Operating Rules

- Maximum active implementation workers: `3`.
- Worker wall-clock target: `25 minutes`.
- Hard action threshold: if a worker has not returned after `40 minutes`, the controller sends an interrupt asking for status and current patch summary. If it cannot provide one, close the worker and continue with a smaller slice.
- Every fresh worker must be closed with `close_agent` after `DONE`, `DONE_WITH_CONCERNS`, or `BLOCKED` has been processed.
- Do not reuse inherited or stale agents for implementation. Fresh worker per slice.
- Each worker owns a disjoint write set. If a worker discovers it must edit a file owned by another active worker, it must stop and report `NEEDS_CONTEXT`.
- Workers are not alone in the codebase. They must not revert or rewrite changes outside their assigned files.
- Workers commit only on their worker branch. The controller merges worker branches into `refactor` after review and validation.
- The controller performs integration review, conflict resolution, validation, documentation updates, and final commits on `refactor`.

## Worktree Layout

Use project-local worktrees so all worker code is visible and cleanup is deterministic:

```bash
git check-ignore -q .worktrees
git add .gitignore
git commit -m "chore: ignore local worker worktrees"
```

If `git check-ignore -q .worktrees` exits non-zero, patch `.gitignore` with:

```diff
+# Local Superpowers/Codex worker worktrees
+.worktrees/
```

Create worker worktrees from `refactor`:

```bash
git worktree add .worktrees/root1-sharing -b refactor-root1-sharing-20260628 refactor
git worktree add .worktrees/root1-tracks -b refactor-root1-tracks-20260628 refactor
git worktree add .worktrees/root1-poems -b refactor-root1-poems-20260628 refactor
git worktree add .worktrees/root1-story -b refactor-root1-story-20260628 refactor
git worktree add .worktrees/root1-enrollment-small -b refactor-root1-enrollment-small-20260628 refactor
git worktree add .worktrees/root1-billing -b refactor-root1-billing-20260628 refactor
git worktree add .worktrees/root1-runner -b refactor-root1-runner-20260628 refactor
```

Expected: each command prints `Preparing worktree` and `HEAD is now at 43d8d9dd` or the current controller commit after the ignore commit.

## Task 1: Controller Baseline And Worktree Setup

**Owner:** Controller

**Files:**
- Modify: `.gitignore`
- Create directories through Git worktree metadata under `.worktrees/`

- [ ] **Step 1: Verify branch and clean status**

Run:

```bash
git branch --show-current
git status --short
git log -n 2 --oneline
```

Expected:

```text
refactor
```

`git status --short` should be empty before editing `.gitignore`.

- [ ] **Step 2: Add local worker worktree ignore rule**

Patch `.gitignore` with:

```gitignore

# Local Superpowers/Codex worker worktrees
.worktrees/
```

- [ ] **Step 3: Commit the ignore rule**

Run:

```bash
git add .gitignore
git commit -m "chore: ignore local worker worktrees"
```

Expected: one commit with only `.gitignore` changed.

- [ ] **Step 4: Create worker worktrees**

Run:

```bash
git worktree add .worktrees/root1-sharing -b refactor-root1-sharing-20260628 refactor
git worktree add .worktrees/root1-tracks -b refactor-root1-tracks-20260628 refactor
git worktree add .worktrees/root1-poems -b refactor-root1-poems-20260628 refactor
```

Expected: three worktrees exist and each branch starts from the current `refactor` commit.

- [ ] **Step 5: Confirm baseline scan**

Run:

```bash
rg -c "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows
```

Expected: counts remain concentrated in `src/routes/sharing.js`, `src/routes/tracks.js`, `src/routes/poems.js`, `src/routes/story.js`, `src/routes/enrollment.js`, `src/routes/billing.js`, `src/services/subscription-manager.js`, `src/workflows/runner.js`, `src/routes/admin.js`, and `src/jobs/artwork-job.js`.

## Task 2: Wave 1 Agent A - Share Route Repository Extraction

**Owner:** Worker Agent A  
**Worktree:** `.worktrees/root1-sharing`  
**Branch:** `refactor-root1-sharing-20260628`

**Files:**
- Modify: `src/routes/sharing.js`
- Modify: `src/database/share-token-repository.js`
- Modify: `src/database/receiver-session-repository.js`
- Test: `test/share-token-repository.test.js`
- Test: `test/share-flow.test.js`
- Test: `test/sharing-security.test.js`

- [ ] **Step 1: Capture current share route persistence hits**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes/sharing.js
```

Expected: the command prints direct persistence hits in `src/routes/sharing.js`.

- [ ] **Step 2: Add repository methods before route rewiring**

Use this exact repository method style in `src/database/share-token-repository.js`:

```js
async function getSongShareTokenForPublicRead(id) {
  return dbGet(db, "SELECT * FROM share_tokens WHERE id = ?", [id]);
}

async function getGiftOrderSendAt(giftOrderId) {
  return dbGet(db, "SELECT send_at FROM gift_orders WHERE id = ?", [
    giftOrderId,
  ]);
}

async function setSongShareStatus({ id, status }) {
  return dbRun(db, "UPDATE share_tokens SET status = ? WHERE id = ?", [
    status,
    id,
  ]);
}
```

If the route needs another query from `sharing.js`, move it with the same signature rule: method name describes the aggregate behavior, parameters are an object when there is more than one input, and the SQL stays in the repository.

- [ ] **Step 3: Rewire `sharing.js` to use repository methods**

Use this route wiring pattern:

```js
const { createShareTokenRepository } = require("../database/share-token-repository");
const { createReceiverSessionRepository } = require("../database/receiver-session-repository");

function buildShareRepositories(db) {
  return {
    shareTokens: createShareTokenRepository(db),
    receiverSessions: createReceiverSessionRepository(db),
  };
}
```

Keep HTTP response fields unchanged. Do not rename response properties.

- [ ] **Step 4: Verify direct route persistence has decreased**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes/sharing.js
```

Expected: fewer lines than Step 1. If any hits remain, each hit must be listed in the worker final report with the reason it was deferred.

- [ ] **Step 5: Run focused share tests**

Run:

```bash
node --test --test-concurrency=1 test/share-token-repository.test.js test/share-flow.test.js test/sharing-security.test.js
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit worker branch**

Run:

```bash
git add src/routes/sharing.js src/database/share-token-repository.js src/database/receiver-session-repository.js test/share-token-repository.test.js test/share-flow.test.js test/sharing-security.test.js
git commit -m "refactor: move share route persistence behind repositories"
```

Expected: worker reports commit SHA, files changed, tests run, direct persistence hits deferred if any.

## Task 3: Wave 1 Agent B - Track Route Repository Extraction

**Owner:** Worker Agent B  
**Worktree:** `.worktrees/root1-tracks`  
**Branch:** `refactor-root1-tracks-20260628`

**Files:**
- Modify: `src/routes/tracks.js`
- Modify: `src/database/track-version-repository.js`
- Modify: `src/database/track-library-repository.js`
- Test: `test/track-version-repository.test.js`
- Test: `test/track-library-repository.test.js`
- Test: `test/song-usage-summary.test.js`
- Test: `test/render-full-billing-atomicity.test.js`

- [ ] **Step 1: Capture current track route persistence hits**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes/tracks.js
```

Expected: the command prints direct persistence hits in `src/routes/tracks.js`.

- [ ] **Step 2: Add track repository helpers**

Use this style in `src/database/track-version-repository.js`:

```js
async function findTrackForOwner({ trackId, userId }) {
  return db
    .prepare("SELECT * FROM tracks WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .get(trackId, userId);
}

async function markTrackDeleted({ trackId, userId, deletedAt }) {
  return db
    .prepare("UPDATE tracks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(deletedAt, deletedAt, trackId, userId);
}
```

Use `track-library-repository.js` only for user library entry operations. Keep render-job and billing writes out of library methods.

- [ ] **Step 3: Rewire `tracks.js`**

Use this pattern at the top-level route setup:

```js
const { createTrackVersionRepository } = require("../database/track-version-repository");
const { createTrackLibraryRepository } = require("../database/track-library-repository");

function buildTrackRepositories(db) {
  return {
    trackVersions: createTrackVersionRepository(db),
    trackLibrary: createTrackLibraryRepository(db),
  };
}
```

Preserve existing status codes and error messages.

- [ ] **Step 4: Run focused track tests**

Run:

```bash
node --test --test-concurrency=1 test/track-version-repository.test.js test/track-library-repository.test.js test/song-usage-summary.test.js test/render-full-billing-atomicity.test.js
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit worker branch**

Run:

```bash
git add src/routes/tracks.js src/database/track-version-repository.js src/database/track-library-repository.js test/track-version-repository.test.js test/track-library-repository.test.js
git commit -m "refactor: move track route persistence behind repositories"
```

Expected: worker reports commit SHA, files changed, tests run, and remaining `tracks.js` persistence hits.

## Task 4: Wave 1 Agent C - Poem Route Repository Extraction

**Owner:** Worker Agent C  
**Worktree:** `.worktrees/root1-poems`  
**Branch:** `refactor-root1-poems-20260628`

**Files:**
- Modify: `src/routes/poems.js`
- Modify: `src/database/poem-library-repository.js`
- Modify: `src/database/share-token-repository.js` only if poem-share-token behavior is extracted
- Test: `test/poem-library-repository.test.js`
- Test: `test/poems.test.js`
- Test: `test/story-delete-poem.test.js`

- [ ] **Step 1: Capture current poem route persistence hits**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes/poems.js
```

Expected: the command prints direct persistence hits in `src/routes/poems.js`.

- [ ] **Step 2: Add poem repository helpers**

Use this style in `src/database/poem-library-repository.js`:

```js
async function findActivePoemById(poemId) {
  return db
    .prepare("SELECT * FROM poems WHERE id = ? AND deleted_at IS NULL")
    .get(poemId);
}

async function markPoemGenerationFailed(poemId) {
  return db
    .prepare("UPDATE poems SET status = 'generation_failed' WHERE id = ?")
    .run(poemId);
}
```

Gift snapshot reads from `gift_orders` may stay in `poem-library-repository.js` only if they are used to render poem API state; otherwise report the boundary concern.

- [ ] **Step 3: Rewire `poems.js`**

Use this pattern:

```js
const { createPoemLibraryRepository } = require("../database/poem-library-repository");

function buildPoemRepositories(db) {
  return {
    poems: createPoemLibraryRepository(db),
  };
}
```

Do not change poem response JSON or OG variant behavior.

- [ ] **Step 4: Run focused poem tests**

Run:

```bash
node --test --test-concurrency=1 test/poem-library-repository.test.js test/poems.test.js test/story-delete-poem.test.js
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit worker branch**

Run:

```bash
git add src/routes/poems.js src/database/poem-library-repository.js src/database/share-token-repository.js test/poem-library-repository.test.js test/poems.test.js test/story-delete-poem.test.js
git commit -m "refactor: move poem route persistence behind repositories"
```

Expected: worker reports commit SHA, files changed, tests run, and remaining `poems.js` persistence hits.

## Task 5: Controller Review And Merge Wave 1

**Owner:** Controller

**Files:**
- Merge worker branch changes into `refactor`
- Update: `docs/architecture/architecture-debt-register-2026-06.md`

- [ ] **Step 1: Wait for Wave 1 workers and close each worker**

Use multi-agent waits for Agent A, Agent B, and Agent C. After each final result is processed, run `close_agent` for that worker.

Expected: no Wave 1 worker remains open after result processing.

- [ ] **Step 2: Review each worker branch**

Run for each branch:

```bash
git diff --stat refactor...refactor-root1-sharing-20260628
git diff --stat refactor...refactor-root1-tracks-20260628
git diff --stat refactor...refactor-root1-poems-20260628
```

Expected: each branch touches only its assigned files.

- [ ] **Step 3: Merge accepted worker branches**

Run:

```bash
git merge --no-ff refactor-root1-sharing-20260628 -m "merge: root1 sharing repository extraction"
git merge --no-ff refactor-root1-tracks-20260628 -m "merge: root1 track repository extraction"
git merge --no-ff refactor-root1-poems-20260628 -m "merge: root1 poem repository extraction"
```

Expected: merges either apply cleanly or produce confined conflicts in repository files. Resolve conflicts by preserving repository methods and route behavior.

- [ ] **Step 4: Run Wave 1 validation**

Run:

```bash
node --test --test-concurrency=1 test/share-token-repository.test.js test/share-flow.test.js test/sharing-security.test.js test/track-version-repository.test.js test/track-library-repository.test.js test/song-usage-summary.test.js test/render-full-billing-atomicity.test.js test/poem-library-repository.test.js test/poems.test.js test/story-delete-poem.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

- [ ] **Step 5: Update debt register status**

Append one concise status paragraph under Root 1 in `docs/architecture/architecture-debt-register-2026-06.md`:

```markdown
Wave 1 repository extraction moved additional sharing, track, and poem route persistence behind repositories and validated the focused share, track, and poem contract suites locally.
```

- [ ] **Step 6: Commit Wave 1 integration docs if needed**

Run:

```bash
git add docs/architecture/architecture-debt-register-2026-06.md
git commit -m "docs: record root1 wave 1 repository extraction"
```

Expected: commit is skipped if the merge commits already include the exact docs update.

## Task 6: Wave 2 Agent D - Story Route Repository Extraction

**Owner:** Worker Agent D  
**Worktree:** `.worktrees/root1-story`  
**Branch:** `refactor-root1-story-20260628`

**Files:**
- Modify: `src/routes/story.js`
- Modify: `src/database/story-repository.js`
- Test: `test/story-repository.test.js`
- Test: `test/story-start.test.js`
- Test: `test/story-to-track-contract.test.js`
- Test: `test/story-session-state.test.js`

- [ ] **Step 1: Create or refresh worktree**

Run:

```bash
git worktree add .worktrees/root1-story -b refactor-root1-story-20260628 refactor
```

Expected: worktree exists from current `refactor`.

- [ ] **Step 2: Move remaining story route persistence**

Use this method style in `src/database/story-repository.js`:

```js
async function getUserDisplayName(userId) {
  return db
    .prepare("SELECT display_name FROM users WHERE id = ?")
    .get(userId);
}

async function findStorySessionOwner(sessionId) {
  return db
    .prepare("SELECT user_id FROM story_sessions WHERE id = ?")
    .get(sessionId);
}
```

Keep story route state machine behavior unchanged.

- [ ] **Step 3: Run focused story tests**

Run:

```bash
node --test --test-concurrency=1 test/story-repository.test.js test/story-start.test.js test/story-to-track-contract.test.js test/story-session-state.test.js
```

Expected: all selected tests pass.

- [ ] **Step 4: Commit worker branch**

Run:

```bash
git add src/routes/story.js src/database/story-repository.js test/story-repository.test.js test/story-start.test.js test/story-to-track-contract.test.js test/story-session-state.test.js
git commit -m "refactor: move story route persistence behind repository"
```

Expected: worker reports commit SHA, files changed, tests run, and remaining `story.js` persistence hits.

## Task 7: Wave 2 Agent E - Enrollment, Artwork Job, And Admin Small Leftovers

**Owner:** Worker Agent E  
**Worktree:** `.worktrees/root1-enrollment-small`  
**Branch:** `refactor-root1-enrollment-small-20260628`

**Files:**
- Modify: `src/routes/enrollment.js`
- Modify: `src/database/enrollment-session-repository.js`
- Modify: `src/jobs/artwork-job.js`
- Modify: `src/database/artwork-job-repository.js`
- Modify: `src/routes/admin.js`
- Modify: the existing `src/database/admin-*` repository that owns each remaining admin query
- Test: `test/enrollment-session-repository.test.js`
- Test: `test/voice-enrollment.test.js`
- Test: `test/jobs/artwork-job.test.js`
- Test: focused `test/admin-*-repository.test.js` or `test/admin-*-routes.test.js` matching any admin query moved

- [ ] **Step 1: Create or refresh worktree**

Run:

```bash
git worktree add .worktrees/root1-enrollment-small -b refactor-root1-enrollment-small-20260628 refactor
```

Expected: worktree exists from current `refactor`.

- [ ] **Step 2: Move enrollment persistence using existing repository**

Use this method style in `src/database/enrollment-session-repository.js`:

```js
async function updateEnrollmentSessionArtifact({ id, artifactUrl, updatedAt }) {
  return db
    .prepare("UPDATE enrollment_sessions SET artifact_url = ?, updated_at = ? WHERE id = ?")
    .run(artifactUrl, updatedAt, id);
}
```

Method names must reflect the current column behavior in `enrollment.js`; do not broaden repository methods to generic table updates.

- [ ] **Step 3: Move artwork job persistence**

Use this style in `src/database/artwork-job-repository.js`:

```js
async function getPendingArtworkJob(id) {
  return db
    .prepare("SELECT * FROM artwork_jobs WHERE id = ?")
    .get(id);
}
```

Preserve the existing injected `db` contract in `src/jobs/artwork-job.js`.

- [ ] **Step 4: Move admin leftovers**

For each remaining `src/routes/admin.js` persistence hit, choose the existing admin repository by domain:

```text
admin billing or revenue -> src/database/admin-billing-repository.js
admin users or sessions -> src/database/admin-user-read-repository.js or src/database/admin-user-session-control-repository.js
admin shares -> src/database/admin-share-management-repository.js
admin jobs or DLQ -> src/database/admin-job-ops-repository.js
admin metrics -> src/database/admin-metrics-repository.js
```

If a hit does not fit those domains, stop and report `NEEDS_CONTEXT` with the line number and SQL.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test --test-concurrency=1 test/enrollment-session-repository.test.js test/voice-enrollment.test.js test/jobs/artwork-job.test.js
```

Also run the matching admin test file for any admin repository or route touched.

Expected: selected tests pass.

- [ ] **Step 6: Commit worker branch**

Run:

```bash
git add src/routes/enrollment.js src/database/enrollment-session-repository.js src/jobs/artwork-job.js src/database/artwork-job-repository.js src/routes/admin.js src/database/admin-*-repository.js test/enrollment-session-repository.test.js test/voice-enrollment.test.js test/jobs/artwork-job.test.js test/admin-*.test.js
git commit -m "refactor: move small root1 persistence leftovers behind repositories"
```

Expected: worker reports commit SHA, files changed, tests run, and any deferred admin SQL line numbers.

## Task 8: Wave 2 Agent F - Billing And Subscription Repository Extraction

**Owner:** Worker Agent F  
**Worktree:** `.worktrees/root1-billing`  
**Branch:** `refactor-root1-billing-20260628`

**Files:**
- Modify: `src/routes/billing.js`
- Modify: `src/services/subscription-manager.js`
- Create: `src/database/subscription-entitlements-repository.js`
- Modify: `src/database/admin-billing-repository.js` only for existing billing dashboard/admin concerns
- Modify: `src/database/subscription-sync-repository.js` only for sync-job concerns
- Test: `test/billing-api.test.js`
- Test: `test/subscription-manager.test.js`
- Test: `test/subscription-sync-repository.test.js`
- Test: `test/admin-billing-repository.test.js` if admin billing repository changes

- [ ] **Step 1: Create or refresh worktree**

Run:

```bash
git worktree add .worktrees/root1-billing -b refactor-root1-billing-20260628 refactor
```

Expected: worktree exists from current `refactor`.

- [ ] **Step 2: Create subscription entitlement repository**

Create `src/database/subscription-entitlements-repository.js` with this shape:

```js
"use strict";

function createSubscriptionEntitlementsRepository(db) {
  async function getEntitlementForUser(userId) {
    return db
      .prepare("SELECT * FROM entitlements WHERE user_id = ?")
      .get(userId);
  }

  async function updateEntitlementTier({ userId, tier }) {
    return db
      .prepare("UPDATE entitlements SET tier = ? WHERE user_id = ?")
      .run(tier, userId);
  }

  return {
    getEntitlementForUser,
    updateEntitlementTier,
  };
}

module.exports = { createSubscriptionEntitlementsRepository };
```

Add only the additional methods required by current `billing.js` and `subscription-manager.js`, preserving current transaction boundaries.

- [ ] **Step 3: Rewire billing code**

Use this dependency pattern:

```js
const {
  createSubscriptionEntitlementsRepository,
} = require("../database/subscription-entitlements-repository");

function buildBillingRepositories(db) {
  return {
    subscriptionEntitlements: createSubscriptionEntitlementsRepository(db),
  };
}
```

Keep receipt validation, Apple/Google provider calls, and response mapping in services/routes.

- [ ] **Step 4: Run focused billing tests**

Run:

```bash
node --test --test-concurrency=1 test/billing-api.test.js test/subscription-manager.test.js test/subscription-sync-repository.test.js
```

If `admin-billing-repository.js` changed, also run:

```bash
node --test --test-concurrency=1 test/admin-billing-repository.test.js
```

Expected: selected tests pass.

- [ ] **Step 5: Commit worker branch**

Run:

```bash
git add src/routes/billing.js src/services/subscription-manager.js src/database/subscription-entitlements-repository.js src/database/admin-billing-repository.js src/database/subscription-sync-repository.js test/billing-api.test.js test/subscription-manager.test.js test/subscription-sync-repository.test.js test/admin-billing-repository.test.js
git commit -m "refactor: move subscription persistence behind repository"
```

Expected: worker reports commit SHA, files changed, tests run, and remaining billing/subscription persistence hits.

## Task 9: Controller Review And Merge Wave 2

**Owner:** Controller

**Files:**
- Merge worker branch changes into `refactor`
- Update: `docs/architecture/architecture-debt-register-2026-06.md`

- [ ] **Step 1: Wait for Wave 2 workers and close each worker**

Use multi-agent waits for Agent D, Agent E, and Agent F. After each final result is processed, run `close_agent` for that worker.

Expected: no Wave 2 worker remains open after result processing.

- [ ] **Step 2: Review branch ownership**

Run:

```bash
git diff --stat refactor...refactor-root1-story-20260628
git diff --stat refactor...refactor-root1-enrollment-small-20260628
git diff --stat refactor...refactor-root1-billing-20260628
```

Expected: each branch touches only assigned files.

- [ ] **Step 3: Merge accepted worker branches**

Run:

```bash
git merge --no-ff refactor-root1-story-20260628 -m "merge: root1 story repository extraction"
git merge --no-ff refactor-root1-enrollment-small-20260628 -m "merge: root1 small persistence extraction"
git merge --no-ff refactor-root1-billing-20260628 -m "merge: root1 subscription repository extraction"
```

Expected: merges either apply cleanly or produce confined conflicts in repository files. Resolve conflicts by preserving repository ownership and route behavior.

- [ ] **Step 4: Run Wave 2 validation**

Run:

```bash
node --test --test-concurrency=1 test/story-repository.test.js test/story-start.test.js test/story-to-track-contract.test.js test/story-session-state.test.js test/enrollment-session-repository.test.js test/voice-enrollment.test.js test/jobs/artwork-job.test.js test/billing-api.test.js test/subscription-manager.test.js test/subscription-sync-repository.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

- [ ] **Step 5: Update debt register status**

Append one concise status paragraph under Root 1 in `docs/architecture/architecture-debt-register-2026-06.md`:

```markdown
Wave 2 repository extraction moved additional story, enrollment, artwork-job, admin leftover, billing, and subscription persistence behind repositories and validated the focused route/service suites locally.
```

## Task 10: Wave 3 Agent G - Workflow Runner Persistence Exit

**Owner:** Worker Agent G  
**Worktree:** `.worktrees/root1-runner`  
**Branch:** `refactor-root1-runner-20260628`

**Files:**
- Modify: `src/workflows/runner.js`
- Modify: `src/database/job-durability-repository.js`
- Modify: `src/database/dead-letter-queue-repository.js`
- Modify: `src/database/track-version-repository.js`
- Modify: `src/database/voice-provider-profile-repository.js` only for runner voice-profile reads already owned by that repository
- Test: `test/job-durability-repository.test.js`
- Test: `test/dead-letter-queue-repository.test.js`
- Test: `test/workflows/render-contract.test.js`
- Test: `test/workflows/personalized-highway.test.js`
- Test: `test/workflows/provider-artifact-hydration.test.js`

- [ ] **Step 1: Create or refresh worktree**

Run:

```bash
git worktree add .worktrees/root1-runner -b refactor-root1-runner-20260628 refactor
```

Expected: worktree exists from current `refactor`.

- [ ] **Step 2: Capture current runner persistence hits**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/workflows/runner.js
```

Expected: the command prints direct persistence hits in `src/workflows/runner.js`.

- [ ] **Step 3: Move prepared statements behind repositories**

Use this method style in `src/database/job-durability-repository.js`:

```js
async function claimQueuedRenderJob({ jobId, runnerId, claimedAt }) {
  return db
    .prepare("UPDATE render_jobs SET status = 'running', runner_id = ?, claimed_at = ? WHERE id = ? AND status = 'queued'")
    .run(runnerId, claimedAt, jobId);
}
```

Keep workflow step orchestration, provider calls, and retry decision logic in `runner.js`.

- [ ] **Step 4: Run focused runner tests**

Run:

```bash
node --test --test-concurrency=1 test/job-durability-repository.test.js test/dead-letter-queue-repository.test.js test/workflows/render-contract.test.js test/workflows/personalized-highway.test.js test/workflows/provider-artifact-hydration.test.js
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit worker branch**

Run:

```bash
git add src/workflows/runner.js src/database/job-durability-repository.js src/database/dead-letter-queue-repository.js src/database/track-version-repository.js src/database/voice-provider-profile-repository.js test/job-durability-repository.test.js test/dead-letter-queue-repository.test.js test/workflows/render-contract.test.js test/workflows/personalized-highway.test.js test/workflows/provider-artifact-hydration.test.js
git commit -m "refactor: move workflow runner persistence behind repositories"
```

Expected: worker reports commit SHA, files changed, tests run, and remaining runner persistence hits.

## Task 11: Controller Root 1 Termination Gate

**Owner:** Controller

**Files:**
- Merge: `refactor-root1-runner-20260628`
- Update: `docs/architecture/architecture-debt-register-2026-06.md`
- Update: `docs/architecture/architecture-map-2026-06.md`

- [ ] **Step 1: Wait for runner worker and close it**

Use multi-agent wait for Agent G. After final result is processed, run `close_agent` for the worker.

Expected: Agent G is closed and no worker remains open.

- [ ] **Step 2: Merge runner branch**

Run:

```bash
git merge --no-ff refactor-root1-runner-20260628 -m "merge: root1 workflow runner repository extraction"
```

Expected: merge applies or produces conflicts confined to `src/workflows/runner.js` and repository files.

- [ ] **Step 3: Run Root 1 closure scan**

Run:

```bash
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows
```

Expected: no direct persistence hits in route, service, job, or workflow files except comments that describe injected database interfaces.

- [ ] **Step 4: Run Root 1 validation suite**

Run:

```bash
node --test --test-concurrency=1 test/share-flow.test.js test/sharing-security.test.js test/tracks.test.js test/poems.test.js test/story-start.test.js test/story-to-track-contract.test.js test/voice-enrollment.test.js test/billing-api.test.js test/subscription-manager.test.js test/workflows/render-contract.test.js test/workflows/personalized-highway.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

- [ ] **Step 5: Update architecture docs**

Update Root 1 status in `docs/architecture/architecture-debt-register-2026-06.md` to:

```markdown
Root 1 repository extraction is complete locally: routes, services, jobs, and workflow orchestration no longer own direct persistence. Remaining SQL ownership is intentionally concentrated in `src/database/**` repositories and database adapter/migration files.
```

Update `docs/architecture/architecture-map-2026-06.md` repository-layer section to show:

```markdown
HTTP routes and workflow runners depend on aggregate repositories for persistence; repositories are the only production source files allowed to prepare or execute application SQL outside database adapters and migrations.
```

- [ ] **Step 6: Commit Root 1 closure**

Run:

```bash
git add docs/architecture/architecture-debt-register-2026-06.md docs/architecture/architecture-map-2026-06.md
git commit -m "docs: mark repository layer extraction complete"
```

Expected: commit records Root 1 closure.

## Task 12: Root 2 Auth And Rate-Limit Consolidation

**Owner:** Controller plus one worker after Root 1 is closed  
**Risk:** Revenue/auth path

**Files:**
- Modify: `src/services/auth-service.js`
- Modify: `src/routes/auth.js`
- Modify: `src/server.js` only if auth middleware ownership requires it
- Modify: `src/database/auth-session-repository.js`
- Modify: `src/database/auth-rate-limit-repository.js`
- Test: `test/auth-api.test.js`
- Test: `test/auth-login-enumeration.test.js`
- Test: `test/rate-limit.test.js`
- Test: `test/auth-race-condition.test.js`

- [x] **Step 1: Confirm C1 local invariant before changes**

Run:

```bash
node --test --test-concurrency=1 test/auth-api.test.js test/auth-login-enumeration.test.js test/rate-limit.test.js
```

Expected: all selected tests pass.

- [x] **Step 2: Consolidate auth guard and rate-limit ownership**

Move duplicated guard/rate-limit persistence calls into repository-backed service methods. Use this service boundary:

```js
async function verifyActiveSessionForUser({ userId, sessionId }) {
  const session = await authSessions.findActiveSessionForUser({
    userId,
    sessionId,
  });
  return Boolean(session);
}
```

Keep route-level auth decisions explicit and preserve current HTTP error envelopes.

Implemented in `src/middleware/require-user.js`, `src/services/auth-service.js`,
`src/database/rate-limit-repository.js`, `src/routes/auth.js`, and
`src/server.js`. The rate-limit test now exercises production repository code
instead of a copied helper and caught/fixed a parallel-consume rollback bug.
Added a revoked JWT session characterization for `/billing/receipt/apple` in
`test/billing-api.test.js`.

- [x] **Step 3: Run Root 2 tests**

Run:

```bash
node --test --test-concurrency=1 test/auth-api.test.js test/auth-login-enumeration.test.js test/rate-limit.test.js test/auth-race-condition.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

Verification run:

```bash
env NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js test/auth-login-enumeration.test.js test/rate-limit.test.js test/auth-race-condition.test.js test/billing-api.test.js
npm run lint -- --quiet
```

Result: 107 selected tests passed; lint passed.

- [x] **Step 4: Commit Root 2**

Run:

```bash
git add src/middleware/require-user.js src/utils/http-error.js src/services/auth-service.js src/routes/auth.js src/server.js src/database/rate-limit-repository.js test/rate-limit.test.js test/billing-api.test.js docs/superpowers/plans/2026-06-28-parallel-architecture-refactor.md docs/architecture/architecture-debt-register-2026-06.md
git commit -m "refactor: consolidate auth and rate-limit boundaries"
```

Expected: one Root 2 commit.

## Task 13: C2 Error Envelope Documentation Freeze

**Owner:** Controller

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture-and-flows.md`
- Modify: `docs/architecture/architecture-debt-register-2026-06.md`
- Modify or create: `docs/api/error-envelope.md`

- [x] **Step 1: Document actual current error envelope**

Create or update `docs/api/error-envelope.md` with:

````markdown
# API Error Envelope

The current public HTTP error envelope is a flat object:

```json
{
  "error": "machine_readable_error",
  "message": "Human-readable message"
}
```

Endpoint-specific top-level fields may exist for already-shipped contracts. New endpoints must not add undocumented top-level error fields. A nested versioned envelope is a future client-coordinated migration and is not part of this refactor.
````

- [x] **Step 2: Reconcile architecture docs**

Replace claims that the wire format is already `{ error: { code, message, details } }` with links to `docs/api/error-envelope.md`.

- [x] **Step 3: Commit C2 docs**

Run:

```bash
git add CLAUDE.md docs/architecture-and-flows.md docs/architecture/architecture-debt-register-2026-06.md docs/architecture/architecture-map-2026-06.md docs/api/error-envelope.md docs/plans/2026-03-30-intelligent-error-recovery-design.md docs/superpowers/plans/2026-06-28-parallel-architecture-refactor.md
git commit -m "docs: freeze current API error envelope"
```

Expected: C2 is document-closed without changing wire behavior.

## Task 14: Root 3b Gift Subsystem Extraction

**Owner:** One worker plus controller review  
**Risk:** Revenue-adjacent gift path

**Files:**
- Modify: `src/server.js`
- Create: `src/plugins/gift-delivery.js`
- Modify: `src/routes/gifts.js` only if route registration moves
- Use existing gift repositories under `src/database/gift-*.js`
- Test: `test/gifts.test.js`
- Test: `test/gift-webhooks.test.js`
- Test: `test/gift-dispatch-repository.test.js`
- Test: `test/render-full-billing-atomicity.test.js`

- [x] **Step 1: Run gift characterization tests before moving code**

Run:

```bash
node --test --test-concurrency=1 test/gifts.test.js test/gift-webhooks.test.js test/gift-dispatch-repository.test.js test/render-full-billing-atomicity.test.js
```

Expected: all selected tests pass.

Result: Passed locally with `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true`; 64 tests, 63 pass, 1 skipped, 0 failures.

- [x] **Step 2: Move gift delivery registration into a Fastify plugin**

Create `src/plugins/gift-delivery.js` with:

```js
"use strict";

async function giftDeliveryPlugin(fastify, options) {
  const {
    db,
    config,
    services,
  } = options;

  fastify.decorate("giftDeliveryContext", {
    db,
    config,
    services,
  });
}

module.exports = { giftDeliveryPlugin };
```

Move existing server-owned gift delivery wiring into the plugin without changing route URLs, schemas, or response bodies.

- [x] **Step 3: Register plugin from `server.js`**

Use:

```js
const { giftDeliveryPlugin } = require("./plugins/gift-delivery");

await app.register(giftDeliveryPlugin, {
  db,
  config,
  services,
});
```

Execution note: `buildServer()` remains synchronous because tests and callers use
decorators like `app.dispatchGiftById()` and `app.expireGiftReservations()`
directly after construction. The gift module is registered by a synchronous
plugin registrar instead of `await app.register(...)`; changing `buildServer()`
to async is a broader contract change and was deliberately avoided in this
revenue-adjacent root.

- [x] **Step 4: Run gift validation**

Run:

```bash
node --test --test-concurrency=1 test/gifts.test.js test/gift-webhooks.test.js test/gift-dispatch-repository.test.js test/render-full-billing-atomicity.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

Result: focused gift validation passed (64 tests, 63 pass, 1 skipped, 0 failures), expanded gift/admin/billing coupling validation passed (103 tests, 102 pass, 1 skipped, 0 failures), and `npm run lint -- --quiet` passed.

- [x] **Step 5: Commit Root 3b**

Run:

```bash
git add src/server.js src/plugins/gift-delivery.js src/routes/gifts.js
git commit -m "refactor: extract gift delivery plugin"
```

Expected: gift subsystem is no longer embedded directly in `server.js`.

Result: committed as `76d105e7 refactor: extract gift delivery plugin`.

## Task 15: Root 5 Workflow Runner Step Registry

**Owner:** One worker plus controller review

**Files:**
- Modify: `src/workflows/runner.js`
- Create: `src/workflows/steps/index.js`
- Create focused step modules under `src/workflows/steps/`
- Test: `test/workflows/render-contract.test.js`
- Test: `test/workflows/personalized-highway.test.js`
- Test: `test/workflows/personalized-step-guards.test.js`

- [x] **Step 1: Run render characterization tests before split**

Run:

```bash
node --test --test-concurrency=1 test/workflows/render-contract.test.js test/workflows/personalized-highway.test.js test/workflows/personalized-step-guards.test.js
```

Expected: all selected tests pass.

Result: Passed locally with `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true`; 28 tests, 28 pass, 0 failures.

- [x] **Step 2: Create registry entry point**

Create `src/workflows/steps/index.js`:

```js
"use strict";

function createStepRegistry(steps) {
  return new Map(Object.entries(steps));
}

module.exports = { createStepRegistry };
```

- [ ] **Step 3: Move one step family at a time**

Move a cohesive step family from `runner.js` into `src/workflows/steps/<family>.js` with this shape:

```js
"use strict";

function createPersonalizationSteps(dependencies) {
  return {
    async personalizeAudio(context) {
      return dependencies.personalizeAudio(context);
    },
  };
}

module.exports = { createPersonalizationSteps };
```

Run tests after each moved family.

Slice 1 result: `src/workflows/steps/index.js` now owns `createStepRegistry`,
`src/workflows/steps/moderation.js` owns the CPU-only moderation handler, and
`runner.js` dispatches through `stepRegistry.get(stepName)`. The personalized
and provider I/O families remain in `runner.js` for later, higher-risk slices.
Post-slice workflow characterization passed (28 tests, 28 pass, 0 failures) and
`npm run lint -- --quiet` passed.

Slice 2 result: `src/workflows/steps/lyrics.js` now owns the lyrics handler and
injects its generator, provenance, policy-sanitizer, and JSON helpers from the
runner. Post-slice workflow characterization passed (28 tests, 28 pass, 0
failures), syntax checks passed, and `npm run lint -- --quiet` passed.

Slice 3 result: `src/workflows/steps/music-plan.js` now owns the music-plan
handler and injects music plan construction, provider routing config, Suno
persona profile lookup, render contract construction, provenance, and JSON
helpers from the runner. Direct step-factory tests passed (9 tests, 9 pass),
expanded render/persona workflow validation passed (45 tests, 45 pass), syntax
checks passed, and `npm run lint -- --quiet` passed.

Slice 4 result: `src/workflows/steps/guide-vocal.js` now owns the
`guide_vocal` and `guide_vocal_full` handlers. The extracted family injects TTS,
provider config, render-contract guards, guide-token generation, storage path
helpers, and placeholder WAV generation from the runner. Direct step-factory
tests passed (13 tests, 13 pass), expanded render/persona workflow validation
passed (45 tests, 45 pass), syntax checks passed, `git diff --check` passed,
and `npm run lint -- --quiet` passed. The slice also closes the documented
idempotency gap for `guide_vocal_full` by reusing an existing non-empty
`guide_vocal_full.mp3` instead of spending another TTS call. Post-commit review
flagged zero-byte reuse and temp-dir cleanup; both were fixed in Slice 5.

Slice 5 result: `src/workflows/steps/voice-conversion.js` now owns
`voice_convert` and `voice_convert_sections`. The extracted family injects
conversion helpers, provider URL resolution, render-contract guards, durability,
storage, provider config, and vocal-polish behavior from the runner while
preserving the existing output-file reuse check before contract parsing. Direct
step-factory tests now cover reuse, skipped pipelines, live Replicate AI voice,
local guide fallback, personalized provider-audio source selection, and missing
personalized source errors. Direct step-factory tests passed (20 tests, 20
pass), expanded render/persona/voice-routing validation passed (51 tests, 51
pass), syntax checks passed, `git diff --check` passed, and
`npm run lint -- --quiet` passed.

Slice 6 result: `src/workflows/steps/watermark.js` now owns the `watermark`
handler. The extracted family injects watermark embedding, AAC encoding, HLS
creation, provider config, storage path helpers, and placeholder WAV generation
from the runner while preserving optional HLS failure handling and best-effort
intermediate cleanup. Direct step-factory tests cover preview/full output
selection, HLS fallback, placeholder output, live-provider missing-mix errors,
and cleanup. Direct step-factory tests passed (26 tests, 26 pass), expanded
render/persona/voice-routing validation passed (51 tests, 51 pass), MVP flow
passed (2 tests, 2 pass), syntax checks passed, `git diff --check` passed, and
`npm run lint -- --quiet` passed.

Slice 7 result: `src/workflows/steps/ready.js` now owns the `ready` quality-gate
handler. The extracted family injects runtime music routing config, quality
evaluation, reroll plan tightening, provenance merging, provider config, and JSON
helpers from the runner while leaving final ready completion, upload ordering,
cover/artwork handling, share pre-generation, push notification, cleanup, and job
terminal marking in `runner.js`. Direct step-factory tests cover no-live-provider
skip, pass, reroll request, and terminal quality failure. A runner-level
regression test now pins the risky reroll transition before final completion:
quality failure under the reroll limit requeues the job to `instrumental`,
persists tightened `music_plan_json` and quality provenance, and does not publish
ready URLs. Direct step-factory tests passed (30 tests, 30 pass), ready ordering
tests passed (5 tests, 5 pass), expanded render/persona/voice-routing validation
passed (51 tests, 51 pass), syntax checks passed, `git diff --check` passed, and
`npm run lint -- --quiet` passed.

Slice 8 result: `src/workflows/steps/mix.js` now owns the `mix` handler and
`hydrateProviderCompleteAudio`; `runner._testing.hydrateProviderCompleteAudio`
is preserved by re-exporting the imported helper. The extracted family injects
contract guards, provider audio URL/key resolution, live-provider config,
ffmpeg/mixing helpers, guide-vocal recovery, feature flags, storage provider,
path helpers, and placeholder WAV generation from the runner. Direct tests cover
provider-complete local WAV fallback, AI guide-vocal recovery before standard
mixing, personalized Suno missing-stem failure, live missing-input failure, and
non-live placeholder output. The provider-lock source scan now includes the new
mix module. Focused mix/provider-lock/hydration tests passed (53 tests, 53
pass), expanded render/persona/voice-routing validation passed (51 tests, 51
pass), ready ordering tests passed (5 tests, 5 pass), syntax checks passed,
`git diff --check` passed, and `npm run lint -- --quiet` passed.

Slice 9 result: `src/workflows/steps/instrumental.js` now owns
`instrumental` and `instrumental_full` behind one shared family runner. The
extracted family injects contract guards, provider routing, policy preflight,
provider audio URL/key helpers, provenance helpers, Suno polling/recovery
callbacks, generic provider rendering, local fallback instrumental/guide-vocal
renderers, and job task attachment from the runner. The slice deliberately keeps
the closure-heavy Suno polling/recovery helpers in `runner.js` for a smaller
follow-up cleanup, but no workflow step handlers remain inline in the runner.
Direct tests cover preview cache reuse, missing lyrics for preview/full,
personalized guard execution, Suno pending/success/recovery, generic provider
task/provenance handling, changed/blocked policy preflight, and no-provider
fallback generation. The provider-lock source scan now includes the extracted
instrumental module and asserts that `runner.js` no longer defines inline
instrumental handlers. Focused step/provider-lock tests passed (63 tests, 63
pass), adjacent contract/DLQ/persona/hydration tests passed (45 tests, 45 pass),
ready/MVP/classification tests passed (41 tests, 41 pass), endpoint/voice-routing
tests passed (29 tests, 29 pass), and syntax checks passed.

Next Root 5 cleanup candidate: extract the Suno polling/recovery helper pair out
of `runner.js` now that the step handlers themselves are module-owned.

- [ ] **Step 4: Commit each Root 5 slice**

Run:

```bash
git add src/workflows/runner.js src/workflows/steps test/workflows/render-contract.test.js test/workflows/personalized-highway.test.js test/workflows/personalized-step-guards.test.js
git commit -m "refactor: introduce workflow step registry"
```

Expected: runner orchestration is smaller and step dispatch is registry-backed.

## Task 16: Root 6 Admin Split And Client Config Boundary

**Owner:** Two workers after Root 1 and C2 are closed

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/services/admin-service.js`
- Create: `src/routes/admin/*.js`
- Create: `src/services/admin/*.js`
- Create: `src/services/client-config-service.js`
- Modify route that serves mobile app config
- Test: focused `test/admin-*-routes.test.js`
- Test: `test/app-config-route.test.js`

- [x] **Step 1: Move `getAppConfig` composition out of admin service**

Create `src/services/client-config-service.js`:

```js
"use strict";

function createClientConfigService({ appConfigRepository }) {
  async function getClientConfig() {
    return appConfigRepository.getAppConfig();
  }

  return { getClientConfig };
}

module.exports = { createClientConfigService };
```

Wire the mobile app-config route to this service.

Completed locally in this slice:

- `src/services/client-config-service.js` now composes the safe public
  `/app/config` contract from injected config helpers and app-config repository
  reads.
- Existing tests now target `clientConfigService.getClientConfig()` directly;
  the old `AdminService` compatibility delegate was removed in the later Root 6
  facade-reduction pass.
- `/app/config` uses the client-config service instance rather than the admin
  service method.
- Focused coverage added in `test/client-config-service.test.js`.

- [ ] **Step 2: Split one admin route group per file**

Use this route module shape:

```js
"use strict";

async function adminUsersRoutes(fastify, options) {
  const { adminService } = options;

  fastify.get("/users", async (request, reply) => {
    return adminService.users.listUsers(request.query);
  });
}

module.exports = { adminUsersRoutes };
```

Move only one admin concern per commit.

Metrics slice completed locally:

- `src/routes/admin/metrics.js` owns:
  `/admin/dashboard/metrics/overview`, `/admin/dashboard/metrics/jobs`,
  `/admin/dashboard/metrics/costs`, `/admin/dashboard/metrics/enrollment`,
  `/admin/dashboard/metrics/render-pipeline`, and
  `/admin/dashboard/security/risk-metrics`.
- `src/routes/admin.js` now registers the metrics module instead of defining
  those handlers inline.
- `test/admin-job-metrics-routes.test.js` fills the route-level coverage gap
  for `/admin/dashboard/metrics/jobs`; the other metrics routes retain existing
  focused route tests.

Story-session slice completed locally:

- `src/routes/admin/story-sessions.js` owns
  `/admin/dashboard/story/sessions` and
  `/admin/dashboard/story/sessions/:id`.
- `src/routes/admin.js` now registers the story-session module instead of
  defining those handlers inline.
- `test/admin-story-session-routes.test.js` now covers unauthenticated access,
  default ordering, filtered list behavior, detail payload shape, turn ordering,
  and missing-session 404 behavior.

Moderation slice completed locally:

- `src/routes/admin/moderation.js` owns
  `/admin/dashboard/moderation/queue` and
  `/admin/dashboard/moderation/:versionId/override`.
- `src/routes/admin.js` now registers the moderation module instead of defining
  those handlers inline.
- `test/admin-moderation-routes.test.js` now covers unauthenticated queue
  access and verifies override remains superadmin-only before mutation.

Music diagnostics slice completed locally:

- `src/routes/admin/music-diagnostics.js` owns
  `/admin/dashboard/music/diagnostics`.
- `src/routes/admin.js` now registers the music diagnostics module instead of
  defining the handler inline.
- Existing focused route/repository diagnostics coverage remained green.

Job-ops slice completed locally:

- `src/routes/admin/job-ops.js` owns `/admin/dashboard/jobs`,
  `/admin/dashboard/jobs/:id/retry`, `/admin/dashboard/dlq`,
  `/admin/dashboard/dlq/:id/reprocess`, and
  `/admin/dashboard/jobs/:id/steps`.
- `src/routes/admin.js` now registers the job-ops module instead of defining
  those handlers inline in two distant parts of the file.
- `test/admin-job-ops-routes.test.js` fills route-level coverage for job list,
  retry, DLQ list/reprocess, and step-history behavior.
- Follow-up risks discovered but intentionally not changed in this extraction:
  manual job retry does not clear every potentially stale runner-claim field,
  admin DLQ reprocess requeues the same job while workflow DLQ reprocess creates
  a new job, DLQ list includes reprocessed entries, route failure envelopes are
  still broad 400s, and step-history returns empty for missing jobs.

Feature-flag route slice completed locally:

- `src/routes/admin/feature-flags.js` owns
  `/admin/dashboard/feature-flags` GET/PUT.
- `src/routes/admin.js` now registers the feature-flag module instead of
  defining those handlers inline.
- `test/admin-feature-flag-routes.test.js` pins the admin session gate,
  superadmin-only mutation, empty-body validation, service-level validation
  envelope, and successful persisted update behavior.

Demo-share route slice completed locally:

- `src/routes/admin/demo-shares.js` owns `/admin/dashboard/demo-shares`
  GET/POST and `/admin/dashboard/demo-share/:id/revoke`.
- `src/routes/admin.js` now registers the demo-share module instead of defining
  those handlers inline.
- `test/admin-demo-share-routes.test.js` now also pins stale existing song/poem
  demo-share conversion, song revoke audit behavior, missing `resource_id`,
  no-version errors, and concrete error envelopes.

Security observability route slice completed locally:

- `src/routes/admin/security-observability.js` owns security health,
  auth-events, auth-event stats, Apple refresh stats, audit logs, rate-limit
  list/reset, and consent-log routes.
- `src/routes/admin.js` now registers the security observability module while
  keeping security config/App Store sync inline.
- `test/admin-security-observability-routes.test.js` now also pins the security
  health response envelope.

User-read route slice completed locally:

- `src/routes/admin/users-read.js` owns `/admin/dashboard/users`,
  `/admin/dashboard/users/stats`, and `/admin/dashboard/users/:id`.
- `src/routes/admin.js` now registers the user-read module while keeping
  `/admin/dashboard/attribution/health` inline for a later attribution/admin
  health module.
- Existing user-read and attribution route/repository coverage remains green.

User session/voice control route slice completed locally:

- `src/routes/admin/user-session-controls.js` owns user session list,
  single-session revoke, revoke-all, and voice force-reverify routes.
- `src/routes/admin.js` now registers the user session control module after the
  complimentary-upgrade routes.
- Existing session-control route/repository coverage remains green.

User mutation route slice completed locally:

- `src/routes/admin/user-mutations.js` owns risk update, lock/unlock, delete,
  bulk-action, and profile update routes.
- Entitlements and complimentary-upgrade routes intentionally remain inline for
  later billing-adjacent slices.
- `test/admin-user-mutations-routes.test.js` now also pins bulk-action
  validation and audit behavior.

Share-management route slice completed locally:

- `src/routes/admin/shares.js` owns song share list/rebind and poem-share
  list/reset-attempts/revoke routes.
- `src/routes/admin.js` now registers the share-management module before gift
  operations.
- Existing share route/repository coverage remains green.

Webhook-health route slice completed locally:

- `src/routes/admin/webhook-health.js` owns
  `/admin/dashboard/webhooks/health`.
- `src/routes/admin.js` now registers the webhook-health module alongside the
  other Root 6 admin route groups.
- Existing webhook-health route/repository coverage remains green.

Growth route slice completed locally:

- `src/routes/admin/growth.js` owns growth attribution, Apple Ads keyword map,
  teaser metrics, and share-growth metrics routes.
- `src/routes/admin.js` now registers the growth module alongside the other
  Root 6 admin route groups.
- Existing growth metrics, growth repository, and attribution route coverage
  remains green.

KPI route slice completed locally:

- `src/routes/admin/kpis.js` owns `/admin/dashboard/kpis` and
  `/admin/dashboard/kpis/trends`.
- `src/routes/admin.js` now injects `db` into the KPI module for aggregate job
  helper calls.
- Existing KPI route coverage remains green.

Analytics route slice completed locally:

- `src/routes/admin/analytics.js` owns analytics overview, funnel, daily event,
  and per-user event routes.
- The route-level comment documenting cache and audit behavior moved with the
  analytics routes.
- Existing admin analytics route and service boundary coverage remains green.

Attribution-health route follow-up completed locally:

- `src/routes/admin/growth.js` also owns
  `/admin/dashboard/attribution/health`.
- Existing attribution and growth route coverage remains green.

Gift-ops route slice completed locally:

- `src/routes/admin/gift-ops.js` owns gift overview, order list/detail, outbox,
  incident list/acknowledge, retry, cancel, overdue-review, and manual recovery
  note routes.
- Gift-ops schema migration error handling and read-role constants moved with
  the route group.
- Existing gift-ops route and repository coverage remains green.

Blog CMS route slice completed locally:

- `src/routes/admin/blog.js` owns admin blog list/detail/create/update/preview,
  autofill, review, repair, publish, and unpublish routes.
- Blog payload validation and target-intent constants moved with the blog route
  group.
- Existing blog CMS and public blog lifecycle coverage remains green.

Track-transfer route slice completed locally:

- `src/routes/admin/track-transfer.js` owns
  `/admin/dashboard/tracks/:trackId/transfer`.
- Track-transfer verification logic moved with the route group.
- Existing track-transfer route and repository coverage remains green.

Provider/queue control route slice completed locally:

- `test/admin-control-routes.test.js` now characterizes provider and queue
  route auth, validation, and mutation envelopes.
- `src/routes/admin/provider-queue-control.js` owns provider and queue status
  list/update routes.
- Existing control route/repository/service coverage remains green.

Provider-config route slice completed locally:

- `test/admin-provider-config-routes.test.js` now characterizes STT and music
  config route auth, validation, and response decoration.
- `src/routes/admin/provider-config.js` owns STT config and music provider
  routing config routes.
- Existing STT/music route and service coverage remains green.

Onboarding-sample route slice completed locally:

- `test/admin-onboarding-sample-routes.test.js` now characterizes admin auth,
  superadmin mutation gates, validation errors, activate not-found mapping, and
  delete envelopes.
- `src/routes/admin/onboarding-samples.js` owns onboarding sample list/create/
  update/activate/delete routes.
- Existing onboarding-sample route/service/repository coverage remains green.

Client-config route slice completed locally:

- `src/routes/client-config.js` owns the public `/app/config` route handler.
- The route still receives the existing `clientConfigService` instance from the
  admin registration boundary, so this slice does not change service lifetime or
  server registration order.
- Existing `test/app-config-route.test.js` coverage remains green.

Blend-analysis route slice completed locally:

- `test/admin-blend-analysis-routes.test.js` now characterizes admin auth,
  superadmin-only path analysis, storage-scope validation, missing
  `trackVersionId`, and missing track-version behavior.
- `src/routes/admin/blend-analysis.js` owns the blend diagnostics handlers for
  `/admin/dashboard/analyze-blend` and `/admin/dashboard/analyze-blend/paths`.
- Existing admin music diagnostics repository coverage remains green.

Security-config route slice completed locally:

- `test/admin-security-config-routes.test.js` now characterizes admin auth,
  superadmin-only updates/sync, validation errors, readback, and App Store sync
  failure mapping.
- `src/routes/admin/security-config.js` owns security config read/update and
  `/admin/dashboard/security/config/sync-ios-version`.
- Existing STT/app-config update-policy coverage remains green.

Static admin UI route slice completed locally:

- `src/routes/admin/static-ui.js` owns the admin SPA and asset serving routes.
- Cloudflare Access and admin UI mode decisions remain injected from
  `admin.js`; the static module owns MIME type, traversal guard, and SPA
  fallback behavior.
- Existing `test/hosting-hardening.test.js` coverage remains green.

Marketing route slice completed locally:

- `src/routes/admin/marketing.js` owns marketing email templates, contacts,
  contact upload/export, campaigns, cold-email read/PATCH/trigger, push send,
  GMass import, and campaign engagement routes.
- Marketing-only CSV, status, boolean-filter, push-target, cold-email, and
  template allowlist helpers moved with the route group.
- Existing `test/admin-marketing-routes.test.js` and
  `test/admin-marketing-repository.test.js` coverage remains green.

Billing route slice completed locally:

- `src/routes/admin/billing.js` owns entitlement mutation, complimentary
  upgrade/revoke, billing revenue/subscription/sales/transaction reads,
  `/admin/billing/plans`, and gift-bundle management routes.
- Existing entitlement, gift-bundle, billing-sales, and admin-billing
  repository coverage remains green.

Admin-auth route slice completed locally:

- `test/admin-auth-routes.test.js` characterizes setup-disabled, me/logout,
  change-password validation/session invalidation, forgot-password generic
  response, and invalid reset-token behavior.
- `src/routes/admin/auth.js` owns `/admin/auth/*` route handlers plus the
  admin-auth rate-limit helper.
- `src/routes/admin.js` now has no direct `app.get/post/put/delete/patch`
  handlers; it composes route registrars, shared guards, repositories, and
  services.
- Existing admin-login hardening, default-seed, and admin-auth repository
  coverage remains green.

- [x] **Step 3: Run admin validation**

Run:

```bash
node --test --test-concurrency=1 test/app-config-route.test.js test/admin-user-read-routes.test.js test/admin-metrics-repository.test.js test/admin-share-routes.test.js
npm run lint
```

Expected: selected tests pass and lint passes.

- [x] **Step 4: Commit Root 6 route extraction**

Run:

```bash
git add src/routes/admin.js src/routes/admin src/services/admin-service.js src/services/admin src/services/client-config-service.js test/app-config-route.test.js test/admin-*.test.js
git commit -m "refactor: split admin routes and client config service"
```

Actual: Root 6 route extraction was committed incrementally through
`47574500 refactor: extract admin auth routes`; `src/routes/admin.js` is now a
registrar shell, `/app/config` lives in `src/routes/client-config.js`, and the
architecture map records remaining Root 6 work as admin-service decomposition.

Root 6 service-boundary follow-up: admin story-session service ownership is now
extracted into `src/services/admin/story-session-service.js`. `AdminService`
remains the compatibility facade for `listStorySessions` and
`getStorySessionDetail`, while the new service owns pagination bounds and
repository delegation. Focused repository/service and route validation passed
for the admin story-session contract.

Root 6 service-boundary follow-up: admin webhook-health service ownership is now
extracted into `src/services/admin/webhook-health-service.js`. `AdminService`
remains the compatibility facade for `getWebhookHealth`, while the new service
owns the 24-hour audit window and pending-retry placeholder decoration. Focused
service, repository, and route validation passed for the admin webhook-health
contract.

Root 6 service-boundary follow-up: admin system-health service ownership is now
extracted into `src/services/admin/system-health-service.js`.
`src/routes/admin/security-observability.js` now calls that service directly
for the admin health endpoint instead of passing through `AdminService`. The
service owns the 24-hour job/DLQ window, normalized operational counters,
recent-error delegation, and checked timestamp. Focused service, route, and
adjacent job-ops validation passed for the admin system-health contract.

Root 6 service-boundary follow-up: admin metrics service ownership is now
extracted into `src/services/admin/metrics-service.js`. `AdminService` remains
the compatibility facade for overview, cost, enrollment, render-success, and
risk metrics, while the new service owns deterministic metric windows and risk
escalation metadata parsing. Focused repository/service and route validation
passed for the admin metrics contracts.

Root 6 service-boundary follow-up: teaser and share-growth metrics are now also
owned by `src/services/admin/metrics-service.js`. `src/routes/admin/growth.js`
now calls that service directly for `getTeaserMetrics` and `getShareMetrics`;
the metrics service owns growth metric windows and rate formatting. Focused
repository/service and route validation passed for the growth metrics contracts.

Root 6 service-boundary follow-up: admin user-read service ownership is now
extracted into `src/services/admin/user-read-service.js`. `AdminService`
remains the compatibility facade for `searchUsers`, `getUserStats`, and
`getUserDetail`, while the new service owns bounded filter delegation,
attribution enrichment/merge, stats conversion formatting, detail fan-out, and
missing-user no-fanout behavior. Focused repository/service and route validation
passed for the admin user-read contracts.

Root 6 service-boundary follow-up: admin user-mutation service ownership is now
extracted into `src/services/admin/user-mutation-service.js`.
`src/routes/admin/user-mutations.js` now calls that service directly for risk
updates, lock/unlock, delete, bulk actions, and profile updates instead of
passing through `AdminService`. The service owns risk/lock audit contracts,
fixed one-year lock calculation, audit-before-delete ordering, bulk action
sequencing, profile allowlist filtering, and attribution override audit
envelopes. Focused service and route validation passed for the admin user
mutation contracts.

Root 6 service-boundary follow-up: admin entitlement tier-update service
ownership is now extracted into `src/services/admin/entitlements-service.js`.
`src/routes/admin/billing.js` now calls that service directly for
`updateUserEntitlements` instead of passing through `AdminService`. The service
owns tier allowlist validation, empty-update envelopes, repository timestamp
injection for missing entitlement rows, previous-tier defaulting, and
`admin_update_entitlements` audit metadata. Focused service, route, user-read,
and subscription-manager validation passed for the admin entitlement contracts.

Root 6 service-boundary follow-up: admin billing/revenue read ownership is now
extracted into `src/services/admin/billing-service.js`.
`src/routes/admin/billing.js` now calls that service directly for revenue
metrics, receipt-backed sales, subscription health, and billing transactions
instead of passing through `AdminService`. The service owns product-catalog
fallback, counted-sale filtering and pagination, subscriber normalization,
currency-bucket aggregation, mixed-currency scalar fallback, and transaction
projection. Focused service, route, repository, entitlement, and
subscription-manager validation passed for the admin billing read contracts.

Root 6 service-boundary follow-up: admin analytics service ownership is now
extracted into `src/services/admin/analytics-service.js`. `AdminService`
remains the compatibility facade for analytics overview, daily event, funnel,
and per-user event reads, while the new service owns aggregate caching,
days/limit clamping, funnel hop policy, conversion-rate formatting, and
traceable analytics read audits. Focused repository/service and route validation
passed for the admin analytics contracts.

Root 6 service-boundary follow-up: admin growth/attribution service ownership is
now extracted into `src/services/admin/growth-service.js`. The follow-up
facade-reduction slice now routes growth/attribution endpoints directly to
`adminGrowthService` and teaser/share metrics directly to `adminMetricsService`,
removing `AdminService` pass-throughs for attribution health, attribution
dashboard, Apple Ads keyword-map reads/sync, and teaser/share metrics. Focused
repository/service and route validation passed for the admin growth contracts.

Root 6 service-boundary follow-up: admin audit-write ownership is now extracted
into `src/services/admin/audit-service.js`. `src/routes/admin/demo-shares.js`
and `src/routes/admin/billing.js` now call that service directly for their
audit writes instead of going through the former `AdminService` audit facade.
`AdminService` now injects `adminAuditService.audit` directly into child admin
services, while the audit service owns audit ID generation, timestamp
normalization, admin metadata enrichment, and
`EventsRepository.insertAuditLog` payload construction.
Focused audit service, analytics, demo-share, share, and gift-ops validation
passed for audit-writing contracts.

Root 6 facade-reduction follow-up: feature-flag and onboarding-sample admin
routes now call their dedicated services directly instead of passing through
`AdminService` delegate methods. Removed `AdminService.getAllFeatureFlags`,
`updateFeatureFlags`, `getOnboardingSamples`, `getActiveOnboardingSample`,
`createOnboardingSample`, `updateOnboardingSample`, `deleteOnboardingSample`,
and `activateOnboardingSample`; focused feature-flag, onboarding-sample, and
public app-config validation passed.

Root 6 facade-reduction follow-up: provider/queue control, moderation,
story-session, webhook-health, and music-diagnostics admin routes now call their
dedicated services directly instead of passing through `AdminService` delegate
methods. Removed the matching facade methods for provider/queue status,
moderation queue/override, story-session list/detail, webhook health, and recent
music diagnostics. Focused route, service, and repository-integration validation
passed for those admin boundaries.

Root 6 facade-reduction follow-up: user-read admin routes now call
`adminUserReadService` directly instead of passing through `AdminService`.
Removed `AdminService.searchUsers`, `getUserStats`, and `getUserDetail`; focused
user-read route, service, and repository validation passed.

Root 6 facade-reduction follow-up: analytics admin routes now call
`adminAnalyticsService` directly instead of passing through `AdminService`.
Removed `AdminService.getAnalyticsOverview`, `getAnalyticsDaily`,
`getFunnelCohort`, and `getUserAnalytics`; focused analytics route and service
validation passed. The remaining `AdminService` audit-boundary test is deferred
to the later audit facade cleanup.

Root 6 facade-reduction follow-up: metrics admin routes now call
`adminMetricsService` directly for overview, cost, enrollment, render-pipeline,
and risk metrics, and `adminJobOpsService` directly for job metrics. Removed
`AdminService.getOverviewMetrics`, `getJobMetrics`, `getCostMetrics`,
`getEnrollmentMetrics`, `getRenderSuccessMetrics`, and `getRiskMetrics`;
focused metrics route, repository, and service validation passed.

Root 6 facade-reduction follow-up: share-management admin routes now call
`adminShareManagementService` directly instead of passing through
`AdminService`. Removed `AdminService.listShares`, `rebindShare`,
`listPoemShares`, `resetPoemShareAttempts`, and `revokePoemShare`; focused
share route, service, and repository validation passed.

Root 6 facade-reduction follow-up: user session/voice-control admin routes now
call `adminUserSessionControlService` directly instead of passing through
`AdminService`. Removed `AdminService.forceVoiceReverify`, `getUserSessions`,
`revokeUserSession`, and `revokeAllUserSessions`; focused route, service, and
repository validation passed.

Root 6 facade-reduction follow-up: job/DLQ admin routes now call
`adminJobOpsService` directly instead of passing through `AdminService`.
Removed `AdminService.listJobs`, `retryJob`, `listDLQ`, `reprocessDLQ`, and
`getJobStepHistory`; focused route, service, and repository-integration
validation passed.

Root 6 facade-reduction follow-up: security config/App Store sync admin routes
now call `adminSecurityConfigService` directly instead of passing through
`AdminService`. Removed `AdminService.getSecurityConfig`,
`updateSecurityConfig`, `syncIOSVersionFromAppStore`, and the unused
`resolveIOSAppUpdatePolicy` compatibility method; focused route, service, and
STT/client-config validation passed.

Root 6 facade-reduction follow-up: growth/attribution admin routes now call
`adminGrowthService` directly and teaser/share growth metrics now call
`adminMetricsService` directly instead of passing through `AdminService`.
Removed `AdminService.getAttributionHealth`, `getAttribution`,
`getAppleAdsKeywordMap`, `upsertAppleAdsKeywordMap`, `getTeaserMetrics`, and
`getShareMetrics`; focused attribution, growth-service, growth-metrics, and
attribution-repository validation passed.

Root 6 facade-reduction follow-up: user mutation admin routes now call
`adminUserMutationService` directly instead of passing through `AdminService`.
Removed `AdminService.updateUserRisk`, `lockUser`, `deleteUser`,
`bulkUserAction`, and `updateUserProfile`; focused user-mutation route,
service, repository, and attribution-contract validation passed.

Root 6 facade-reduction follow-up: security observability admin routes now call
`adminSecurityObservabilityService` directly and the admin security health
endpoint now calls `adminSystemHealthService` directly instead of passing
through `AdminService`. Removed `AdminService.getSystemHealth`,
`searchAuthEvents`, `getAuthEventStats`, `getAppleRefreshTokenStats`,
`searchAuditLogs`, `getRateLimits`, `resetUserRateLimit`, and `getConsentLogs`;
focused security-observability, system-health, and adjacent job-ops validation
passed.

Root 6 facade-reduction follow-up: provider-config admin routes now call
`adminProviderConfigService` directly instead of passing through
`AdminService`; `clientConfigService` composition now reads STT/music provider
config from that service directly. Removed `AdminService.getSTTConfig`,
`setSTTConfig`, `getMusicProviderConfig`, and `setMusicProviderConfig`;
focused provider-config route/service, STT config, music provider config,
client config, and provider runtime validation passed.

Root 6 facade-reduction follow-up: billing admin routes now call
`adminEntitlementsService` for entitlement updates and `adminBillingService`
for revenue, sales, subscription health, and billing transactions instead of
passing through `AdminService`. Removed `AdminService.updateUserEntitlements`,
`getRevenueMetrics`, `getBillingSales`, `getSubscriptionHealth`, and
`getBillingTransactions`; focused entitlement, billing service, billing
repository, and billing route validation passed. Billing plan/gift-bundle audit
writes now also call `adminAuditService.audit` directly.

Root 6 facade-reduction follow-up: demo-share admin routes now call
`adminAuditService.audit` directly for create/revoke audit writes instead of
passing through the former `AdminService` audit facade; focused demo-share
route/repository and audit-service validation passed.

Root 6 facade-reduction follow-up: billing admin routes now call
`adminAuditService.audit` directly for plan and gift-bundle audit writes
instead of passing through the former `AdminService` audit facade; focused
billing route, repository, and audit-service validation passed.

Root 6 facade-reduction follow-up: gift-ops admin routes now call
`adminAuditService.audit` directly for incident acknowledgement, retry, cancel,
overdue-review, and manual-recovery-note audit writes instead of passing
through the former `AdminService` audit facade; focused gift-ops
route/repository and audit-service validation passed.

Root 6 facade-reduction follow-up: blog CMS admin routes now call
`adminAuditService.audit` directly for create, update, review, repair, publish,
and unpublish audit writes instead of passing through the former `AdminService`
audit facade; focused blog route/service/repository and audit-service
validation passed.

Root 6 facade-reduction follow-up: marketing admin routes now call
`adminAuditService.audit` directly for contact upload/export, campaign
create/update, push send, results import, and cold-email manual trigger/update
audit writes instead of passing through the former `AdminService` audit facade;
focused marketing route/repository and audit-service validation passed.

## Task 17: Root 7 Writer Decomposition

**Owner:** One worker

**Files:**
- Modify: `src/writer/songwriter.js`
- Modify or create focused files under `src/writer/`
- Test: `test/writer/songwriter-fidelity.test.js`
- Test: `test/writer/e2e-story-to-lyrics.test.js`

- [x] **Step 1: Run writer characterization tests**

Run:

```bash
node --test --test-concurrency=1 test/writer/songwriter-fidelity.test.js test/writer/e2e-story-to-lyrics.test.js
```

Expected: all selected tests pass.

- [x] **Step 2: Move serialization and prompt-building helpers**

Use focused module exports:

```js
"use strict";

function buildSongPrompt(input) {
  return input.sections.join("\n\n");
}

module.exports = { buildSongPrompt };
```

Keep provider invocation in the orchestration file.

2026-06-29 code-first slice: moved LLM input normalization to
`src/writer/songwriter/text-normalization.js` and lyrics draft / prior-section
serialization to `src/writer/songwriter/prompt-serialization.js`. Provider
invocation and generation orchestration remain in `songwriter.js`.

- [x] **Step 3: Run writer validation and commit**

Run:

```bash
node --test --test-concurrency=1 test/writer/songwriter-fidelity.test.js test/writer/e2e-story-to-lyrics.test.js
npm run lint
git add src/writer test/writer
git commit -m "refactor: split writer prompt responsibilities"
```

Expected: writer behavior remains stable and files are smaller by responsibility.

## Task 18: Root 8 Cleanup Sweep

**Owner:** Controller plus one explorer worker

**Files:**
- Remove unused exports/files found by scan
- Update docs that reference old file ownership

- [ ] **Step 1: Scan for dead code and duplicate compatibility paths**

Run:

```bash
rg -n "deprecated|compat|legacy|temporary|remove after|old path" src docs test
```

Expected: every hit is classified as keep, delete, or doc-update.

- [ ] **Step 2: Delete only paths proven unused by tests and imports**

For each candidate file:

```bash
rg -n "candidateExportOrPath" src test docs
```

Expected: delete only when no runtime import or documented public contract remains.

Slice 1 result: removed the obsolete internal `shouldFireToday` export from
`src/services/cold-email-service.js`. Production, job, admin, script, and tool
callers already use the canonical `shouldFireNow` schedule gate; the only
remaining reference was a compatibility unit test, which now asserts the old
alias is gone. Focused cold-email service/job validation passed: 40 tests, 40
pass, 0 failures.

- [ ] **Step 3: Run validation and commit**

Run:

```bash
npm run lint
npm test
git add -A
git commit -m "refactor: remove obsolete architecture compatibility paths"
```

Expected: lint and full test suite pass.

## Task 19: Root 9 Migration Convergence

**Owner:** One worker plus controller review

**Files:**
- Modify: `tools/verify-migration-parity.js`
- Modify migration files under `migrations/` and `migrations/pg/` only when convergence needs it
- Document intentional migration filename drift in architecture docs
- Test: `test/database/migration-runner.test.js`
- Test: `test/postgres-schema-parity.test.js`
- Test: `test/database/postgres-migration.test.js`

- [x] **Step 1: Run migration characterization tests**

Run:

```bash
node --test --test-concurrency=1 test/database/migration-runner.test.js test/postgres-schema-parity.test.js test/database/postgres-migration.test.js
```

Expected: all selected tests pass.

- [x] **Step 2: Consolidate migration runner behavior**

The stale `src/database/migrations/runner.js` target no longer exists. Tests now
exercise the live migration infrastructure in `src/database/postgres.js`; the
abandoned `src/database/migrations/` consolidation has been deleted. Migration
filename drift is guarded by `tools/verify-migration-parity.js` and documented
as reviewed exceptions rather than left as untracked divergence.

- [x] **Step 3: Run validation and commit**

Run:

```bash
npm run verify:migrations
node --test --test-concurrency=1 test/database/migration-runner.test.js test/postgres-schema-parity.test.js test/database/postgres-migration.test.js
npm run lint
git add tools/verify-migration-parity.js migrations migrations/pg test/database test/postgres-schema-parity.test.js docs/architecture
git commit -m "refactor: converge database migration boundaries"
```

Expected: migration behavior is centralized and validated.

2026-06-29 closure pass: `npm run verify:migrations` passed and the migration
runner/schema suites passed 14/14. No production migration was applied.

## Task 20: Root 10 Storage Interface Parity And OpenAPI

**Owner:** One worker plus controller review

**Files:**
- Modify: `src/storage/*.js`
- Create or update: `docs/api/openapi.yaml`
- Modify: `docs/api/error-envelope.md`
- Test: `test/storage/*.test.js`
- Test: `test/storage-security.test.js`

- [ ] **Step 1: Run storage characterization tests**

Run:

```bash
node --test --test-concurrency=1 test/storage/local.test.js test/storage/s3.test.js test/storage/cloudfront.test.js test/storage-security.test.js
```

Expected: all selected tests pass.

- [ ] **Step 2: Normalize storage interface**

Use a consistent adapter shape:

```js
async function putObject({ key, body, contentType, metadata }) {
  return provider.putObject({ key, body, contentType, metadata });
}
```

No route should branch on S3/local implementation details.

- [ ] **Step 3: Create OpenAPI shell for stabilized backend contracts**

Create `docs/api/openapi.yaml` with documented routes for auth, sharing, tracks, poems, billing, and story create flow. Reference `docs/api/error-envelope.md` for errors.

- [ ] **Step 4: Run validation and commit**

Run:

```bash
node --test --test-concurrency=1 test/storage/local.test.js test/storage/s3.test.js test/storage/cloudfront.test.js test/storage-security.test.js
npm run lint
git add src/storage docs/api test/storage test/storage-security.test.js
git commit -m "docs: add storage parity and API contract map"
```

Expected: storage adapter behavior is consistent and backend contracts are documented.

## Task 21: Root 11 Cross-Surface Create Flow And SwiftUI State

**Owner:** iOS-focused worker after backend contracts stabilize

**Files:**
- Backend create-flow contracts under `src/routes/story.js`, `src/routes/tracks.js`, and OpenAPI docs
- SwiftUI files under `PorizoApp/`
- Admin or web-player files only where create-flow contract assumptions are visible
- Tests: backend story/track contract tests and Swift/Xcode validation appropriate to the touched app target

- [x] **Step 1: Confirm backend contract before iOS changes**

Run:

```bash
node --test --test-concurrency=1 test/story-to-track-contract.test.js test/render-endpoints.test.js test/routes/story-lyrics-contract.test.js
```

Expected: all selected backend contract tests pass.

- [x] **Step 2: Replace boolean-plus-payload SwiftUI presentation**

Use item-driven presentation for selected create payloads:

```swift
.sheet(item: $selectedCreatePayload) { payload in
    CreateFlowView(payload: payload)
}
```

Do not present a create flow from a Boolean when the payload can be stale or empty.

- [x] **Step 3: Run iOS validation**

Run the repository-approved Xcode/SwiftUI validation from `docs/ios-swiftui-release-workflow.md` for touched targets.

Expected: build/tests for the touched iOS target pass.

Status 2026-06-29:
- `MainTabView` gift send launch now uses `.fullScreenCover(item:)`.
- `GiftSendFlowView` bundle picker now carries the requested `CreateFlowKind` in the sheet item instead of `showBundlePicker` plus `pendingCreateType`.
- `WarmCanvasFlowView` upgrade sheet now carries `CreateFlowKind` in `ActiveSheet.upgrade(type)` instead of separate pending entitlement state.
- Backend story/create routes now persist canonical `funding_source = 'gift_wallet'` for gift-funded tracks and poems, while render/library read paths keep legacy `gift_token` compatibility.
- PostgreSQL repair migration now aligns poem funding-source constraints with track constraints.
- Validation passed: backend story/render contracts, gift/library repository tests, PG schema repair/parity, migration parity, lint, diff check, JS syntax checks, and XcodeBuildMCP simulator build.

- [x] **Step 4: Commit Root 11**

Run:

```bash
git add PorizoApp src/routes docs/api test
git commit -m "refactor: align create flow contracts across backend and iOS"
```

Expected: backend and iOS create-flow state ownership are aligned.

Status 2026-06-29: committed as `0e10017e refactor: align create flow state and gift funding`.

## Final Verification Gate

**Owner:** Controller

- [ ] **Step 1: Ensure no workers remain open**

Close any completed worker with `close_agent`. If a worker is blocked, close it after recording the blocker in the plan status section.

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run lint
npm test
```

Expected: lint passes and full Node test suite passes. If full-repo validation reports failures, fix them before handoff unless Ambrose explicitly removes them from scope.

- [ ] **Step 3: Update architecture map**

Update:

```text
docs/architecture/architecture-map-2026-06.md
docs/architecture-and-flows.md
docs/architecture/architecture-debt-register-2026-06.md
```

Expected: the docs agree on current architecture, repository ownership, Fastify/plugin ownership, workflow boundaries, API error envelope, storage boundary, and cross-surface create flow.

- [ ] **Step 4: Commit final documentation**

Run:

```bash
git add docs/architecture/architecture-map-2026-06.md docs/architecture-and-flows.md docs/architecture/architecture-debt-register-2026-06.md
git commit -m "docs: finalize architecture refactor map"
```

Expected: final docs commit is on `refactor`.

- [ ] **Step 5: Finish the development branch**

Use `superpowers:finishing-a-development-branch`. Present Ambrose the standard completion options after tests pass.

## Plan Self-Review

- Spec coverage: the plan covers Root 1 termination, Root 2 auth/rate-limit consolidation, C2 documentation, Root 3b gift extraction, Root 5 runner registry, Root 6 admin/client-config split, Root 7 writer split, Root 8 cleanup, Root 9 migrations, Root 10 storage/OpenAPI, and Root 11 cross-surface create-flow alignment.
- Placeholder scan: the plan uses concrete files, commands, expected outputs, worker assignments, and repository code patterns. Any worker that finds an unmapped query must stop with `NEEDS_CONTEXT` instead of guessing ownership.
- Type consistency: repository factories follow the existing `createXRepository(db)` CommonJS pattern; route wiring uses local `buildXRepositories(db)` helpers; worker branches use date-stamped `refactor-root1-*-20260628` names.
