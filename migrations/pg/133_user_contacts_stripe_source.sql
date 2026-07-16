-- Web-funnel identity convergence (§5.2) attaches a user_contacts row with
-- source = 'stripe_checkout' when a buyer's email is new. The 091 CHECK, last
-- rebuilt in migration 130 to add 'magic_link', rejects it with 23514
-- check_violation. SQLite has no CHECK on this column, so the test suite cannot
-- catch this — the migration file content is asserted directly in the U4 tests.
ALTER TABLE user_contacts
  DROP CONSTRAINT IF EXISTS user_contacts_source_check;
ALTER TABLE user_contacts
  ADD CONSTRAINT user_contacts_source_check
  CHECK (source IN (
    'user_entered', 'apple_claim', 'phone_otp', 'admin', 'provider_sync',
    'magic_link', 'stripe_checkout'
  ));
