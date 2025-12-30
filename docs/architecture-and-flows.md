# Porizo Architecture & Flows

## Executive Summary

Porizo is a personalized song generation platform where users record their voice and create custom songs (MVP: 45-60 seconds, Full: 45-90 seconds) that sound like them singing. This document captures both MVP and full-product architecture and flows.

## Scope Legend

- **[MVP]** Minimum viable product behavior and targets.
- **[FULL]** Post-MVP/full-product behavior and targets.

## Device Binding & Storage (MVP)

### Device Binding (First-Claim Wins)

- **iOS:** IDFV + App Attest token; bind share token to device key.
- **Android:** App Set ID + Play Integrity; bind share token to device key.
- **Server:** store `bound_device_id`, `bound_platform`, `bound_app_version` on first claim; reject subsequent claims.

### App-Only Storage Enforcement

- **Streaming:** HLS with short-lived signed URLs (stream-only in web).
- **App Save:** HLS with per-segment AES-128 encryption; decryption keys served only to the bound device.
- **Note:** screen recording is possible; apply watermarking and short-lived URLs.

---

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENT LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                       │
│  │    iOS App       │  │   Android App    │  │   Web Player     │                       │
│  │  (Recording,     │  │   (Recording,    │  │   (Recipient     │                       │
│  │   Playback,      │  │    Playback,     │  │    Streaming)    │                       │
│  │   Creation)      │  │    Creation)     │  │                  │                       │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘                       │
│           │                     │                     │                                  │
│           └─────────────────────┼─────────────────────┘                                  │
│                                 │                                                        │
│                                 ▼                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTPS / REST API
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  API GATEWAY LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│  │                            API Gateway (Node.js/Fastify)                          │   │
│  │  • Authentication (Firebase/Auth0 token validation)                               │   │
│  │  • Rate limiting (per-user, per-endpoint)                                         │   │
│  │  • Request validation (OpenAPI schemas)                                           │   │
│  │  • Signed URL generation for S3 uploads                                           │   │
│  │  • Response caching (CDN-friendly headers)                                        │   │
│  └──────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              ORCHESTRATION LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           Temporal.io Workflow Engine                             │   │
│  │  • Enrollment Workflow (voice capture → QC → embedding)                           │   │
│  │  • Preview Workflow (lyrics → music → voice conversion → mix)                     │   │
│  │  • Full Render Workflow (MVP direct; Full preview+bill)                           │   │
│  │  • Share Workflow (token generation → device claim)                               │   │
│  │  • Deletion Workflow (GDPR compliance cascade)                                    │   │
│  └──────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  WORKER LAYER                                            │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐     │
│   │         CPU WORKERS (c6i.xlarge)    │   │      CLOUD API WORKERS (Serverless) │     │
│   ├─────────────────────────────────────┤   ├─────────────────────────────────────┤     │
│   │ • Enrollment QC (VAD, SNR check)    │   │ • ElevenLabs Music API              │     │
│   │ • Lyrics Generation (LLM API)       │   │   (Instrumental + Guide Vocal)      │     │
│   │ • Content Moderation               │   │ • Soundverse API (Fallback)         │     │
│   │ • Music Plan Generation            │   │ • OpenAI/Claude API (Lyrics)        │     │
│   │ • Mix/Master/Encode (FFmpeg)       │   │                                     │     │
│   │ • Watermarking                     │   │ • Replicate API (Voice Embedding)   │     │
│   │ • Notifications                    │   │   ECAPA-TDNN for enrollment         │     │
│   └─────────────────────────────────────┘   │                                     │     │
│                                              │ • Replicate API (Voice Conversion) │     │
│   ┌─────────────────────────────────────┐   │   Hosted RVC v2 models              │     │
│   │  MVP DECISION: NO GPU WORKERS       │   │   (Guide Vocal → User Voice)        │     │
│   ├─────────────────────────────────────┤   │                                     │     │
│   │  All GPU tasks use cloud APIs:      │   └─────────────────────────────────────┘     │
│   │  • Voice embedding → Replicate      │                                               │
│   │  • Voice conversion → Replicate     │                                               │
│   │  Cost: ~$0.03-0.04 per conversion   │                                               │
│   └─────────────────────────────────────┘                                               │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  DATA LAYER                                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐                 │
│  │  PostgreSQL 15+    │  │     AWS S3         │  │    CloudFront      │                 │
│  │  (Primary DB)      │  │  (Object Storage)  │  │      (CDN)         │                 │
│  ├────────────────────┤  ├────────────────────┤  ├────────────────────┤                 │
│  │ • Users            │  │ • Voice samples    │  │ • Signed URLs      │                 │
│  │ • Voice profiles   │  │ • Voice embeddings │  │ • Edge caching     │                 │
│  │ • Tracks           │  │ • Song outputs     │  │ • Streaming        │                 │
│  │ • Track versions   │  │ • Preview audio    │  │   optimization     │                 │
│  │ • Jobs             │  │ • Share assets     │  │                    │                 │
│  │ • Audit logs       │  │                    │  │                    │                 │
│  │ • Share tokens     │  │                    │  │                    │                 │
│  │ • Entitlements     │  │                    │  │                    │                 │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘                 │
│                                                                                          │
│  ┌────────────────────┐  ┌────────────────────┐                                         │
│  │   AWS SQS/SNS      │  │    AWS KMS         │                                         │
│  │  (Message Queue)   │  │   (Encryption)     │                                         │
│  ├────────────────────┤  ├────────────────────┤                                         │
│  │ • Job queues       │  │ • User-specific    │                                         │
│  │ • Dead letter      │  │   encryption keys  │                                         │
│  │ • FIFO ordering    │  │ • Key rotation     │                                         │
│  │ • Retry handling   │  │ • Audit logging    │                                         │
│  └────────────────────┘  └────────────────────┘                                         │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            END-TO-END SONG CREATION FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘

     USER                API              TEMPORAL           WORKERS            STORAGE
       │                  │                  │                  │                  │
       │  1. VOICE ENROLLMENT (One-time)                                          │
       │──────────────────►                                                       │
       │  Record singing   │                  │                  │                  │
       │  samples          │──Upload chunks──►│                  │                  │
       │                   │                  │──Queue QC────────►                  │
       │                   │                  │                  │──Store raw──────►│
       │                   │                  │                  │──QC Check────────┤
       │                   │                  │◄─QC Result───────┤                  │
       │                   │                  │──Extract embed──►│                  │
       │                   │                  │                  │──Store embed────►│
       │                   │◄─Profile Ready───┤                  │                  │
       │◄─Success─────────┤                   │                  │                  │
       │                   │                  │                  │                  │
       │  2. SONG CREATION                                                         │
       │──────────────────►                                                        │
       │  Message +        │                  │                  │                  │
       │  Occasion +       │──Create Track────►                  │                  │
       │  Recipient        │                  │                  │                  │
       │                   │                  │──Moderation─────►│                  │
       │                   │                  │◄─Pass/Block──────┤                  │
       │                   │                  │──Lyric Gen──────►│                  │
       │                   │                  │                  │──LLM API────────►│
       │                   │                  │◄─Lyrics──────────┤                  │
       │◄─Review Lyrics────┤                  │                  │                  │
       │──Approve/Edit────►│                  │                  │                  │
       │                   │                  │                  │                  │
       │  3. PREVIEW GENERATION                                                    │
       │──────────────────►                                                        │
       │  Request preview  │──Start Preview───►                  │                  │
       │                   │                  │──Music Gen──────►│                  │
       │                   │                  │                  │──ElevenLabs API─►│
       │                   │                  │◄─Instrumental────┤◄─────────────────┤
       │                   │                  │◄─Guide Vocal─────┤                  │
       │                   │                  │──Voice Convert──►│                  │
       │                   │                  │                  │◄─Load Embed─────┤
       │                   │                  │                  │  RVC Process     │
       │                   │                  │◄─User Vocal──────┤                  │
       │                   │                  │──Mix/Master─────►│                  │
       │                   │                  │◄─Preview.aac─────┤──Store──────────►│
       │◄─Preview Ready────┤◄─CDN URL─────────┤                  │                  │
       │                   │                  │                  │                  │
       │  4. SHARE (Creator → Recipient)                                           │
       │──────────────────►                                                        │
       │  Request share    │──Create Token────►                  │                  │
       │  token            │                  │──Store Token─────┤                  │
       │◄─Share Link───────┤◄─Token + URL─────┤                  │                  │
       │                   │                  │                  │                  │
       │                   RECIPIENT                              │                  │
       │                      │               │                  │                  │
       │                      │──Open Link────►                  │                  │
       │                      │               │──Verify Identity─►                  │
       │                      │◄─Email/Phone──┤                  │                  │
       │                      │  Verification │                  │                  │
       │                      │──Submit Code──►                  │                  │
       │                      │               │──Bind Token──────►                  │
       │                      │◄─Stream URL───┤◄─Token Bound─────┤◄─Mark Active────┤
       │                      │               │                  │                  │
       └──────────────────────┴───────────────┴──────────────────┴──────────────────┘
```

---

## Flow 1: Voice Enrollment

### Overview
Users record 5 singing prompts (60-90 seconds total) to create their voice model. This is a one-time process that enables all future songs to sound like them.

### Detailed Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               VOICE ENROLLMENT FLOW                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SCREEN 1   │     │   SCREEN 2   │     │  SCREEN 3-7  │     │   SCREEN 8   │
│ Introduction │────►│  Environment │────►│   Guided     │────►│  Processing  │
│  & Consent   │     │    Check     │     │  Recording   │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │                    │
       │                    │                    │                    ▼
       ▼                    ▼                    ▼              ┌──────────────┐
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     │   SCREEN 9   │
│ Record       │     │ Check        │     │ Upload +     │     │ Verification │
│ consent      │     │ background   │     │ Real-time    │     │  & Result    │
│ timestamp    │     │ noise level  │     │ QC feedback  │     └──────────────┘
│              │     │ (< 15 dB)    │     │              │            │
└──────────────┘     └──────────────┘     └──────────────┘            │
                                                                       ▼
                                                                 ┌──────────────┐
                                                                 │ Voice Model  │
                                                                 │   Created    │
                                                                 │ (Encrypted)  │
                                                                 └──────────────┘
```

### Screen Details

#### Screen 1: Introduction & Consent
```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎤 Let's Set Up Your Voice                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ To create songs that sound like YOU, we need a short voice sample.      │
│                                                                         │
│ What we'll do:                                                          │
│ • Record you singing a few short phrases (about 1 minute total)         │
│ • Create a secure voice model stored only on our servers                │
│ • Your voice data is NEVER shared with third parties                    │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ ☑ I consent to Porizo creating a voice model from my recordings       │ │
│ │ ☑ I understand my voice stays on Porizo's secure servers              │ │
│ │ ☑ I will only create songs as myself, not impersonating others      │ │
│ │ ☑ I can delete my voice data at any time in Settings                │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│                    [ Continue to Recording ]                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**API Calls:**
```
POST /voice/enrollment/start
Request: { consent_accepted: true, consent_version: "v2.1" }
Response: { session_id, prompts[], upload_urls[], session_expires_at }
```

#### Screen 2: Environment Check
```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔇 Find a Quiet Space                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Listening to your environment...                                      │
│                                                                         │
│   Background Noise: [████████░░] Too Loud                               │
│                                                                         │
│   Tips:                                                                 │
│   • Close windows and doors                                             │
│   • Turn off fans, AC, or music                                         │
│   • Move away from traffic or conversations                             │
│                                                                         │
│   Current: 🔴 25 dB (needs < 15 dB)                                     │
│                                                                         │
│                    [ Check Again ]                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Quality Thresholds:**
- Background noise: < 15 dB
- Clipping: < 5% of samples
- Duration per prompt: > 5 seconds of actual singing

#### Screens 3-7: Guided Recording (5 Prompts)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎵 Recording 1 of 5                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Sing these syllables at a comfortable pitch:                          │
│                                                                         │
│        ♪ "La la la, la la la, la la laaa" ♪                            │
│                                                                         │
│   [▶ Tap to hear example]                                               │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                                                                 │   │
│   │               🎤 [████████████░░░░] 8s / 12s                    │   │
│   │                                                                 │   │
│   │   Volume: [████████░░] Good                                     │   │
│   │                                                                 │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│         [ ⏹ Stop ]              [ Re-record ]                          │
└─────────────────────────────────────────────────────────────────────────┘

PROMPT SET (varies per user):
1. "La la la, la la la, la la laaa" - tests pitch range
2. "Ooo-ooo-ooo, ahh-ahh-ahh" - tests vowel sounds
3. "Happy birthday to you, happy birthday to you" - familiar melody
4. "Do re mi fa so la ti do" - tests scale
5. "My name is [Name], nice to meet you" - personalization
```

**Real-Time Quality Feedback:**
```typescript
interface RecordingQuality {
  snr: number           // Signal-to-noise ratio (target: > 15dB)
  clipping: number      // % of samples clipped (target: < 5%)
  duration: number      // Seconds of actual singing (target: > 5s)
  volume: 'low' | 'good' | 'high'
  pitch: {
    detected: boolean   // Was pitch detected?
    range: number       // Semitones covered (target: > 6)
  }
}
```

**API Calls (per chunk):**
```
PUT [presigned_url] - Upload audio chunk to S3

POST /voice/enrollment/chunk_uploaded
Request: { session_id, chunk_id, prompt_id, duration_sec, client_checksum }
Response: { status, qc_job_id, next_upload_url }
```

#### Screen 8: Processing
```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚙️ Creating Your Voice                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   [████████████████░░░░] 80%                                            │
│                                                                         │
│   ✓ Analyzing your recordings                                           │
│   ✓ Cleaning up audio                                                   │
│   ⏳ Training your voice model                                          │
│   ○ Testing voice quality                                               │
│                                                                         │
│   This takes about 30 seconds...                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Backend Processing Steps:**
1. **QC Assembly** (CPU) - Concatenate chunks, final quality check
2. **Embedding Extraction** (Replicate API) - Run ECAPA-TDNN/Resemblyzer model
3. **Verification** (CPU + API) - Cross-check consistency across prompts
4. **Encryption** (CPU) - Encrypt with user-specific KMS key

**MVP Note:** Embedding extraction uses Replicate API (no self-hosted GPU).

**API Call:**
```
POST /voice/enrollment/complete
Request: { session_id }
Response: { status: "processing", job_id, estimated_completion_sec: 30 }

GET /jobs/{job_id} - Poll for completion
Response: { status: "completed", voice_profile_id }
```

#### Screen 9: Result
```
SUCCESS:
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎉 Your Voice is Ready!                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Voice Quality Score: ⭐⭐⭐⭐☆ (Great!)                                │
│                                                                         │
│   [▶ Hear a sample of your AI voice]                                    │
│                                                                         │
│   Your voice model is securely stored and ready to use.                 │
│   Create your first song now!                                           │
│                                                                         │
│                    [ Create My First Song ]                             │
└─────────────────────────────────────────────────────────────────────────┘

LOW QUALITY (similarity < 0.7):
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔄 Let's Try Again                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Voice Quality Score: ⭐⭐☆☆☆ (Could be better)                        │
│                                                                         │
│   For the best results, we recommend re-recording:                      │
│   • Find an even quieter space                                          │
│   • Hold your phone closer to your mouth                                │
│   • Sing with more expression and volume                                │
│                                                                         │
│   [▶ Hear current quality]    [ Try Again ]    [ Use Anyway ]          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Backend Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          ENROLLMENT BACKEND PROCESSING                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Mobile App              API Gateway           Temporal              Workers
       │                       │                    │                     │
       │──Upload chunk 1──────►│                    │                     │
       │                       │──Notify upload────►│                     │
       │                       │                    │──Queue QC──────────►│
       │                       │                    │                     │ CPU: VAD, SNR
       │                       │                    │◄─Chunk 1 QC: PASS──┤
       │                       │                    │                     │
       │──Upload chunk 2──────►│                    │                     │
       │      ...              │      ...           │        ...          │
       │──Upload chunk 5──────►│                    │                     │
       │                       │                    │                     │
       │──Complete Session────►│──Trigger Complete──►│                     │
       │                       │                    │──Assemble Audio────►│
       │                       │                    │                     │ CPU: Concat
       │                       │                    │◄─clean.wav──────────┤
       │                       │                    │                     │
       │                       │                    │──Extract Embedding─►│
       │                       │                    │                     │ GPU: ECAPA-TDNN
       │                       │                    │◄─embedding.bin──────┤
       │                       │                    │                     │
       │                       │                    │──Verify Liveness───►│
       │                       │                    │                     │ GPU: Cosine sim
       │                       │                    │◄─Similarity: 0.92───┤
       │                       │                    │                     │
       │                       │                    │──Encrypt + Store───►│
       │                       │                    │                     │ KMS + S3
       │                       │                    │──Update DB──────────►│
       │◄─Profile Ready────────┤◄─Workflow Complete─┤                     │
       │                       │                    │                     │
```

---

## Flow 2: Song Creation Pipeline

### Overview
User provides a message and occasion → System generates lyrics → User reviews/edits → Full song rendered (MVP) or preview then full render (Full).

### Message-to-Song Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SONG CREATION PIPELINE                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

Step 1                 Step 2                Step 3                Step 4
CAPTURE FEELING        GENERATE LYRICS       GENERATE PREVIEW      FULL RENDER
┌─────────────┐        ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ Occasion    │        │ LLM         │       │ ElevenLabs  │       │ Full Song   │
│ Recipient   │───────►│ Lyrics      │──────►│ Music Gen   │──────►│ Render      │
│ Message     │        │ Generation  │       │ + Voice     │       │ + Billing(F)│
│ Style       │        │ + Review    │       │ Conversion  │       │ + Delivery  │
└─────────────┘        └─────────────┘       └─────────────┘       └─────────────┘
     │                      │                      │                      │
     ▼                      ▼                      ▼                      ▼
┌─────────────┐        ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ • Birthday  │        │ • Singable  │       │ • 15-25 sec │       │ • MVP 45-60s│
│ • Thank you │        │   syllables │       │   chorus    │       │ • Full 45-90│
│ • I love you│        │ • Name in   │       │ • Full p95  │       │ • Billing   │
│ • Custom    │        │   chorus    │       │   <90s      │       │ • Full only │
└─────────────┘        └─────────────┘       └─────────────┘       └─────────────┘
```

**Note:** MVP skips preview and targets p95 < 4 min for full render; preview + billing are Full only.

### Step 1: Capture the Feeling (Input Screen)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 💝 Create a Song for Someone Special                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Occasion:                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ [ Birthday ] [ Anniversary ] [ Thank You ] [ I Love You ] [ Other ]│
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  Who is this for?                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ Sarah                                                               │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  What do you want to say? (Your message becomes the song)               │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ I want to tell her she lights up every room and that I'm           │
│  │ grateful she's in my life. She's my best friend and I              │
│  │ don't know what I'd do without her.                                │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  Must-include phrase (optional):                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ You light up every room                                             │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  Style:    [ Pop ▼ ]     Tone:    [ Heartfelt ▼ ]                      │
│                                                                         │
│                    [ ✨ Create My Song ]                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**API Call:**
```
POST /tracks
Request: {
  title: "Happy Birthday Sarah!",
  occasion: "birthday",
  recipient_name: "Sarah",
  style: "pop_upbeat",
  duration_target: 60,
  voice_mode: "user_voice",
  message: "I want to tell her she lights up...",
  must_include_lines: ["You light up every room"],
  language: "en"
}
Response: { track_id, status: "draft" }
```

### Step 2: Lyrics Generation & Review

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              LYRICS GENERATION PIPELINE                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘

      User Input                    LLM Processing                    Output
          │                              │                              │
          │                              │                              │
          ▼                              │                              │
  ┌───────────────┐                      │                              │
  │ Message:      │                      │                              │
  │ "She lights   │                      ▼                              │
  │  up every     │              ┌───────────────┐                      │
  │  room..."     │──────────────│   Moderation  │                      │
  │               │              │   Check       │                      │
  │ Occasion:     │              └───────┬───────┘                      │
  │ Birthday      │                      │ PASS                         │
  │               │                      ▼                              │
  │ Must-include: │              ┌───────────────┐                      │
  │ "You light    │              │     LLM       │                      │
  │  up every     │──────────────│   Generation  │                      │
  │  room"        │              │ (GPT-4o /     │                      │
  │               │              │  Claude)      │                      │
  │ Style: Pop    │              └───────┬───────┘                      │
  │ Tone: Heart-  │                      │                              │
  │  felt         │                      ▼                              │
  └───────────────┘              ┌───────────────┐              ┌───────────────┐
                                 │  Singability  │              │   lyrics.json │
                                 │  Validation   │─────────────►│   with        │
                                 │ (6-12 syl/    │              │   sections    │
                                 │  line)        │              │   and timing  │
                                 └───────────────┘              └───────────────┘
```

**LLM System Prompt:**
```
You are a professional songwriter who creates personalized, singable lyrics.

CRITICAL RULES:
- 6-12 syllables per line (singable in one breath)
- Recipient's name MUST appear in the chorus at least once
- Must-include phrases must appear EXACTLY as provided
- Simple rhyme schemes (AABB or ABAB)
- Family-friendly, no profanity

SONG STRUCTURE for 60s song:
- Verse 1 (4 lines) → Pre-chorus (2 lines) → Chorus (4 lines)
- Verse 2 (4 lines) → Chorus (4 lines) → Outro (2 lines)
```

**Lyrics Review Screen:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📝 Review Your Lyrics                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Verse 1]                                                [ Regenerate ]│
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ Sarah you're the sunshine in my day              ○ 9 syllables ✓   │
│  │ Every moment with you feels like play            ○ 9 syllables ✓   │
│  │ You light up every room you walk into            ⚠ 11 syllables    │
│  │ And that's why this song is just for you         ○ 10 syllables ✓  │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  [Chorus]                                             [ Regenerate ]    │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │ Happy birthday Sarah, yeah                       ○ 7 syllables ✓   │
│  │ You light up every room                          ★ Must-include ✓  │
│  │ Happy birthday Sarah, hey                        ○ 7 syllables ✓   │
│  │ We're celebrating you                            ○ 6 syllables ✓   │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  ⚠ 1 line may be slightly long for singing (tap to see suggestion)     │
│                                                                         │
│  ┌────────────────────────────────────┐  ┌────────────────────────────┐ │
│  │ [ Edit Lyrics Manually ]           │  │ [ 🎵 Generate Preview ]    │ │
│  └────────────────────────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**API Calls:**
```
POST /tracks/{id}/versions
Request: {
  params: {
    lyrics_style: "heartfelt",
    prosody_preset: "playful",
    similarity_strength: "medium"
  },
  render_type: "preview"
}
Response: { track_version_id, version_num: 1, status: "queued" }
```

### Step 3: Preview Generation (15-25 seconds)

**[FULL]** Preview generation is a full-product feature. MVP skips this step and goes directly to Step 4.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PREVIEW RENDER PIPELINE                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘

      Temporal Workflow Steps (Full p95 target: 90 seconds)
                    │
    ┌───────────────┼───────────────┬───────────────┬───────────────┐
    ▼               ▼               ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ MODER-  │   │ MUSIC   │   │ GUIDE   │   │ VOICE   │   │ MIX +   │
│ ATION   │──►│ GENER-  │──►│ VOCAL   │──►│ CONVER- │──►│ WATER-  │
│         │   │ ATION   │   │         │   │ SION    │   │ MARK    │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
    │               │               │               │               │
    │ CPU           │ Cloud API     │ Cloud API     │ GPU           │ CPU
    │ ~2s           │ ~30s          │ (included)    │ ~30s          │ ~10s
    │               │               │               │               │
    ▼               ▼               ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ Pass/   │   │ instru- │   │ guide_  │   │ user_   │   │ preview │
│ Block   │   │ mental  │   │ vocal   │   │ vocal   │   │ .aac    │
│ decision│   │ .wav    │   │ .wav    │   │ .wav    │   │         │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
```

**Backend Processing Details:**

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                          PREVIEW RENDER BACKEND DETAIL                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Temporal                    CPU Workers                      External APIs
       │                          │                                 │
       │──1. MODERATION──────────►│                                 │
       │                          │──Profanity filter               │
       │                          │──Impersonation check            │
       │                          │──PII detection                  │
       │◄─Pass/Block──────────────┤                                 │
       │                          │                                 │
       │──2. MUSIC GENERATION────────────────────────────────────────►│
       │   (ElevenLabs API)       │                                 │ ElevenLabs
       │                          │                                 │ Music API
       │◄─instrumental.wav────────────────────────────────────────────┤
       │◄─guide_vocal.wav─────────────────────────────────────────────┤
       │◄─lyrics_timestamps───────────────────────────────────────────┤
       │                          │                                 │
       │──3. VOICE CONVERSION────────────────────────────────────────►│
       │   (Replicate API)        │                                 │ Replicate
       │                          │                                 │ RVC Model
       │                          │                                 │ (~$0.03/run)
       │◄─user_vocal.wav──────────────────────────────────────────────┤
       │                          │                                 │
       │──4. MIX/MASTER──────────►│                                 │
       │                          │──Mix (vocal prominent)          │
       │                          │──De-esser, compression          │
       │                          │──Loudness normalize             │
       │◄─mixed.wav───────────────┤                                 │
       │                          │                                 │
       │──5. WATERMARK───────────►│                                 │
       │                          │──Embed track_version_id         │
       │                          │──Encode to AAC                  │
       │◄─preview.aac─────────────┤                                 │
       │                          │                                 │
       │──6. UPLOAD + CDN URL────►│                                 │
       │                          │──Upload to S3                   │
       │                          │──Generate signed URL            │
       │◄─cdn_url─────────────────┤                                 │
       │                          │                                 │
```

**MVP Note:** Voice conversion uses Replicate's hosted RVC models (no self-hosted GPU).

**Preview Ready Screen:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎵 Preview Ready!                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐
│  │                                                                     │
│  │     ▶ [═══════════════════════════░░░░░░░░░░░░]  0:18 / 0:22       │
│  │                                                                     │
│  │     ♫ "Happy birthday Sarah, you light up every room" ♫            │
│  │                                                                     │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  Does it sound like you? Rate the preview:                              │
│                                                                         │
│       😟         😐         🙂         😊         🤩                    │
│     Not me    Not sure   Okay       Good      Sounds                   │
│               at all               enough      like me!                │
│                                                                         │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────────────┐  │
│  │ [ Edit Lyrics ]│ │ [Try New Style]│ │ [✨ Create Full Song - 1💎]│  │
│  └────────────────┘ └────────────────┘ └────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step 4: Full Song Render (MVP: 45-60s, Full: 45-90s)

**MVP:** single full-song render without preview or billing; focus on speed and voice similarity.

**Full render (FULL) follows same pipeline but:**
- Complete lyrics (all verses, bridge, outro)
- Section-by-section voice conversion for quality
- Credits charged from billing hold
- Download enabled

**API Calls:**
```
POST /tracks/{id}/versions/{v}/render_full
Request: { confirm_credit_spend: true }
Response: { job_id, billing_hold_id, credits_reserved: 1, estimated_completion_sec: 180 }

GET /jobs/{job_id} - Poll for completion
Response: { status: "completed", download_url, stream_url }
```

---

## Flow 3: Share-Once Delivery

### Overview
Creator generates one share token per song → Recipient can stream from the link → First app claim binds token to device → Saving is app-only → Re-share is denied.

### Share Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SHARE-ONCE DELIVERY FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘

     CREATOR                                              RECIPIENT
         │                                                    │
         │  1. CREATE SHARE TOKEN                             │
         │─────────────────────┐                              │
         ▼                     │                              │
   ┌─────────────┐              │                              │
   │ Request     │              │                              │
   │ share token │──────────────┤                              │
   │ for song    │              │                              │
   └─────────────┘              ▼                              │
          │              ┌─────────────┐                       │
          │              │ Generate    │                       │
          │              │ unique      │                       │
          │              │ share_id    │                       │
          │              └─────────────┘                       │
          │                     │                              │
          ▼                     ▼                              │
   ┌─────────────┐       ┌─────────────┐                       │
   │ Receive     │◄──────│ Store token │                       │
   │ share link  │       │ (unbound)   │                       │
   │ + QR code   │       └─────────────┘                       │
   └─────────────┘              │                              │
          │                     │                              │
          │                     │                              │
          │  2. SHARE LINK TO RECIPIENT                        │
          │─────────────────────────────────────────────────────►
          │  (via SMS, email, messenger, etc.)                 │
          │                                                    │
          │                                                    │  3. RECIPIENT OPENS LINK (WEB)
          │                                                    │◄─────────────────────────────
          │                                                    │
          │                     ┌─────────────┐                │
          │                     │ If unbound: │◄───────────────┤
          │                     │ stream web  │                │
          │                     │ + show app  │                │
          │                     │ download    │                │
          │                     └─────────────┘                │
          │                                                    │
          │                                                    │  4. APP INSTALL + CLAIM
          │                                                    │◄─────────────────────────────
          │                     ┌─────────────┐                │
          │                     │ Bind token  │───────────────►│
          │                     │ to device   │                │
          │                     └─────────────┘                │
          │                            │                       │
          │                            ▼                       │
          │                     ┌─────────────┐         ┌─────────────┐
          │                     │ App stream  │────────►│ Save in app │
          │                     │ allowed     │         │ library     │
          │                     └─────────────┘         └─────────────┘
          │                                                    │
          │  5. ATTEMPTED RE-SHARE                             │
          │                            │                       │
          │                            │                ┌─────────────┐
          │                            │◄───────────────│ Forward     │
          │                            │                │ link to     │
          │                            │                │ another     │
          │                            │                │ person      │
          │                            ▼                └─────────────┘
          │                     ┌─────────────┐                │
          │                     │ New device  │                │
          │                     │ attempts    │                │
          │                     │ access      │                │
          │                     └─────────────┘                │
          │                            │                       │
          │                            ▼                       │
          │                     ┌─────────────┐                │
          │                     │ Token       │                │
          │                     │ already     │                │
          │                     │ bound       │                │
          │                     └─────────────┘                │
          │                            │                       │
          │                            ▼                       │
          │                     ┌─────────────┐         ┌─────────────┐
          │                     │ REJECT      │────────►│ ACCESS      │
          │                     │ ACCESS      │         │ DENIED      │
          │                     └─────────────┘         └─────────────┘
          │                                                    │
          │                                                    │
          │  6. REVOCATION (Creator)                           │
          ▼                                                    │
   ┌─────────────┐                                             │
   │ Revoke      │                                             │
   │ access      │                                             │
   └─────────────┘                                             │
          │                                                    │
          ▼                                                    │
   ┌─────────────┐                                      ┌─────────────┐
   │ Token       │─────────────────────────────────────►│ ACCESS      │
   │ invalidated │                                      │ REVOKED     │
   └─────────────┘                                      └─────────────┘
```

### Share Token Data Model

```typescript
interface ShareToken {
  id: string                    // Primary key (e.g., "abc123xyz")
  track_id: string              // Foreign key to tracks
  track_version_id: string      // Specific version shared
  creator_id: string            // User who created the share

  // Binding status
  status: 'unbound' | 'claimed' | 'revoked' | 'expired'

  // Device binding (first app claim wins)
  bound_device_id: string | null
  bound_device_platform: 'ios' | 'android' | null
  bound_app_version: string | null
  bound_at: Date | null

  // Access control
  web_stream_allowed: boolean   // True until claimed; no downloads
  app_save_allowed: boolean     // Save only inside the mobile app
  expires_at: Date              // Default 30 days from creation

  // Audit
  created_at: Date
  last_accessed_at: Date | null
  access_count: number
}
```

### API Endpoints

```
# Creator creates share token
POST /tracks/{id}/share
	Request: {
	  version_num: 1,
	  expires_in_days: 30
	}
	Response: {
	  share_id: "abc123xyz",
	  share_url: "https://app.raza.com/s/abc123xyz",
	  qr_code_url: "https://cdn.raza.com/qr/abc123xyz.png",
	  expires_at: "2025-02-28T00:00:00Z"
	}

# Recipient opens share link (no auth required)
GET /share/{share_id}
	Response (unbound):
	{
	  status: "unbound",
	  track_preview: {
	    title: "Happy Birthday Sarah!",
	    duration_sec: 62,
	    cover_image_url: "..."
	  },
	  web_stream_url: "https://cdn.raza.com/stream/...", // short-lived, stream-only
	  app_download_url: "https://app.raza.com/download"
	}
	Response (claimed):
	{
	  status: "claimed",
	  app_required: true,
	  app_download_url: "https://app.raza.com/download"
	}

# App claim (first device binds token)
POST /share/{share_id}/claim
	Request: {
	  device_id: "ios-idfv-123",
	  platform: "ios",
	  app_version: "1.0.0"
	}
	Response (success): {
	  status: "claimed",
	  app_save_allowed: true,
	  expires_at: "2025-02-28T00:00:00Z"
	}
	Response (bound): { error: "TOKEN_ALREADY_BOUND" }

# App stream (bound device only)
GET /share/{share_id}/stream
	Headers: { X-Device-Id: "...", X-Platform: "ios" }
	Response (bound): { stream_url: "...", expires_at: "..." }
	Response (unbound): { error: "NOT_CLAIMED" }
	Response (different device): { error: "TOKEN_ALREADY_BOUND" }

# Creator revokes access
DELETE /tracks/{id}/share
	Response: { revoked: true }
```

### Recipient Playback Page

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎵 Someone made you a song!                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│     ┌───────────────────────────────────────────────────────────┐      │
│     │                                                           │      │
│     │                    🎂                                     │      │
│     │             Happy Birthday Sarah!                         │      │
│     │                                                           │      │
│     │                  A song for you                           │      │
│     │                                                           │      │
│     └───────────────────────────────────────────────────────────┘      │
│                                                                         │
│     Tap play to listen (stream only).                                  │
│     To save this song, download the Porizo app.                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

After playback:
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎵 Happy Birthday Sarah!                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│     ┌───────────────────────────────────────────────────────────┐      │
│     │                                                           │      │
│     │     ▶ [════════════════════════════════░░░░]  0:42 / 1:02 │      │
│     │                                                           │      │
│     │         ♫ Now playing: Happy Birthday Sarah ♫            │      │
│     │                                                           │      │
│     └───────────────────────────────────────────────────────────┘      │
│                                                                         │
│     This song was made with ❤️ just for you.                           │
│                                                                         │
│     ┌───────────────────────────────────────────────────────────┐      │
│     │ Want to keep this song forever?                           │      │
│     │ Download the Porizo app to save it to your library.         │      │
│     │                                                           │      │
│     │   [ Download on App Store ]  [ Get it on Google Play ]   │      │
│     └───────────────────────────────────────────────────────────┘      │
│                                                                         │
│     ─────────────────────────────────────────────────────────────      │
│     Note: This link is personal to you and cannot be shared.           │
│     Link expires: Feb 28, 2025                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (Core Tables)

```sql
-- Share tokens table
CREATE TABLE share_tokens (
    id VARCHAR(20) PRIMARY KEY,
    track_id UUID NOT NULL REFERENCES tracks(id),
    track_version_id UUID NOT NULL REFERENCES track_versions(id),
    creator_id UUID NOT NULL REFERENCES users(id),

    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'unbound',
    -- Values: unbound, claimed, revoked, expired

    -- Device binding (first app claim wins)
    bound_device_id VARCHAR(128),
    bound_device_platform VARCHAR(10), -- 'ios' or 'android'
    bound_app_version VARCHAR(20),
    bound_at TIMESTAMPTZ,

    -- Access control
    web_stream_allowed BOOLEAN NOT NULL DEFAULT true,
    app_save_allowed BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ NOT NULL,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,

    -- Constraints
    CONSTRAINT unique_share_per_track
        UNIQUE (track_id)
);

-- Share access log (for audit)
CREATE TABLE share_access_log (
    id BIGSERIAL PRIMARY KEY,
    share_token_id VARCHAR(20) NOT NULL REFERENCES share_tokens(id),
    event_type VARCHAR(30) NOT NULL,
    -- Values: link_opened, stream_started, claim_attempted,
    --         claim_success, claim_failed, access_denied, revoked
    device_fingerprint VARCHAR(64),
    ip_address_hash VARCHAR(64),
    user_agent VARCHAR(500),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_access_log_token ON share_access_log(share_token_id);
CREATE INDEX idx_share_access_log_created ON share_access_log(created_at);
```

---

## Component Interactions

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMPONENT INTERACTION MAP                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│   Mobile Apps    │
│  (iOS/Android)   │
└────────┬─────────┘
         │
         │ REST API + WebSocket (status updates)
         ▼
┌──────────────────┐     ┌──────────────────┐
│   API Gateway    │────►│ Authentication   │ (Firebase/Auth0)
│   (Fastify)      │     │ Service          │
└────────┬─────────┘     └──────────────────┘
         │
         ├────────────────────────────────────────────────────────────────┐
         │                                                                 │
         ▼                                                                 ▼
┌──────────────────┐                                              ┌──────────────────┐
│   Temporal.io    │                                              │   PostgreSQL     │
│   Workflows      │                                              │   Database       │
├──────────────────┤                                              ├──────────────────┤
│ • Enrollment     │                                              │ • Users          │
│ • Preview Render │                                              │ • Voice Profiles │
│ • Full Render    │                                              │ • Tracks         │
│ • Share/Claim    │                                              │ • Share Tokens   │
│ • Deletion       │                                              │ • Audit Logs     │
└────────┬─────────┘                                              └──────────────────┘
         │
         │ Task Queues (SQS)
         │
         ├─────────────────────┬─────────────────────┬─────────────────────┐
         │                     │                     │                     │
         ▼                     ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   CPU Workers    │  │ GPU Workers (FULL)│  │ LLM Workers      │  │ Music Workers    │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ • QC (audio)     │  │ • Voice Embed    │  │ • Lyric Gen      │  │ • ElevenLabs     │
│ • Mix/Master     │  │ • RVC Conversion │  │ • Moderation     │  │ • Soundverse     │
│ • Watermark      │  │                  │  │ • Singability    │  │   (fallback)     │
│ • Encode         │  │                  │  │                  │  │                  │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                     │                     │
         │                     │                     │                     │
         └──────────────┬──────┴──────────────┬──────┴──────────────┬──────┘
                        │                     │                     │
                        ▼                     ▼                     ▼
               ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
               │   AWS S3         │   │   AWS KMS        │   │   CloudFront     │
               │   (Storage)      │   │   (Encryption)   │   │   (CDN)          │
               ├──────────────────┤   ├──────────────────┤   ├──────────────────┤
               │ • Voice samples  │   │ • User keys      │   │ • Signed URLs    │
               │ • Embeddings     │   │ • Key rotation   │   │ • Streaming      │
               │ • Song outputs   │   │                  │   │ • Caching        │
               └──────────────────┘   └──────────────────┘   └──────────────────┘
```

---

## Tech Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React Native | iOS + Android mobile apps |
| **API** | Node.js + Fastify + TypeScript | REST API, WebSocket |
| **Orchestration** | Temporal.io | Workflow management |
| **Queue** | AWS SQS + SNS | Job distribution |
| **Database** | PostgreSQL 15+ | Primary data store |
| **Storage** | AWS S3 | Audio files, embeddings |
| **CDN** | CloudFront | Content delivery |
| **CPU Compute** | EC2 c6i.xlarge | Mix/master, QC |
| **Music API** | ElevenLabs (primary), Soundverse (fallback) | Instrumental + guide vocals |
| **Voice Embedding** | Replicate API (ECAPA-TDNN) | Voice embedding extraction |
| **Voice Conversion** | Replicate API (RVC v2) | Guide → User voice (~$0.03/run) |
| **LLM** | OpenAI GPT-4o / Claude | Lyrics generation |
| **Auth** | Firebase Auth / Auth0 | User authentication |
| **Encryption** | AWS KMS | Per-user encryption |
| **Monitoring** | Datadog / CloudWatch | Observability |

**MVP Decision:** No self-hosted GPU infrastructure. All GPU tasks (voice embedding, voice conversion) use cloud APIs (Replicate). Upgrade path: Kits AI for higher quality, or self-hosted RVC post-MVP.

---

## Next Steps

1. **Phase 0 Validation**
   - Verify ElevenLabs API provides isolated stems and guide vocals
   - Test Replicate voice conversion quality with sample audio
   - Validate MVP end-to-end latency meets p95 < 4 min target; keep full-product targets (preview < 90s, full < 180s) as stretch
2. **Infrastructure Setup** - Provision AWS resources (no GPU), set up Temporal
3. **MVP Build** - Follow task breakdown in `synthetic-bubbling-dream-Tasks.md`

---

*Last updated: December 29, 2025*
