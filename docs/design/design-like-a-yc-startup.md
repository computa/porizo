# Design Like A YC Startup

## Purpose

This document is a blunt product-design memo for Porizo. The goal is not to make the app merely prettier. The goal is to make it feel more inevitable, more confident, and more consumer-grade.

The standard here is not "clean startup UI" in the generic sense. The standard is a product that feels like a well-led consumer app:

- one obvious job per screen
- one obvious next action at any given moment
- very little visible internal machinery
- strong emotional pacing from intent to outcome

The current app is capable, but it still often feels like a feature-rich system wearing a conversation UI instead of a conversation-native product.

## Core Thesis

The UI still feels amateur not because it is ugly, but because it exposes implementation structure instead of presenting a single confident user intention.

Meta-quality apps do not feel better because of gradients, corner radii, or typography alone. They feel better because every screen has one obvious purpose, one dominant action, and very little visible scaffolding.

Porizo currently leaks too much scaffolding.

## What Feels Amateur Today

### 1. The primary flow is over-stateful and visibly over-engineered

The main create flow is carrying too many concerns in one place.

See:

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift)
- [V2StoryEngine.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift)

`UnifiedCreateFlowView` currently owns or coordinates:

- phase routing
- story conversation
- resume handling
- entitlement checks
- voice selection
- lyric review
- render retries
- playback state
- sharing
- alerts and sheets
- multiple controllers and coordinators

This is technically understandable, but experientially it makes the product feel assembled rather than authored. Users can feel when a screen is a switchboard.

### 2. The UI mirrors backend and workflow states too directly

States like:

- `conversing`
- `confirmed`
- `trackCreated`
- `lyricsApproved`
- `previewReady`
- `fullRenderActive`
- `fullRenderReady`

are fine as engineering states. They are not good user-facing product concepts.

See:

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift#L399)
- [SongProgressIndicator.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift)

When the UI tracks these states too literally, the product starts feeling like a workflow debugger.

The user-facing flow should compress to something more like:

1. tell the story
2. review the result
3. play, edit, or share

### 3. There are too many simultaneous decision surfaces on the same screen

Inside the active create flow, one screen can present:

- header
- sticky progress
- story elements card
- story strength card/tab
- message thread
- occasion picker
- song options card
- style picker
- input bar
- render/retry/player/share states

See:

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift#L373)
- [StoryElementsCardView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift)
- [SongOptionsCard.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongOptionsCard.swift)

This is the biggest "amateur" tell. Good consumer apps remove choices until the exact moment they matter.

### 4. The design system is consistent, but too literal and too safe

The current token system is competent, but the visual language is being applied too uniformly.

See:

- [DesignTokens.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/DesignTokens.swift)

The current pattern is roughly:

- dark background
- warm gold accent
- rounded rectangle
- subtle border
- mild shadow

That creates consistency, but not enough hierarchy. The result is tidy without being decisive.

Strong consumer products do not just repeat a theme. They establish hierarchy:

- one dominant interactive layer
- one secondary informational layer
- almost no decorative competition

### 5. The app is card-heavy where the product should be thread-heavy

The current create experience keeps turning into cards inside a chat shell.

See:

- [StoryElementsCardView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift)
- [SongOptionsCard.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongOptionsCard.swift)
- [CreatingTrackView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/CreatingTrackView.swift)

This makes the app feel like a prototype composed from components instead of a native conversation product.

For this product, the conversation should feel primary and inevitable. Tools should feel subordinate.

### 6. The onboarding and library screens are competent but generic

See:

- [OnboardingView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/OnboardingView.swift)
- [MySongsView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/MySongsView.swift)
- [SongsTabView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SongsTabView.swift)

These screens are not bad. They are just not distinctive enough to feel inevitable to this product.

The onboarding is still a standard startup carousel. The song library is still a conventional custom media list. Neither surface yet feels deeply shaped around the emotional promise of "turn a personal feeling into a song gift."

### 7. The app claims a message-first architecture, but the UI does not fully honor it

See:

- [CLAUDE.md](/Users/ao/Documents/projects/porizo/CLAUDE.md)

The backend philosophy says message-first design. The UI still lets the message compete with:

- diagnostics
- state scaffolding
- configuration
- progress machinery
- editing affordances

That mismatch is one of the main reasons the experience feels more like a capable tool than a deeply confident consumer product.

## What A Strong YC Team Would Likely Do Differently

The main difference is not "they hire better designers." The main difference is that they are usually more ruthless about product focus and experiential coherence.

### 1. They would pick one canonical journey and over-optimize it

They would likely define the app as:

1. tell a story
2. get a song
3. share it

Everything else would be:

- deferred
- hidden
- postponed
- demoted

They would not try to make every branch feel first-class immediately.

### 2. They would design from the emotional arc, not the backend state machine

A sharper team would design around moments like:

1. spark
2. expression
3. anticipation
4. reveal
5. share

They would not allow internal states like `trackCreated`, `lyricsApproved`, or `fullRenderActive` to become visible product moments unless absolutely necessary.

### 3. They would cut half the surfaces

A stronger product team would aggressively remove:

- cards
- inline diagnostics
- intermediate choices
- modal detours
- exposed state scaffolding

They would bias toward fewer surfaces with more confidence.

### 4. They would create much stronger hierarchy

A better product would make it obvious:

- what the screen is for
- what the user should do now
- what can be safely ignored

That means:

- one dominant focal point
- one primary CTA
- one obvious next move
- almost no visual democracy

Right now too many elements have similar visual weight.

### 5. They would make the thread feel like the product

For a product about intimacy, memory, gifting, and personal expression, the conversation should feel inevitable.

Right now the thread often feels like a shell that hosts tools.

A stronger team would reverse that:

- the thread becomes the product
- tools become support
- cards become rare
- side systems become almost invisible

### 6. They would separate modes cleanly

Conversation mode, editing mode, review mode, and player mode should feel clearly distinct.

Right now those modes often blur together inside the same screen. That makes the app feel layered instead of choreographed.

### 7. They would test for confusion, not just bugs

A strong early-stage team with good taste would watch users closely and ask:

- where do they hesitate?
- where do they stop reading?
- where do they lose the next action?
- where does the interface feel busy?

The reaction would usually be to delete UI, not add more explanation.

### 8. They would start with product language, not just theme language

"Velvet and Gold" is a theme. It is not yet a complete product language.

A stronger team would first define the intended feeling:

- intimate
- magical
- trustworthy
- fast

Then they would express that through:

- pacing
- copy
- control density
- motion
- hierarchy
- transitions

### 9. They would build fewer visible abstractions

Heavy coordinator/controller/state orchestration in the UI layer often correlates with a mediated-feeling interface.

Even if the underlying architecture is complex, the visible interaction model should be simple.

### 10. They would obsess over transitions, not just screens

Amateur apps optimize static screens. Better apps optimize the handoff between moments:

- from intent to input
- from input to waiting
- from waiting to reveal
- from reveal to edit or share

That is where the current product still feels mechanical.

## Product Principles For Porizo Going Forward

If Porizo should feel like a strong YC consumer startup, the design should follow these principles.

### Principle 1: One screen, one job

Every major surface should have one dominant purpose.

Bad:

- chat + diagnostics + options + review + player + render recovery on one canvas

Better:

- conversation screen
- review screen
- player/share screen

### Principle 2: One dominant CTA at a time

At any moment, the user should know exactly what to do next.

If a screen has multiple equally plausible next actions, the product will feel uncertain.

### Principle 3: The thread is primary

If the app is positioned as message-first and emotionally expressive, the conversation must be visually and behaviorally dominant.

### Principle 4: Tools are secondary

Story diagnostics, strength indicators, progress scaffolding, and editing utilities should support the flow without competing with it.

### Principle 5: Internal states should be compressed into user moments

Keep the internal state machine. Do not expose it directly.

Compress product language into a few clear moments:

- tell me
- here it is
- change it
- send it

### Principle 6: Reduce visible complexity before adding polish

The fastest route to a better-feeling app is not more decoration. It is less visible complexity.

### Principle 7: Hierarchy beats consistency

Consistency matters, but hierarchy matters more. Not every surface deserves the same emphasis.

## Highest-Leverage Fixes

These are the most important changes to make next.

### 1. Cut visible flow states in half

Keep the internal system. Reduce the user-facing phases to three max:

1. tell the story
2. review the song
3. play, edit, or share

### 2. Remove Story Elements and Story Strength from the default conversation surface

These tools are useful, but they currently make the app feel self-conscious.

Options:

- move them to review mode
- hide them behind a subtle affordance
- make them available on demand only

They should not be part of the default primary composition.

### 3. Stop stacking cards above and below the thread

Choose one primary canvas. For this product, it should be the conversation.

Cards should be rare and consequential, not the default layout language.

### 4. Make one CTA dominant at every moment

The flow should always answer:

- what is happening?
- what do I do now?

without requiring interpretation.

### 5. Separate creator-tool moments from messaging moments

Lyrics editing and review should be their own mode. Do not force them to masquerade as part of the same conversational surface.

### 6. Sharpen the visual hierarchy

The token system needs more contrast between:

- system chrome
- conversation content
- active decision
- secondary metadata

This does not require a new theme. It requires stronger editorial judgment.

### 7. Redesign onboarding around the product promise, not the startup template

The onboarding should feel like a direct invitation into the emotional use case, not a generic benefits carousel.

### 8. Make the songs library feel like a destination, not just a list

The library should reflect the product's gifting and memory value, not just playback inventory.

## What To Keep, Cut, Merge, And Defer

### Keep

- the conversation as the emotional core
- the current backend resilience and workflow depth
- the dark/warm visual direction at a high level
- the message-first product premise

### Cut

- exposed workflow scaffolding in the main surface
- too many equal-weight cards
- early branching that can be deferred
- UI that reflects implementation status rather than user intention

### Merge

- multiple visible flow stages into fewer user moments
- multiple auxiliary cards into one optional support surface
- multiple minor decisions into later contextual branching

### Defer

- nice-to-have diagnostics in the main flow
- rich story-analysis tools in default chat mode
- low-value secondary options that interrupt the emotional arc

## The Uncomfortable Truth

Porizo has built a feature-complete system faster than it has built a taste-complete product.

That is normal for an ambitious product with hard backend requirements.

But the fix is not simply to "make it prettier."

The fix is to:

- reduce visible complexity
- choose one dominant flow
- collapse states into fewer user-facing moments
- make each screen own one job
- treat every extra card, chip, section, and branch as guilty until proven necessary

## Bottom Line

The UI feels amateur not because it is broken or ugly. It feels amateur because it is too honest about the system. It shows the user too many moving parts.

Consumer-grade products feel better when they do the opposite:

- fewer visible concepts
- fewer simultaneous options
- less state exposition
- stronger editorial hierarchy
- more confidence about what matters now

If Porizo wants to feel like a strong YC startup product, it should optimize less for visible capability and more for visible inevitability.
