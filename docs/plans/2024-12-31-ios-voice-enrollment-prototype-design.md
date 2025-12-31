# iOS Voice Enrollment Prototype Design

## Overview

A focused iOS prototype to validate the voice enrollment UX before building the full Porizo iOS app. Records two voice samples (spoken + sung), uploads to the existing Node.js backend, and displays enrollment result.

**Goal:** Prototype first, test UX, then decide on full app timeline.

**Scope:** Voice enrollment only. No song creation, no playback.

---

## Context

- **Developer experience:** New to iOS
- **Tools available:** Xcode installed, iPhone 12+, no paid Apple Developer account (using free provisioning)
- **Backend:** Existing Node.js/Fastify API with complete enrollment endpoints

---

## Architecture

```
┌─────────────────────────────────────────┐
│           SwiftUI Views                 │
│  (WelcomeView, RecordingView,           │
│   CompletionView)                       │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           APIClient                      │
│  (async/await, talks to Node.js backend)│
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│         AudioRecorder                    │
│  (AVFoundation, captures WAV audio)     │
└─────────────────────────────────────────┘
```

**Why this approach:**
- **SwiftUI** - Apple's modern declarative UI, similar to React. Faster to learn than UIKit.
- **async/await** - Swift's native concurrency, clean API calls without callback hell.
- **AVFoundation** - Apple's audio framework. Using `AVAudioRecorder` for WAV capture.

---

## User Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Welcome   │───▶│  Record x2  │───▶│   Done!     │
│  + Consent  │    │  (prompts)  │    │  (profile)  │
└─────────────┘    └─────────────┘    └─────────────┘
```

### Screen 1: Welcome + Consent
- Brief explanation: "We'll record your voice to personalize songs"
- Consent checkbox (required by backend)
- "Start Recording" button
- Triggers: `POST /voice/enrollment/start`

### Screen 2: Recording (core screen)
- Shows prompt text for spoken/sung samples
- Large record button (red circle, standard iOS pattern)
- Visual feedback: pulsing animation while recording
- Timer showing duration (minimum 5 seconds)
- After recording: playback preview, "Re-record" or "Next" options
- Uploads each chunk: `POST /debug/upload-chunk`

### Screen 3: Processing + Complete
- "Creating your voice profile..." with spinner
- Triggers: `POST /voice/enrollment/complete`
- Success: "Voice profile created! Quality score: 85"
- Error: "Recording too noisy, please try again"

---

## Audio Recording Specification

### AudioRecorder Class

```swift
class AudioRecorder: ObservableObject {
    @Published var isRecording = false
    @Published var duration: TimeInterval = 0
    @Published var audioLevel: Float = 0

    func startRecording() async throws -> URL
    func stopRecording() -> URL
    func playback(url: URL)
}
```

### Audio Format (matching backend)
- Format: WAV (Linear PCM)
- Sample rate: 44,100 Hz
- Channels: Mono (1 channel)
- Bit depth: 16-bit

### iOS Considerations
1. **Microphone permission** - System dialog on first launch
2. **Audio session** - Category: `.playAndRecord`, Mode: `.voiceChat`
3. **Interruption handling** - Detect phone calls, allow re-record
4. **File storage** - Temporary directory, auto-cleaned after upload

---

## API Integration

### APIClient Structure

```swift
class APIClient {
    let baseURL: String  // localhost for dev, production URL later
    var userId: String   // Generated UUID, stored in Keychain

    func startEnrollment() async throws -> EnrollmentSession
    func uploadChunk(sessionId: String, chunkId: String, audioData: Data) async throws
    func completeEnrollment(sessionId: String) async throws -> VoiceProfile
}
```

### Endpoint Mapping

| iOS Method | Backend Endpoint | Purpose |
|------------|------------------|---------|
| `startEnrollment()` | `POST /voice/enrollment/start` | Get session ID |
| `uploadChunk()` | `POST /debug/upload-chunk` | Send WAV as multipart |
| `completeEnrollment()` | `POST /voice/enrollment/complete` | Trigger processing |

### Authentication
- Generate UUID on first app launch
- Store in iOS Keychain
- Send as `x-user-id` header with every request

### Multipart Upload
Manual construction (no external dependencies for prototype).

---

## Project Setup

### Xcode Project Configuration
- Product Name: `PorizoApp`
- Interface: SwiftUI
- Language: Swift
- Bundle ID: `com.porizo.app`

### Required Info.plist Entry
```xml
NSMicrophoneUsageDescription = "Porizo needs microphone access to record your voice for personalized songs"
```

### Local Development
- Backend: `http://<mac-local-ip>:3000`
- Both devices on same WiFi network

---

## File Structure

```
PorizoApp/
├── PorizoApp.xcodeproj
├── PorizoApp/
│   ├── PorizoApp.swift           # App entry point
│   ├── ContentView.swift          # Navigation container
│   ├── Views/
│   │   ├── WelcomeView.swift      # Consent screen
│   │   ├── RecordingView.swift    # Recording UI
│   │   └── CompletionView.swift   # Success/error screen
│   ├── Services/
│   │   ├── AudioRecorder.swift    # Microphone capture
│   │   ├── APIClient.swift        # HTTP calls
│   │   └── PermissionHandler.swift # Mic permission
│   ├── Models/
│   │   └── Models.swift           # Response types
│   └── Assets.xcassets/
```

---

## Implementation Timeline

| Session | Focus | Outcome |
|---------|-------|---------|
| 1 | Project setup + AudioRecorder | Can record audio and see file |
| 2 | APIClient + upload flow | Can upload to backend |
| 3 | Full enrollment UI | Complete 3-screen flow |
| 4 | Polish + edge cases | Error handling, permissions |

### File Creation Order

**Session 1:**
1. `AudioRecorder.swift` - Core recording logic
2. `ContentView.swift` - Simple test button

**Session 2:**
3. `APIClient.swift` - HTTP calls
4. `Models.swift` - Response types

**Session 3:**
5. `RecordingView.swift` - Full recording UI
6. `WelcomeView.swift` - Consent screen
7. `CompletionView.swift` - Success/error

**Session 4:**
8. `PermissionHandler.swift` - Mic permission flow
9. Error handling polish

---

## Definition of Done

- [ ] Can grant microphone permission
- [ ] Can record spoken prompt (5+ seconds)
- [ ] Can playback and re-record
- [ ] Can record sung prompt
- [ ] Uploads both to backend successfully
- [ ] Shows "Voice profile created" with quality score
- [ ] Handles errors gracefully (network, backend failures)

---

## Out of Scope (for prototype)

- Song creation flow
- Playback / sharing
- Push notifications
- Paid Apple Developer account / App Store
- On-device audio processing
- Custom audio visualizations
- Offline support
