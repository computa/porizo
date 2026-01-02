# Data Model

## Entities

### User
A person using Porizō to create and share personalized expressions. Users can create songs and poems for loved ones, enroll their voice for voice-cloned songs, and manage their library of creations.

### VoiceProfile
A user's enrolled voice used for voice-cloned songs. Created through a guided enrollment process where users record spoken and sung phrases. Contains voice embedding data and quality metrics. Users can re-enroll to improve quality.

### EnrollmentSession
The process of recording voice samples for voice profile creation. Tracks progress through multiple recording prompts (spoken phrases and sung lines), stores audio chunks temporarily, and captures quality metrics during processing.

### Song
A personalized song created for a recipient. Contains the recipient's name, the memory or message being expressed, occasion context, music style preference, and generated lyrics. Songs go through a multi-stage creation process from draft to fully rendered.

### SongVersion
A specific render of a song with full parameter reproducibility. Includes preview renders (short chorus, ~15-25 seconds) and full renders (complete song, 45-90 seconds). Each version is immutable and can be regenerated deterministically.

### Poem
A personalized poem created for a recipient. Contains the recipient's name, the message being expressed, occasion context, tone preference, and the generated verses. Simpler creation flow than songs (no audio rendering).

### Occasion
A category that provides context for creations. Standard occasions include Birthday, Anniversary, Thank You, I Love You, Wedding, Graduation, Celebration, Apology, and Encouragement. Users can also create custom occasions.

### ShareLink
A private link for sharing a creation with its recipient. Provides secure, direct delivery for intimate sharing. Tracks views and enables recipients to optionally share publicly to celebrate the moment.

### Entitlement
A user's subscription tier and usage allowances. Tracks credits balance, daily/monthly limits, and tier benefits. Supports free tier with limited creations and premium tiers with expanded capabilities.

### BillingHold
A temporary credit reservation created before expensive operations (like full song renders). Has a time-to-live and is either captured on success or released on failure/expiration.

### Job
A background processing task for async operations like voice enrollment, song rendering, or content moderation. Tracks workflow step, status, retry attempts, and error codes.

## Relationships

- User **has one** VoiceProfile (optional — not required to create songs)
- User **has many** Songs
- User **has many** Poems
- User **has one** Entitlement
- User **has many** BillingHolds

- VoiceProfile **created through** EnrollmentSession
- VoiceProfile **belongs to** User

- Song **has many** SongVersions
- Song **belongs to** User
- Song **belongs to** Occasion
- Song **has many** ShareLinks
- Song **has many** Jobs (for rendering workflow)

- SongVersion **belongs to** Song

- Poem **belongs to** User
- Poem **belongs to** Occasion
- Poem **has many** ShareLinks

- ShareLink **belongs to** Song or Poem (polymorphic)

- Job **belongs to** Song or VoiceProfile (polymorphic)

- BillingHold **belongs to** User
- BillingHold **references** SongVersion (for full renders)

## Voice Modes

Songs can be created in different voice modes:
- **AI Voice** — Standard AI-generated vocals (no voice profile required)
- **Your Voice** — Voice-cloned to sound like the user singing (requires VoiceProfile)
- **Dual Voice** — Combination of AI and user's voice in harmony

## Song Statuses

Songs progress through these statuses:
- **draft** — Story captured, not yet generated
- **lyrics_approved** — Lyrics confirmed by user
- **rendering** — Preview or full render in progress
- **preview_ready** — Short preview available for review
- **full_ready** — Complete song rendered and available
- **failed** — Render failed (can retry)

## Poem Statuses

Poems have simpler statuses:
- **draft** — Being created
- **complete** — Poem generated and ready to share
