# Porizo App Clip provisioning

The code target is `PorizoAppClip`; its bundle identifier is
`porizo.ios.app.PorizoApp.Clip` and its invocation domain is `porizo.co`.

Before archiving 1.5.27:

1. In Apple Developer, open Certificates, Identifiers & Profiles → Identifiers → + → App IDs → **App Clip**. Select `porizo.ios.app.PorizoApp` as the parent and use product name `Clip`. Do not register a generic explicit App ID; it will not receive the on-demand-install or parent-app entitlements.
2. Enable App Clips and Associated Domains for the Clip identifier and regenerate its development/distribution profiles.
3. Deploy the AASA change and verify that `https://porizo.co/.well-known/apple-app-site-association` contains both `5VCH6937XM.porizo.ios.app.PorizoApp` and `5VCH6937XM.porizo.ios.app.PorizoApp.Clip`.
4. Create the default App Clip experience in App Store Connect for `https://porizo.co/play/`.
5. Open a real `/play/<share-id>` invocation on a physical iPhone without Porizo installed. Verify the recipient-specific title, sender and artwork appear, but no audio can play in the Clip. Tap **Get Porizo and play**, then verify `receiver_link_opened` and `receiver_save_cta_clicked`, full-app installation, handoff restoration, sign-in/PIN claim, library insertion, and post-claim playback.
6. Archive with distribution signing and confirm the Clip stays within Apple's current uncompressed size limit before submitting 1.5.27.

The simulator parent scheme builds with the embedded Clip. A device-target build remains expected to fail until steps 1–2 are complete.

The shared `PorizoAppClip` scheme contains `_XCAppClipURL=https://porizo.co/play/REPLACE_WITH_SHARE_ID`. Replace the final path component with a valid share ID before running the invocation test.

The Clip is a personalized install bridge, not an alternate player. Normal gifts remain app-only: the Clip must never request or receive `web_stream_url`. Playback begins only in the full app after the existing receiver handoff has survived installation/sign-in and the share has been claimed to the recipient device.

The public ASC API was tested and cannot create the parent-linked App Clip identifier type. A generic explicit identifier and its temporary profiles were deleted after profile inspection proved they lacked `com.apple.developer.on-demand-install-capable` and the parent-app entitlement.
