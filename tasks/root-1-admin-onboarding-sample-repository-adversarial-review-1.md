# Root 1 Admin Onboarding Sample Repository - Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/admin-onboarding-sample-repository.js`
- `src/services/admin-service.js` onboarding sample methods
- `test/admin-onboarding-sample-repository.test.js`

Root objective:
- Move `onboarding_samples` admin persistence out of `AdminService` and into a repository while preserving route-facing validation and audit behavior.
- Make activation robust at the persistence boundary.

Attack vectors reviewed:
1. Listing order changes from `created_at ASC`.
2. New sample creation silently changes `is_active` default.
3. New sample creation drops `created_at`, `updated_at`, or `updated_by`.
4. Service no longer trims created labels and audio URLs before persistence.
5. Service audit metadata silently changes from the request payload shape.
6. Update allows a caller-controlled column name into SQL.
7. Update with no valid fields mutates metadata anyway.
8. Update of missing sample creates an audit row.
9. Delete of missing sample returns success.
10. Delete removes a row but audits the wrong prior metadata.
11. Activation leaves two active samples.
12. Activation leaves zero active samples if the target ID is missing.
13. Activation deactivates existing sample before a later target update failure.
14. Activation timestamp/user metadata differs inconsistently across rows.
15. Public app-config active-sample projection changes unexpectedly.
16. Repository direct callers can bypass service preconditions.
17. PostgreSQL/SQLite placeholder compatibility regresses in transaction code.
18. Route response envelope changes.

## Findings

### P1-VERIFIED-1: Direct repository activation of a missing sample could deactivate all samples

Scenario:
- A future caller uses `adminOnboardingSampleRepository.activateSample({ id: "missing", ... })` directly without the current service precheck.
- The first update deactivates all rows.
- The second update affects zero rows.
- Result: there is no active onboarding sample, breaking the public `/app/config` onboarding audio projection.

Smallest fix:
- Check target existence inside the same transaction before the deactivate-all update.
- Throw `Onboarding sample not found` and rely on rollback if absent.

Status:
- Fixed in this slice.
- Added regression coverage: `activateSample rejects a missing sample without changing active state`.

### P2-INFERRED-1: Repository update still trusts service-level validation for field values

Scenario:
- The repository rejects unsafe columns, but it does not validate label length or URL prefix.
- Current service owns that validation, and routes only call through the service.

Smallest fix:
- Leave as-is for now to preserve the current service ownership boundary.
- Add repository value validation only if another non-service caller is introduced.

Status:
- Deferred. No current production caller bypasses the service.

### P3-INFERRED-1: App-config active sample read still lives in `app-config-repository`

Scenario:
- Admin CRUD persistence is now in `admin-onboarding-sample-repository.js`.
- Public active-sample projection remains in `app-config-repository.js`.

Smallest fix:
- Keep this split because public app-config needs only client-safe fields and was already characterized there.

Status:
- Deferred by design.

## Result

After the fix wave, this root slice has zero open P0 and zero open P1 findings.
