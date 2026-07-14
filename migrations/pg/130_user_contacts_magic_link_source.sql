-- Magic-link sign-in writes user_contacts rows with source = 'magic_link'
-- (new-user signup contact insert + verifyContact source update). The 091
-- CHECK predates magic login and rejects it with 23514 check_violation,
-- breaking every new-user email signup in production. SQLite has no CHECK
-- on this column, so the test suite could not catch it.
ALTER TABLE user_contacts
  DROP CONSTRAINT IF EXISTS user_contacts_source_check;
ALTER TABLE user_contacts
  ADD CONSTRAINT user_contacts_source_check
  CHECK (source IN (
    'user_entered', 'apple_claim', 'phone_otp', 'admin', 'provider_sync',
    'magic_link'
  ));
