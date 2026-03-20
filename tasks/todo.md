# Dynamic Style List: Replace Hardcoded MusicStyle Enum with API-Driven Styles

## Goal
Single source of truth for music styles: `style-registry.js`. Delete the iOS `MusicStyle` enum entirely.

## Plan

### Backend
- [x] 1. Add `category` field to each STYLES entry in style-registry.js + new `getStyleList()` function
- [x] 2. Update `/story/info` to return style list array via writer.getStyles()

### iOS
- [x] 3. Add `StyleOption` struct + `StyleStore` observable, delete `MusicStyle` enum (TrackModels.swift)
- [x] 4. Update `StoryInfoResponse.styles` type (StoryModels.swift)
- [x] 5. Update `StorySetup.style` to `String` (CreateFlowContracts.swift)
- [x] 6. Fix `.rawValue` usage (CreateFlowView, CreateFlowAsyncService, StoryFlowCoordinator)
- [x] 7. Update style pickers (CreateFlowSetupViews.swift, CustomCreateView.swift)
- [x] 8. Update display name lookups (PlayerComponents.swift, MySongsView.swift)
- [x] 9. Update V2StoryEngine + StoryDraftStore parameter types
- [x] 10. Wire StyleStore into app + update tests
- [x] 10b. Fix CreatingTrackView.swift preview StoryContext

### Verification
- [x] 11. Backend: getStyleList() returns 24 objects with category
- [x] 12. iOS: Build succeeds with zero MusicStyle references
