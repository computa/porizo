# Attribution Contract

This document defines the backend contract for user acquisition attribution.
The goal is to keep marketing attribution useful without overwriting known
human context, support/admin corrections, or historical user records.

## Contract ID

`attribution-source-precedence-v1`

## Source Precedence

1. Stored non-Apple attribution wins.
   If `users.acquisition_source` is present and is not exactly `Apple Ads`,
   resolved Apple Ads data must not override or enrich the displayed source,
   campaign, or country.

2. Stored Apple Ads attribution can be enriched by Apple Ads rows.
   If `users.acquisition_source` is empty or exactly `Apple Ads`, the resolver
   may use the best resolved Apple Ads row to fill source, campaign, and
   country.

3. Download-link attribution is a fallback after Apple Ads.
   Download-link attribution is only used when no stronger stored or Apple Ads
   source is available.

4. Organic, pending, failed, and unknown states must remain explicit.
   The resolver must not collapse these states into blank fields.

## Backfill Rules

Apple Ads backfill may update `users.acquisition_*` only when all conditions
are true:

1. The Apple Ads row is resolved.
2. The row has a `user_id`.
3. The user exists.
4. The user's stored acquisition fields are empty.
5. The Apple Ads row was captured within 48 hours of `users.created_at`.

The 48-hour window protects existing users from being relabeled as Apple Ads
after they later open, reinstall, or interact with an attributed App Store
path.

## Manual Overrides

Superadmin profile updates may set:

- `acquisition_source`
- `acquisition_campaign`
- `acquisition_country`

When any of these fields changes, the backend must write an `audit_logs` row:

- `action`: `admin_update_user_attribution`
- `resource_type`: `user`
- `resource_id`: target user ID
- `metadata_json.contract`: `attribution-source-precedence-v1`
- `metadata_json.previous`: previous acquisition fields
- `metadata_json.next`: resulting acquisition fields
- `metadata_json.changedFields`: requested attribution fields

This audit entry is separate from the generic `admin_update_user_profile` log
so attribution overrides can be searched and reviewed directly.

## Test Coverage

The contract is enforced by:

- `test/admin-attribution.test.js`
  - stored non-Apple source overrides resolved Apple Ads display attribution
  - manual attribution override writes an old/new audit contract entry
- `test/apple-ads-attribution.test.js`
  - late Apple Ads attribution does not backfill an existing user

