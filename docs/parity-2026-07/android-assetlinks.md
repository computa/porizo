# Android App Links — assetlinks.json (deploy artifact)

**What this closes:** the _only_ remaining piece of Android App Links verification.
The app's `autoVerify` intent-filters and the `DeepLinkParser` are done and
verified on-device (see `native-parity-audit-2026-07-05.md` → item 5). Android
already attempts Digital Asset Links verification at install — `pm get-app-links
com.porizo.app` reports all three domains in state `1024` (`STATE_NO_RESPONSE`),
meaning the client reached out for `/.well-known/assetlinks.json` and got no
valid response. Hosting the file below flips those to `verified`, so
`https://porizo.co/s/…` opens the app **without** a disambiguation chooser.

This is a **server/DNS task**, not app code.

## Deploy

Host the JSON below at **all three** domains (exact path, `Content-Type:
application/json`, HTTP 200, no redirect):

- `https://porizo.co/.well-known/assetlinks.json`
- `https://www.porizo.co/.well-known/assetlinks.json`
- `https://porizo.app/.well-known/assetlinks.json`

The `package_name` is `com.porizo.app`. The `sha256_cert_fingerprints` array
must list **every** signing cert that ships an APK to users — typically the
**Play App Signing** cert (from Play Console → Setup → App integrity → App
signing key certificate → SHA-256) plus your upload cert. Add the debug cert
only if you want app-links to verify on debug installs.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.porizo.app",
      "sha256_cert_fingerprints": [
        "6E:CD:EA:3E:6C:D3:40:34:E8:F2:92:B9:6D:64:8B:F7:50:31:5E:7D:C9:50:41:A1:58:5E:FB:F5:5F:C2:E7:87",
        "REPLACE_WITH_PLAY_APP_SIGNING_SHA256",
        "REPLACE_WITH_UPLOAD_CERT_SHA256"
      ]
    }
  }
]
```

### Fingerprints

| Cert                             | SHA-256                                                                                           | Source                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Debug** (emulator, this build) | `6E:CD:EA:3E:6C:D3:40:34:E8:F2:92:B9:6D:64:8B:F7:50:31:5E:7D:C9:50:41:A1:58:5E:FB:F5:5F:C2:E7:87` | captured live via `pm get-app-links com.porizo.app` on the emulator, 2026-07-04                                 |
| **Play App Signing**             | _pending_                                                                                         | Play Console → App integrity → App signing key certificate (R-2 — needs Play Console access + release keystore) |
| **Upload**                       | _pending_                                                                                         | Play Console → App integrity → Upload key certificate, or `keytool -list -v -keystore <upload>.jks`             |

> The debug fingerprint is real and usable **today** for verifying app-links on
> debug installs. The two release fingerprints are the R-2 external item —
> they can't be produced without the release keystore / Play Console.

## Verify after deploy

```bash
# 1. file is reachable and correct content-type on each domain
curl -sI https://porizo.co/.well-known/assetlinks.json | grep -i "200\|content-type"

# 2. Google's DAL API agrees (replace domain per host)
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://porizo.co&relation=delegate_permission/common.handle_all_urls"

# 3. on device, force re-verification and confirm state flips to 'verified'
adb shell pm verify-app-links --re-verify com.porizo.app
adb shell pm get-app-links com.porizo.app   # domains should read 'verified', not '1024'
```
