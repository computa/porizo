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

- Name: `Porizo: AI Song Gift Maker`
- Subtitle: `Personal AI Song & Voice Gifts`
- Primary promise: personalized AI song gifts from memories, messages, and
  specific occasions.
- Keep gift/occasion intent as the main App Store promise. Use AI generator
  terms such as generator, music, text, lyrics, and voice as supporting ASO
  discovery terms rather than the main positioning.

Pre-submission checks:

1. Run `fastlane ios prep_screenshots` from `PorizoApp/`.
2. Confirm `PorizoApp/fastlane/screenshots/en-US/` contains iPhone screenshot
   files for 6.9", 6.5", 6.3", and 6.1" sizes.
3. Upload with `fastlane ios upload_listing_assets`.
4. After the app version is approved, run `fastlane ios verify_public_listing`
   and confirm Apple returns non-empty `screenshotUrls`.
