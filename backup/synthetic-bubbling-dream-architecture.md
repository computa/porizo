# Architecture and Flows (MVP)

## High-Level Architecture

```mermaid
flowchart LR
  subgraph Client
    App[Mobile App]
    Web[Share Link Web Page]
  end

  subgraph Backend
    API[API Gateway]
    Auth[Auth + Consent]
    Orchestrator[Job Orchestrator]
    DB[(Postgres)]
    Store[(Object Storage)]
    CDN[CDN or Signed URLs]
  end

  subgraph Providers
    Lyrics[LLM Lyrics]
    Music[Music Generation API]
    Voice[Voice Conversion API]
    Verify[Email/SMS Verify]
  end

  App --> API
  Web --> API
  API --> Auth
  API --> DB
  API --> Store
  Store --> CDN
  API --> Orchestrator
  Orchestrator --> Lyrics
  Orchestrator --> Music
  Orchestrator --> Voice
  API --> Verify
```

## Flow 1: Voice Capture and Consent

```mermaid
sequenceDiagram
  participant U as User
  participant App as Mobile App
  participant API as API
  participant QC as QC Service
  participant Voice as Voice Provider
  participant Store as Storage

  U->>App: Record spoken + sung/hummed samples
  App->>API: Upload samples + consent
  API->>Store: Save raw audio
  API->>QC: Run quality checks
  QC-->>API: Pass/Fail + metrics
  alt Pass
    API->>Voice: Create voice model
    Voice-->>API: Model ID
    API-->>App: Enrollment complete
  else Fail
    API-->>App: Re-record request
  end
```

## Flow 2: Feelings to Song Generation

```mermaid
sequenceDiagram
  participant U as User
  participant App as Mobile App
  participant API as API
  participant LLM as Lyrics Provider
  participant Orch as Orchestrator
  participant Music as Music API
  participant Voice as Voice API
  participant Store as Storage

  U->>App: Enter mood, recipient, message
  App->>API: Submit inputs
  API->>LLM: Generate lyric drafts
  LLM-->>API: Drafts
  API-->>App: Show drafts
  U->>App: Edit and approve lyrics
  App->>API: Final lyrics
  API->>Orch: Start render job
  Orch->>Music: Generate instrumental + guide vocal
  Music-->>Orch: Audio assets
  Orch->>Voice: Convert guide vocal to user voice
  Voice-->>Orch: Converted vocal
  Orch->>Store: Mix/master + save final
  Store-->>API: Final asset URL
  API-->>App: Song ready
```

## Flow 3: Share-Once and Recipient Playback

```mermaid
sequenceDiagram
  participant C as Creator
  participant App as Mobile App
  participant API as API
  participant Verify as Email/SMS
  participant Web as Share Web Page

  C->>App: Create share link
  App->>API: Request share token
  API->>Verify: Send recipient verification
  Verify-->>API: Verified recipient
  API-->>App: One-time share link

  Note over Web,API: Recipient opens link and verifies
  Web->>API: Verify recipient and request stream
  API-->>Web: Stream-only URL (no download)
  Web-->>App: Optional app install link
  App->>API: Save to app library (if installed)
```

## Policy Notes (MVP)
- Recipient can stream via the share link but can only save inside the mobile app.
- Share token is one-time and bound to recipient identity; forwarding fails.
- Creator can revoke access; recipient has no share controls.
