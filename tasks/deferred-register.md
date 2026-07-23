# Deferred Register

Consciously deferred findings — each with why, an un-defer trigger, and status.

## 2026-07-16 — Rate-limiter concurrency test on real Postgres (review P1-2)

- **Why deferred:** The reported over-admission race was **disproven by inspection**: `src/database/postgres.js` `transaction()` issues real `BEGIN`/`COMMIT` on a dedicated client, so the `INSERT … ON CONFLICT DO UPDATE` row lock serializes same-key consumers until commit; the sqlite path is synchronous (no interleaving). A true regression test needs parallel fire against real Postgres (`test:pg` harness), which sql.js cannot exercise — infrastructure work disproportionate to a disproven finding.
- **Un-defer trigger:** any refactor of `rate-limit-repository.js` that moves the increment/decision out of the `db.transaction` wrapper, or a move to autocommit/statement-level queries; or first real-traffic anomaly in `web_preview` counters.
- **Source:** backend security review 2026-07-16, finding P1-2.
- **Status:** N/A (not a bug as written); guard comment worth adding on next touch of the file.

## 2026-07-16 — `ip:unknown` bucket collapse (review P2-2)

- **Why deferred:** availability-only degradation (shared cap bucket when no client IP resolves); spend safety unaffected (per-guest cap + global breaker hold). Occurs only when `TRUST_CLOUDFLARE_CLIENT_IP` unset AND no socket peer — not a production topology.
- **Un-defer trigger:** funnel deploys behind a proxy chain where socket peers stop resolving, or support reports of spurious 429s on `/web/session`.
- **Source:** backend security review 2026-07-16, finding P2-2.
- **Status:** scoped-down-v1 (documented accepted behavior).

## 2026-07-16 — Stolen guest-cookie replay (review P2-1)

- **Why deferred:** accepted risk — `__Host-` + HttpOnly + Secure + (now) SameSite=Strict; guest drafts are low-value anonymous data; convergence to a real account re-keys everything at purchase.
- **Un-defer trigger:** guests gain access to anything beyond their own drafts (e.g., payment methods, saved addresses).
- **Source:** backend security review 2026-07-16, finding P2-1.
- **Status:** N/A (accepted risk, documented).

## Etsy landing: same-buyer reload shows "already used" instead of forwarding (2026-07-23)

- **Why deferred:** the pre-check GET is deliberately side-effect-free and has no session context, so it cannot distinguish same-buyer from other-buyer. The "cheap" fix (always attempt the idempotent redeem) trades that purity for an always-mutating call and burns a rate-limit token per reload. Buyer's credit is safe either way and /create resumes them.
- **Un-defer trigger:** reload-confusion shows up in Etsy support message volume.
- **Source:** etsy-final-review (opus) finding (8), 2026-07-23; builder offered the follow-up in its report.
- **Status:** scoped-down-v1 (warm "already used → contact via Etsy messages" state shipped).
