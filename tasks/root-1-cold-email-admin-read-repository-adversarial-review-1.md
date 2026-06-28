# Root 1 Cold Email Admin Read Repository Adversarial Review 1

Date: 2026-06-27

## Scope

Reviewed the extraction of two route-level cold-email admin read queries from
`src/routes/admin.js` into `src/database/cold-email-repository.js` via
`src/services/cold-email-service.js`.

Touched paths:

- `src/database/cold-email-repository.js`
- `src/services/cold-email-service.js`
- `src/routes/admin.js`
- `test/cold-email-repository.test.js`
- `test/admin-marketing-routes.test.js`

## Attack Vectors Checked

1. `/admin/dashboard/marketing/email-templates` stops surfacing custom DB-referenced templates.
2. Static email template filesystem reads leak into the repository layer.
3. Custom template path handling changes from `marketing/email/*` trimming.
4. Duplicate template references create duplicate custom template cards.
5. Null `template_html_path` rows crash route handling.
6. `/admin/dashboard/marketing/cold-email` stops listing inactive campaigns.
7. Inactive campaigns accidentally receive live pending recipient counts.
8. Active campaign pending counts drift from `listActiveCampaigns`.
9. Campaign ordering drifts from `created_at DESC`.
10. Repository normalizes all-campaign rows and changes existing response shape.
11. Read extraction touches trigger/send behavior.
12. Read extraction touches PATCH optimistic concurrency behavior.
13. Read extraction changes Resend scheduling, claim, or mark-sent behavior.
14. Repository uses provider-specific SQL that breaks SQLite/Postgres parity.
15. Route imports create a circular dependency back into the repository.
16. Tests require filesystem template files to exist for custom campaign rows.
17. Docs overstate that all cold-email route SQL is gone.

## Findings

No P0/P1 findings remain.

### Fixed During Review

- P1 VERIFIED: The first test pass had no repository method boundary for
  all-campaign listing and template references. Scenario: route tests could
  keep passing while the raw SQL stayed in the route. Fix: added
  `listAllCampaigns()` and `listTemplateReferences()` to
  `cold-email-repository.js`, exposed them through `cold-email-service.js`,
  and updated the route to call the service.
- P2 VERIFIED: The repository ordering characterization fixture accepted
  `created_at` overrides but did not insert them, making the test assertion
  meaningless. Fix: updated the fixture to write `created_at` and `updated_at`.

## Validation

- `node --check src/database/cold-email-repository.js`
- `node --check src/services/cold-email-service.js`
- `node --check src/routes/admin.js`
- `node --check test/cold-email-repository.test.js`
- `node --check test/admin-marketing-routes.test.js`
- `node --test test/cold-email-repository.test.js test/admin-marketing-routes.test.js`

Focused validation result: 16 pass / 0 fail.
