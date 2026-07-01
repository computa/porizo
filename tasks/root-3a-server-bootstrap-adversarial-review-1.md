# Root 3a Server Bootstrap Adversarial Review 1

Date: 2026-06-26

## Scope

Mechanical extraction of Fastify HTTP bootstrap behavior, validation schemas,
and share URL construction from `src/server.js` into leaf modules:

- `src/plugins/http-bootstrap.js`
- `src/schemas/http-validation.js`
- `src/utils/share-urls.js`

This slice intentionally did not extract route ownership, gift orchestration,
billing, repositories, or provider selection. Those remain separate architecture
roots because they carry higher behavioral risk.

## Review Inputs

- Local adversarial review of the server bootstrap diff.
- Oracle review using `gpt-5.2-instant` against `src/server.js`,
  `src/plugins/http-bootstrap.js`, and the focused route/security smoke tests.
- Follow-up local review after fixing or triaging Oracle P2 findings.

## Verdict

No P0/P1 blockers found after follow-up.

The extraction is behavior-preserving for the bootstrap/share/schema surface and
gives the next roots cleaner boundaries: app creation, body parsing, CORS,
security plugins, static assets, Apple App Site Association handling, route
validation schema constants, and share URL construction now live outside the
route/dependency wiring in `server.js`.

## Findings And Resolution

### Fixed

- Static file roots originally used `process.cwd()`, which made the extracted
  plugin fragile under alternate launch directories. Fixed by deriving static
  roots from the project root relative to `src/plugins/http-bootstrap.js`.
- Multipart/body-limit behavior was not characterized after moving the parser
  registration. Added bootstrap tests proving JSON over 1 MB is rejected while a
  2 MB multipart upload succeeds.
- Bootstrap behavior did not have direct unit coverage. Added
  `test/http-bootstrap.test.js` for static serving, AASA, CORS/Helmet headers,
  production CORS guard, form parsing, audio buffer parsing, JSON limits, and
  multipart limits.
- Share URL construction was still embedded in `buildServer()`. Extracted it to
  `src/utils/share-urls.js` and added unit coverage for API-host mapping,
  version/cache tokens, requested URL preservation, and artwork/poem image URLs.
- Validation schemas were inline in `buildServer()`. Moved them to
  `src/schemas/http-validation.js` while preserving the `schemas` dependency
  passed to route modules.

### Triaged

- Oracle flagged CORS config as potentially ignoring central `appConfig`. Local
  review found the pre-existing behavior was env-only and there is no current
  `appConfig.CORS_ORIGIN` surface in this repo. This is valid config debt, but
  changing it in Root 3a would have violated the mechanical extraction boundary.

## Validation

- `npm run lint` passed.
- Focused bootstrap/security/share smoke passed:
  `node --test --test-concurrency=1 test/agent-readiness.test.js test/hosting-hardening.test.js test/share-embed.test.js test/story-billing.test.js test/auth-api.test.js test/http-bootstrap.test.js`
  with 117 passing tests before the share/schema sub-slice.
- Share URL helper and route smoke passed:
  `node --test --test-concurrency=1 test/utils/share-urls.test.js` with 4
  passing tests, and
  `node --test --test-concurrency=1 test/http-bootstrap.test.js test/share-embed.test.js test/share-flow.test.js test/auth-api.test.js`
  with 120 passing tests.
- Full suite passed:
  `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true npm test`
  with 2,467 tests, 2,444 passing, 0 failing, 23 skipped.
- `git diff --check` passed.

## Remaining Architecture Debt

- `server.js` is smaller but still owns too much route and dependency wiring.
  Startup job/timer wiring remains in `start()`, and the risky gift/create
  subsystem extraction remains Root 3b, not part of this mechanical slice.
- Test execution is not fully hermetic. Several tests still make live
  LLM/provider calls by default and should be moved behind fixture/fake provider
  boundaries during the provider/repository roots.
- Runtime config access remains mixed between `process.env` and central config.
  CORS should be folded into the config root rather than patched inside the
  bootstrap extraction.
- Fastify emits the existing `request.routerPath` deprecation warning under the
  current suite. Track this before a Fastify 5 upgrade.
