# App Store Metadata Source

The source of truth for App Store listing text is:

- `marketing/appstore/metadata/app-info/en-US.json`
- `marketing/appstore/metadata/version/1.4/en-US.json`
- `marketing/appstore/metadata/version/1.5.10/en-US.json`
- `marketing/appstore/metadata/version/1.5.11/en-US.json`
- `PorizoApp/fastlane/metadata/en-US/*.txt`

Keep these files aligned before every App Store submission. Fastlane reads the
`PorizoApp/fastlane/metadata` tree when uploading metadata.

Current positioning:

- Name: `Porizo: Song Gift Maker`
- Subtitle: `Personalized songs in minutes`
- Primary promise: personalized song gifts from memories and messages
- Avoid making "your voice" the main App Store promise until live enrollment and
  Suno persona creation are consistently verified in production.

Pre-submission checks:

1. Run `fastlane ios prep_screenshots` from `PorizoApp/`.
2. Confirm `PorizoApp/fastlane/screenshots/en-US/` contains iPhone screenshot
   files for 6.9", 6.5", 6.3", and 6.1" sizes.
3. Upload with `fastlane ios upload_listing_assets`.
4. After the app version is approved, run `fastlane ios verify_public_listing`
   and confirm Apple returns non-empty `screenshotUrls`.
