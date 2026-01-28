# v1 Screen Wiring Matrix (Create + Story)

This matrix maps v1 screen IDs to the live SwiftUI view and flow state in `CreateFlowView`. It documents which legacy UI each screen replaces and the shared usage between song and poem flows.

## Shared Create + Story Screens (Songs + Poems)

- **07a – Create: Recipient**
  - **Flow state:** `CreateFlowView.CreateFlowState.recipient`
  - **Live view:** `CreateFlowView.recipientStepView` (inline step UI)
  - **Replaces:** `V2GuidedJourneyCoordinator` basics step (recipient input)

- **07b – Create: Occasion**
  - **Flow state:** `CreateFlowView.CreateFlowState.occasion`
  - **Live view:** `CreateFlowView.occasionStepView` (inline step UI)
  - **Replaces:** `V2GuidedJourneyCoordinator` basics step (occasion selector)

- **07c – Create: Style**
  - **Flow state:** `CreateFlowView.CreateFlowState.style`
  - **Live view:** `CreateFlowView.styleStepView` (inline step UI)
  - **Replaces:** `V2GuidedJourneyCoordinator` basics step (style selector)

- **07e – Create: Message**
  - **Flow state:** `CreateFlowView.CreateFlowState.message`
  - **Live view:** `CreateFlowView.messageStepView` (inline step UI)
  - **Replaces:** `V2GuidedJourneyCoordinator` initial prompt step

- **08a – Custom Create**
  - **Flow state:** `CreateFlowView.CreateFlowState.createMode`
  - **Live view:** `CustomCreateView` (tab toggle; user can switch to Custom)
  - **Replaces:** legacy create entry screen inside `CreateFlowView` (previous `songCreate` state)

- **08b – Simple Create**
  - **Flow state:** `CreateFlowView.CreateFlowState.createMode`
  - **Live view:** `CustomCreateView` (tab toggle; default tab = Simple)
  - **Replaces:** legacy create entry screen inside `CreateFlowView` (previous `songCreate` state)

- **09a – Conversation Chat**
  - **Flow state:** `CreateFlowView.CreateFlowState.storyConversation`
  - **Live view:** `AdaptiveConversationView` (Chat tab)
  - **Replaces:** `V2GuidedJourneyCoordinator` journey view

- **09b – Conversation Story**
  - **Flow state:** `CreateFlowView.CreateFlowState.storyConversation`
  - **Live view:** `AdaptiveConversationView` (Story tab)
  - **Replaces:** `V2GuidedJourneyCoordinator` journey view

- **09c – Story Complete**
  - **Flow state:** `CreateFlowView.CreateFlowState.storyComplete`
  - **Live view:** `StoryConfirmationView`
  - **Replaces:** `V2GuidedJourneyCoordinator` completion view

- **14 – Speech-to-Text**
  - **Invocation:** Full-screen modal from message entry, create view, or story chat
  - **Live view:** `SpeechInputView`
  - **Wired from:**
    - `CreateFlowView.messageStepView`
    - `CustomCreateView` (Simple/Custom)
    - `AdaptiveConversationView` (story input bar)

## Song-Only Screen

- **07d – Create: Voice**
  - **Flow state:** `CreateFlowView.CreateFlowState.voice`
  - **Live view:** `VoiceModeSelectionView`
  - **Replaces:** legacy voice selection step in prior create flow
  - **Notes:** Skipped for poems per shared flow requirement.

## Post-Story (Song)

- **Creating Song**
  - **Flow state:** `CreateFlowView.CreateFlowState.creatingTrack`
  - **Live view:** `CreatingTrackView`

- **Lyrics Review**
  - **Flow state:** `CreateFlowView.CreateFlowState.lyricsReview`
  - **Live view:** `LyricsReviewView`

- **Song Playback**
  - **Flow state:** `CreateFlowView.CreateFlowState.trackPlayer`
  - **Live view:** `TrackPlayerFullView`

## Post-Story (Poem)

- **Creating Poem**
  - **Flow state:** `CreateFlowView.CreateFlowState.poemCreating`
  - **Live view:** `PoemCreatingView`

- **Poem Gap Question**
  - **Flow state:** `CreateFlowView.CreateFlowState.poemGap`
  - **Live view:** `PoemGapQuestionView`

- **Poem Preview**
  - **Flow state:** `CreateFlowView.CreateFlowState.poemPreview`
  - **Live view:** `PoemPreviewView`
