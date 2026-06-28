# Root 1 Gift Delivery Incident Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/gift-delivery-incident-repository.js`.
- Delegated `gift_delivery_incidents` persistence from `src/services/gift-delivery-ops.js`.
- Added `test/gift-delivery-incident-repository.test.js`.

## Boundary

This slice does not move receipt normalization, receipt precedence, contact
redaction, webhook routing, admin authorization, scheduler policy, or dispatch
business logic. It only moves incident row reads/writes behind a repository.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Reopen semantics:** upserting an existing incident with `reopen: true`
  still reopens it and clears acknowledgement/resolution fields.
- **Acknowledged preservation:** upserting with `reopen: false` keeps an
  acknowledged incident acknowledged.
- **COALESCE relation preservation:** existing gift/outbox/resource references
  are preserved when later upserts omit them.
- **Bulk resolve filtering:** resolving by gift with an incident-type allowlist
  only resolves matching types; resolving without a list resolves all open
  incidents for that gift.
- **Consumer compatibility:** webhook incident recording and admin acknowledgement
  paths still pass through the public service functions.
- **Agent resource management:** no subagent was launched for this slice because
  the prior close-agent call stalled; review was performed locally with bounded
  commands.

## Validation

- `node --check src/database/gift-delivery-incident-repository.js`
- `node --check src/services/gift-delivery-ops.js`
- `node --check test/gift-delivery-incident-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-delivery-incident-repository.test.js test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-webhooks.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/admin-gift-ops-routes.test.js`
- `npm run lint`
- `git diff --check -- src/database/gift-delivery-incident-repository.js src/services/gift-delivery-ops.js test/gift-delivery-incident-repository.test.js`
