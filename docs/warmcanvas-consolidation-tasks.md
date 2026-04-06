# WarmCanvas Consolidation Tasks

## Phase 0
- [x] Restore the flow-focused test safety net enough to trust WarmCanvas migration work.
- [x] Add a temporary `AppConfig.useWarmCanvasForPoems` feature flag.
- [x] Verify the iOS build path used for this migration.

## Phase 1
- [x] Make `WarmCanvasFlowView` respect `selectedType` instead of forcing `.song`.
- [x] Add poem entitlement branching and poem upgrade re-check handling.
- [x] Fix bootstrap to honor `preselectedType`, `variationSourcePoem`, and restored poem sessions.
- [x] Fix resume persistence to save the real medium and poem state.
- [x] Remove song-only copy leaks from WarmCanvas.

## Phase 2
- [x] Add poem wait / gap / reveal handling inside `WarmCanvasFlowView`.
- [x] Map poem gap questions back into the Tell moment instead of a separate runtime flow.
- [x] Fire `onPoemComplete` from WarmCanvas poem completion.

## Phase 3
- [x] Add a poem share path inside WarmCanvas.
- [x] Keep song and poem share logic separate at the controller/API layer.

## Phase 4
- [x] Route poem launch sites in `MainTabView` and `GiftSendFlowView` into WarmCanvas behind the feature flag.

## Phase 5
- [x] Remove eager share-link generation from WarmCanvas reveal.

## Phase 6
- [x] Correct share readiness logic to reflect actual render/version states.

## Phase 7
- [x] Harden song creation against post-track lyric update failures.

## Phase 8
- [ ] Retire old runtime flow owners after WarmCanvas cutover is stable.

## Notes
- Legacy flow owners remain in the repo as a deliberate fallback while `AppConfig.useWarmCanvasForPoems` is still in place.
