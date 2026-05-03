# Fastlane Screenshot Upload

Source of truth lives at `marketing/appstore/screenshots/current/{6.9,6.5,6.3,6.1}/porizo-{hero,pick,tell,hear,share}.png`. This fastlane setup copies those into its own layout and uploads to App Store Connect.

## One-time setup

1. **Create an App Store Connect API key**
   - Go to https://appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
   - Click `+` next to "Active"
   - Name: `Fastlane Screenshots`, Access: `App Manager` (or higher)
   - Download the `.p8` file (you can only download once)
   - Note the **Key ID** and **Issuer ID**

2. **Place the key**
   ```bash
   mkdir -p ~/.appstoreconnect/private_keys
   mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
   ```

3. **Export env vars** (add to shell rc if you'll run this more than once)
   ```bash
   export APP_STORE_CONNECT_KEY_ID="YOUR_KEY_ID"       # e.g. ABCD1234EF
   export APP_STORE_CONNECT_ISSUER_ID="YOUR_ISSUER_ID" # UUID format
   ```

## Upload

From `PorizoApp/`:

```bash
fastlane upload_screenshots
```

This will:
- Copy the 20 files from `marketing/appstore/screenshots/current/` into `fastlane/screenshots/en-US/`
- Authenticate with App Store Connect via your API key
- Replace all existing screenshots on the version currently in "Prepare for Submission"
- Skip binary/metadata, skip submit for review

## Known caveat

The `6.1/` files are 1125×2436, which is iPhone 5.8" Display dimensions (legacy). App Store Connect may place these in the 5.8" slot or reject them. If you need true 6.1" (1179×2556 or 1290×2796), regenerate those files first.

## Notes

- `overwrite_screenshots: true` — deletes existing screenshots in the version before uploading
- `submit_for_review: false` — never auto-submits
- `skip_metadata: true` — leaves all text metadata (description, keywords) untouched
