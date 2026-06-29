# Root 11 Simulator Flow Recording - 2026-06-29

## Scope

Recorded deterministic simulator checkpoints for the cross-surface Root 11 create, gift, and share paths.

## Launch Fixtures

| Flow | Launch args | Recorded flow |
| --- | --- | --- |
| Create wait state | `--bypass-auth --fixture-creating` | `.argent/flows/root11-create-flow-fixture.yaml` |
| Gift entry state | `--bypass-auth --fixture-gift-flow` | `.argent/flows/root11-gift-flow-fixture.yaml` |
| Share postcard state | `--bypass-auth --fixture-share-postcard` | `.argent/flows/root11-share-postcard-fixture.yaml` |

## Validation

- XcodeBuildMCP `build_run_sim` succeeded for all three fixture launches on iPhone 17 (`AF9E4173-6532-4F57-A39E-4BD4861C8E34`).
- Argent `describe` and `screenshot` steps were recorded for each flow.
- Share checkpoint verified the seeded share postcard, share targets, privacy/PIN disclosure, and the VoiceOver artwork label.
- Gift checkpoint verified the typed `fullScreenCover(item:)` gift launch, empty scheduled state, and song/poem gift entry points.
- Create checkpoint verified direct create-flow presentation into the creating/wait state for Sarah.

## Notes

- The first gift fixture pass exposed a backend dependency leak in the offline simulator path: `GiftSendFlowView` called the active reservation endpoint and surfaced a route-not-found alert when no compatible local backend was serving. The fixture now suppresses reservation/schedule fetches only under `#if DEBUG` and `--fixture-gift-flow`.
- One build pass still reported the existing PhoneNumberKit deprecation warning in `PhoneNumberNormalizer.swift`; no Root 11 simulator flow errors remained.
