# Lessons Learned

Patterns and rules to prevent repeated mistakes. Review at session start.

---

## Session Rules

### 2026-02-21 — Every terminal state in financial workflows needs a test

**Trigger:** Building any feature where tokens/credits are spent
**Mistake:** The gift dispatch happy path (spent → sent) had a refund on cancel, but the failure path (spent → failed) silently ate the token. Only the golden path was tested.
**Rule:** For every `spend` operation, enumerate ALL terminal states and verify each one handles the financial consequence:
- `spent → sent` ✓
- `spent → failed → refunded` ← was missing
- `spent → cancelled → refunded` ✓

### 2026-02-21 — State machines need stuck-state recovery

**Trigger:** Any workflow that uses status locking (`SET status = 'processing'`)
**Mistake:** `dispatchGiftById` locked the row to `dispatching` but had no try/catch — an unhandled exception left the row permanently stuck. The poller only queries `scheduled` and `dispatch_retry`, so stuck rows were invisible.
**Rule:** Every status lock MUST have a corresponding recovery mechanism:
- Wrap in try/catch that resets to retryable state
- OR add a sweeper that reclaims rows stuck in transient states for > N minutes
- Always increment attempt counter in the catch block to prevent infinite retry loops

### 2026-02-21 — Claim/PIN systems need adversarial review

**Trigger:** Building any PIN-protected or attempt-limited access flow
**Mistake:** Anonymous poem unlock reset `claim_attempts` to 0 — reasonable for UX (allow re-visits) but enables brute-force bypass. Nobody asked "what can an attacker do with this?"
**Rule:** Before shipping any claim/PIN system, run a 5-minute adversarial review:
1. What happens if someone tries all PINs? (lockout must be effective)
2. Does any success path reset the lockout counter? (it shouldn't for unauthenticated flows)
3. Is there a rate limit on top of the attempt counter?

### 2026-02-21 — Integration steps go on pre-submission checklist, not code comments

**Trigger:** Features that depend on external configuration (Apple Developer portal, DNS, CDN)
**Mistake:** Universal links were commented out with `<!-- requires provisioning profile update -->`. External-dependency tasks get deferred and forgotten because they can't be tested locally.
**Rule:** When code depends on external setup:
1. Add the external step to the pre-submission checklist (not a code comment)
2. Create a test that verifies the integration works (e.g., AASA route test)
3. Code comments should reference the checklist item, not be the only record

### 2026-02-21 — Atomic operations for concurrent financial data

**Trigger:** Any read-modify-write on balances, counters, or inventory
**Mistake:** Wallet used `SELECT balance` → compute → `UPDATE balance`. Works in dev (single user), fails under concurrent load (double-spend).
**Rule:** Financial mutations must be atomic:
- Use `UPDATE ... SET balance = balance + ? WHERE (balance + ?) >= 0` (single SQL statement)
- PostgreSQL: use `RETURNING` for the new value
- SQLite: check `changes > 0` (serialized writes make this safe)
- Never trust a value you read in a previous query for a write condition

### 2026-02-21 — Secondary paths get less rigor — compensate explicitly

**Trigger:** Adding a "shortcut" or "already handled" path after the primary flow is built
**Mistake:** PoemClaimView's re-open path used `shareId` as poem ID and `previewLines` as verses because the dev was working with data available in the share info response, not data the poem actually needs.
**Rule:** When adding a secondary path (re-open, cache hit, already-authenticated):
1. Verify it produces the EXACT same data shape as the primary path
2. If it can't, call the primary path instead of reconstructing data
3. Add a test that exercises the secondary path specifically

---

## Patterns to Avoid

### Success-bias implementation
Building the golden path fully (with refunds, audit entries, events) but treating the failure path as "just set status = failed." Every state transition deserves the same rigor.

### Comment-driven deferral
`// TODO: requires X` or `<!-- requires provisioning -->` as the sole record of an integration dependency. These are invisible to checklists and QA.

### Read-modify-write on shared mutable state
`SELECT x` → compute → `UPDATE x` is never safe under concurrency. Always use atomic SQL operations for counters, balances, and inventory.

---

## Patterns That Work

### Refund-before-status-update
When a financial operation fails permanently, refund FIRST, then update status. If the refund throws, the row stays in a retryable state and the next cycle re-attempts. This prevents the "token lost, no retry path" failure mode.

### Idempotency keys on financial operations
`gift_refund_dispatch_{giftId}` ensures that crash-recovery retries don't double-refund. Every financial mutation should have an idempotency key derived from the triggering event.

### Re-use idempotent endpoints instead of reconstructing data
PoemClaimView's `reClaimPoem()` calls the same claim endpoint (which is idempotent for bound users) instead of building a fake Poem object from incomplete data. Fewer code paths = fewer bugs.

### Atomic UPDATE with WHERE guard
`UPDATE wallet SET balance = balance - 1 WHERE balance >= 1` is both the check and the mutation in one statement. No race window. Works on both PostgreSQL and SQLite.

---

## Workflow Improvement Candidates

> These patterns are candidates for upgrading from "lessons" to enforceable workflow rules.
> When we're ready to formalize, each can become a hook, checklist gate, or review agent trigger.

1. **Financial state audit** — After implementing any spend/credit feature, require a test for every terminal state (success, failure, cancel, timeout) that verifies the financial consequence (refund, hold release, etc.)

2. **Stuck-state sweeper** — Any new state machine should declare its transient states and maximum dwell time. A pre-submission check could grep for status locks without corresponding recovery.

3. **Adversarial claim review** — Before any PIN/token-gated flow ships, trigger a security-reviewer agent focused specifically on lockout bypass, counter reset, and rate limit gaps.

4. **Integration dependency tracker** — Replace code comments with a structured file (`docs/integration-deps.md`) that lists external setup steps. Pre-submission hook verifies all items are checked off.

5. **Concurrency test requirement** — Any function that mutates shared numeric state (balances, counters) should have a concurrent test that runs 2+ simultaneous mutations and verifies no over-count/under-count.
