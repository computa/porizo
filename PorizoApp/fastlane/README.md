fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios prep_screenshots

```sh
[bundle exec] fastlane ios prep_screenshots
```

Copy marketing/appstore/screenshots/current/ into fastlane/screenshots/en-US/

### ios upload_screenshots

```sh
[bundle exec] fastlane ios upload_screenshots
```

Upload screenshots to App Store Connect (replaces existing)

### ios upload_metadata

```sh
[bundle exec] fastlane ios upload_metadata
```

Upload App Store metadata only

### ios upload_listing_assets

```sh
[bundle exec] fastlane ios upload_listing_assets
```

Upload App Store metadata and screenshots together

### ios verify_public_listing

```sh
[bundle exec] fastlane ios verify_public_listing
```

Inspect the live public Apple listing for iPhone screenshot exposure

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
