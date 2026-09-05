# Etsy production OAuth callback

## Objective

Replace the one-time localhost Etsy authorization return with a durable production callback at `https://porizo.co/integrations/etsy/callback`. Let a superadmin initiate an Etsy reconnect from Admin. Store and rotate tokens in the existing encrypted connection record. Deploy only after local verification, then update Etsy and perform one real authorization.

## Architecture

The domain model is an authorization request with one state field:

```
pending -- Etsy callback with matching state and code --> consumed
pending -- expiration --> expired
```

`etsy_oauth_authorizations` stores a SHA-256 state hash, encrypted PKCE verifier, requesting admin ID, timestamp, expiry, and consumed timestamp. The state and verifier never appear in application logs or response bodies. A superadmin starts an authorization at `/admin/dashboard/etsy/mto/connection/start`; it returns Etsy's URL. Etsy returns to `/integrations/etsy/callback`, which atomically claims the row, exchanges the code, checks the read-only scopes, encrypts the tokens in `etsy_connections`, and redirects to `/admin/etsy?etsy=connected`.

## Throughput checkpoint

- **Blocking first steps.** Confirm production `porizo.co` routes to the Porizo service and inspect current server/admin boundaries before code.
- **Independent workstreams.** None. The database contract, service, route and admin action share one state machine and must be integrated serially.
- **Shared mutable state.** Authorization rows and connection credentials are shared between callback requests and refresh workers. The callback uses an atomic pending-to-consumed update and advances connection token versions.
- **Smallest safe decomposition.** One implementation path. A parallel writer would overlap migrations, server wiring, and security-sensitive state handling.

## Proof plan

1. Focused service/route tests cover start, invalid state, expired state, provider refusal, successful exchange, replay rejection, scope rejection, and encrypted persistence.
2. Run affected Etsy and admin tests, Oxlint on changed files, admin build, and one full backend suite.
3. Deploy after checks. Register the exact callback with Etsy, launch from Admin, grant the existing own-shop app read-only scopes, then use Porizo's live client to list receipts.
4. Confirm the returned page and the connection row. No paid Etsy order is created by this work.

## Risk controls

- Only superadmins may create an authorization request.
- The callback accepts only bounded `state`, `code`, and `error` fields and returns generic pages. It never echoes credentials.
- Successful exchange requires both `shops_r` and `transactions_r` exactly as requested. It does not request write scopes.
- A callback can be used once. Replays and expired authorizations fail before token exchange.
- Existing refresh fencing stays in force. A callback replaces credentials in one database transaction and clears an active refresh lease.
