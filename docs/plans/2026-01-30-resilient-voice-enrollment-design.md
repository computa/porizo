# Resilient Voice Enrollment System

**Goal:** Make voice enrollment work for everyday people in any environment while maintaining production-quality voice conversion output.

**Design Principles:**
1. Accept all recordings, never reject (unless corrupt/silent)
2. Guide users to better recordings through real-time feedback
3. Be transparent about quality impact on voice likeness
4. Allow quality improvement at any time
5. Feature-flag preprocessing strategies to measure what works

---

## 1. Quality Tier System

### Tier Definitions

| Tier | Internal Score | User Label | Icon | Voice Likeness Disclosure |
|------|----------------|------------|------|---------------------------|
| Excellent | 80-100 | Excellent | ★★★ | "Songs will sound very close to your natural voice" |
| Good | 60-79 | Good | ★★☆ | "Songs will sound like you with light AI enhancement" |
| Fair | 40-59 | Fair | ★☆☆ | "Songs will capture your vocal character with moderate AI enhancement" |
| Basic | 20-39 | Basic | ☆☆☆ | "We've captured your voice. Recording in a quieter space will improve how closely songs match your voice" |
| Minimal | 0-19 | — | — | Profile created but user strongly encouraged to re-record |

### Scoring Algorithm

```
base_score = 100

# SNR penalty (0-40 points)
if snr_db < 8:   penalty = 40
elif snr_db < 12: penalty = 30
elif snr_db < 15: penalty = 20
elif snr_db < 20: penalty = 10
elif snr_db < 25: penalty = 5
else: penalty = 0
base_score -= penalty

# Clipping penalty (0-25 points)
if clipping_ratio > 0.10: penalty = 25
elif clipping_ratio > 0.05: penalty = 15
elif clipping_ratio > 0.03: penalty = 8
elif clipping_ratio > 0.01: penalty = 3
else: penalty = 0
base_score -= penalty

# Reverb penalty (0-15 points)
if reverb_level > 0.7: penalty = 15
elif reverb_level > 0.5: penalty = 10
elif reverb_level > 0.3: penalty = 5
else: penalty = 0
base_score -= penalty

# Duration bonus (0-10 points)
if total_duration >= 45: bonus = 10
elif total_duration >= 30: bonus = 5
elif total_duration >= 20: bonus = 2
else: bonus = 0
base_score += bonus

# Singing content bonus (0-10 points)
if has_quality_singing: bonus = 10
elif has_any_singing: bonus = 5
base_score += bonus

final_score = clamp(base_score, 0, 100)
```

### Chunk Weighting

- **Spoken prompts:** weight = 1.0 (full contribution to score)
- **Sung prompts:** weight = 0.6 (reduced impact on overall score)

Failed sung prompts should not tank an otherwise good enrollment.

---

## 2. Adaptive Conversion Parameters

Voice conversion parameters auto-adjust based on quality tier:

| Tier | Diffusion Steps | CFG Rate | Length Adjust | Description |
|------|-----------------|----------|---------------|-------------|
| Excellent | 25 | 0.7 | 1.0 | Maximum voice preservation |
| Good | 50 | 0.6 | 1.0 | Balanced conversion |
| Fair | 75 | 0.5 | 1.0 | More AI smoothing |
| Basic | 100 | 0.4 | 1.0 | Heavy AI enhancement |
| Minimal | 150 | 0.3 | 1.0 | Maximum AI compensation |

**Rationale:** Lower quality reference audio needs more diffusion steps to smooth out artifacts, and lower CFG rate to rely less on the noisy reference.

---

## 3. iOS Real-Time Recording Feedback

### Audio Analysis (On-Device, Real-Time)

The iOS app performs continuous audio analysis during recording:

```swift
struct LiveAudioMetrics {
    let rmsLevel: Float        // -60 to 0 dB
    let peakLevel: Float       // -60 to 0 dB
    let noiseFloor: Float      // Estimated background noise level
    let snrEstimate: Float     // Real-time SNR estimate
    let isClipping: Bool       // Peak detection
    let isSpeechDetected: Bool // VAD result
}
```

### Visual Feedback Components

#### 1. Audio Level Meter
- Vertical or circular meter showing current input level
- Green zone: -30 to -12 dB (optimal)
- Yellow zone: -40 to -30 dB (too quiet) or -12 to -6 dB (loud)
- Red zone: below -40 dB (very quiet) or above -6 dB (clipping risk)

#### 2. Environment Quality Indicator
- Shows overall recording environment quality
- Updates every 500ms based on rolling noise floor estimate
- States: "Great" (green), "Good" (light green), "Noisy" (yellow), "Very Noisy" (orange)

#### 3. Coaching Tips (Contextual)
Real-time tips that appear based on detected issues:

| Condition | Tip |
|-----------|-----|
| RMS < -40 dB for 2+ seconds | "Speak a bit louder or move closer to your phone" |
| Noise floor > -30 dB | "Try to find a quieter spot if possible" |
| Clipping detected | "You're a bit loud — no need to shout!" |
| No speech for 3+ seconds | "Tap to start recording when ready" |
| Good conditions | "Great! Keep going" (brief, then fade) |

#### 4. Per-Prompt Quality Badge
After each prompt completes, show a quick badge:
- ✓ Great recording
- ✓ Good recording
- △ Acceptable (tip: "Re-record for better quality")

User can tap to re-record individual prompts.

### Recording Flow Changes

```
1. Pre-Recording Screen
   - Show current environment assessment
   - "Your environment: [Good/Noisy]"
   - Tips for best results (collapsible)
   - "Start Recording" button

2. During Recording
   - Live audio meter (always visible)
   - Environment badge (top corner)
   - Coaching tip area (bottom, contextual)
   - Prompt text (center)
   - Stop button

3. Post-Prompt
   - Brief quality badge
   - "Next" or "Re-record" options
   - Progress indicator (e.g., "3 of 6")

4. Completion Screen
   - Overall quality tier with stars
   - Voice likeness disclosure text
   - "Done" or "Improve Quality" options
   - Per-prompt breakdown (expandable)
```

---

## 4. Backend Preprocessing Pipeline

### Architecture: Three Strategies, Feature-Flagged

```
┌─────────────────────────────────────────────────────────────────┐
│                    Preprocessing Router                          │
│                                                                  │
│  Feature Flag: voice_enrollment_preprocessing_strategy           │
│  Values: "ffmpeg" | "ml_server" | "hybrid"                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   FFmpeg      │ │  ML Server    │ │    Hybrid     │
│   Pipeline    │ │  Pipeline     │ │   Pipeline    │
└───────────────┘ └───────────────┘ └───────────────┘
```

### Strategy 1: Enhanced FFmpeg Pipeline

**Cost:** Free (CPU only)
**Latency:** ~200ms per chunk
**Quality:** Good for moderate noise (30-45 dB ambient)

```bash
# Pipeline stages:
# 1. High-pass filter (remove rumble below 80Hz)
# 2. Noise gate (suppress very quiet sections)
# 3. Adaptive FFT denoiser (main noise suppression)
# 4. Compressor (even out dynamics)
# 5. Loudness normalization

ffmpeg -i input.wav \
  -af "highpass=f=80, \
       agate=threshold=-40dB:ratio=2:attack=10:release=100, \
       afftdn=nr=15:nf=-25:tn=1, \
       acompressor=threshold=-20dB:ratio=3:attack=5:release=50, \
       loudnorm=I=-20:LRA=11:TP=-1.5" \
  -ar 44100 -ac 1 -acodec pcm_s16le \
  output.wav
```

**Singing-specific enhancement:**
```bash
# More aggressive for sung prompts
ffmpeg -i input.wav \
  -af "highpass=f=60, \
       afftdn=nr=20:nf=-30:tn=1, \
       acompressor=threshold=-25dB:ratio=4:attack=3:release=100, \
       loudnorm=I=-18:LRA=14:TP=-1" \
  output.wav
```

### Strategy 2: ML Server Pipeline

**Cost:** ~$0.01-0.02 per enrollment (API calls)
**Latency:** ~500-1000ms per chunk
**Quality:** Excellent for noisy environments (40-60 dB ambient)

Options (in order of preference):
1. **DeepFilterNet** — Open source, self-hostable, excellent quality
2. **Resemble AI Enhance** — Commercial API, very high quality
3. **Adobe Podcast Enhance API** — If available, studio quality

```javascript
// ML Denoiser service interface
async function mlDenoise(audioBuffer, options = {}) {
  const {
    provider = 'deepfilternet', // or 'resemble', 'adobe'
    aggressiveness = 'auto'     // 'light', 'medium', 'aggressive', 'auto'
  } = options;

  // Auto-select aggressiveness based on measured SNR
  if (aggressiveness === 'auto') {
    const snr = measureSNR(audioBuffer);
    if (snr < 10) aggressiveness = 'aggressive';
    else if (snr < 15) aggressiveness = 'medium';
    else aggressiveness = 'light';
  }

  return await mlDenoiserProviders[provider].process(audioBuffer, { aggressiveness });
}
```

### Strategy 3: Hybrid Pipeline

**Cost:** ~$0.01 per enrollment
**Latency:** Real-time on device + ~300ms server processing
**Quality:** Best overall

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS Device                               │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Raw Audio    │───▶│ Apple Voice  │───▶│ Upload to    │      │
│  │ from Mic     │    │ Processing   │    │ Server       │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                                    │
│                      Real-time noise                             │
│                      reduction + AGC                             │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Server                                   │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Receive      │───▶│ ML Denoiser  │───▶│ Quality      │      │
│  │ Pre-cleaned  │    │ (polish)     │    │ Assessment   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

**iOS Implementation:**
```swift
// Use AVAudioEngine with voice processing enabled
let inputNode = audioEngine.inputNode
let format = inputNode.outputFormat(forBus: 0)

// Enable Apple's voice processing (noise suppression + AGC)
try inputNode.setVoiceProcessingEnabled(true)

// This gives us pre-cleaned audio before upload
```

---

## 5. Sung Prompt Handling

### Detection
```javascript
function isSungPrompt(promptIndex, promptText) {
  // Sung prompts are explicitly marked in the prompt list
  return promptText.toLowerCase().includes('sing') ||
         SUNG_PROMPT_INDICES.includes(promptIndex);
}
```

### Threshold Relaxation
```javascript
const THRESHOLDS = {
  spoken: {
    minSnr: 12,        // dB
    maxClipping: 0.05, // 5%
    maxReverb: 0.6,
    minVadRatio: 0.15,
  },
  sung: {
    minSnr: 8,         // More forgiving - singing picks up more room
    maxClipping: 0.08, // Singing has wider dynamics
    maxReverb: 0.75,   // Reverb more acceptable in singing
    minVadRatio: 0.10, // Sustained notes may have pauses
  }
};
```

### Preprocessing Override
```javascript
function getPreprocessingOptions(isSung, measuredSnr) {
  if (isSung) {
    return {
      noiseReduction: measuredSnr < 12 ? 20 : 15,  // More aggressive
      highpassFreq: 60,    // Lower cutoff for singing (bass notes)
      compressorRatio: 4,  // More compression for dynamics
      targetLufs: -18,     // Slightly louder target
    };
  }
  return {
    noiseReduction: measuredSnr < 15 ? 15 : 10,
    highpassFreq: 80,
    compressorRatio: 3,
    targetLufs: -20,
  };
}
```

---

## 6. Admin Feature Flags

### Flag Definitions

```javascript
const VOICE_ENROLLMENT_FLAGS = {
  // Preprocessing strategy
  'voice_enrollment_preprocessing_strategy': {
    type: 'enum',
    values: ['ffmpeg', 'ml_server', 'hybrid'],
    default: 'ffmpeg',
    description: 'Which preprocessing pipeline to use for enrollment audio',
  },

  // ML provider (when strategy is ml_server or hybrid)
  'voice_enrollment_ml_provider': {
    type: 'enum',
    values: ['deepfilternet', 'resemble', 'adobe'],
    default: 'deepfilternet',
    description: 'Which ML denoiser to use',
  },

  // Quality thresholds
  'voice_enrollment_min_tier_for_conversion': {
    type: 'enum',
    values: ['minimal', 'basic', 'fair', 'good', 'excellent'],
    default: 'minimal',
    description: 'Minimum tier required to create voice profile (minimal = accept all)',
  },

  // Sung prompt handling
  'voice_enrollment_sung_threshold_relaxation': {
    type: 'boolean',
    default: true,
    description: 'Apply relaxed thresholds for sung prompts',
  },

  'voice_enrollment_sung_weight': {
    type: 'number',
    min: 0,
    max: 1,
    default: 0.6,
    description: 'Weight of sung prompts in overall quality score (0-1)',
  },

  // iOS features
  'voice_enrollment_ios_voice_processing': {
    type: 'boolean',
    default: true,
    description: 'Enable Apple Voice Processing on device before upload',
  },

  'voice_enrollment_ios_realtime_feedback': {
    type: 'boolean',
    default: true,
    description: 'Show real-time audio quality feedback during recording',
  },
};
```

### Admin Dashboard View

```
┌─────────────────────────────────────────────────────────────────┐
│  Voice Enrollment Configuration                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Preprocessing Strategy        [FFmpeg ▼]                       │
│  ├─ ML Provider (if ML/Hybrid) [DeepFilterNet ▼]               │
│                                                                  │
│  Quality Requirements                                            │
│  ├─ Minimum Tier for Profile   [Minimal (accept all) ▼]        │
│  ├─ Sung Prompt Relaxation     [✓ Enabled]                      │
│  ├─ Sung Prompt Weight         [0.6]                            │
│                                                                  │
│  iOS Features                                                    │
│  ├─ On-Device Voice Processing [✓ Enabled]                      │
│  ├─ Real-Time Feedback UI      [✓ Enabled]                      │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Enrollment Metrics (Last 7 Days)                               │
│  ├─ Total Enrollments: 1,234                                    │
│  ├─ Avg Quality Score: 67.3                                     │
│  ├─ Tier Distribution: ★★★ 23% | ★★ 45% | ★ 28% | ☆ 4%         │
│  ├─ Re-record Rate: 12%                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Database Schema Changes

```sql
-- Add quality tier columns to voice_profiles
ALTER TABLE voice_profiles ADD COLUMN quality_score INTEGER DEFAULT 0;
ALTER TABLE voice_profiles ADD COLUMN quality_tier TEXT DEFAULT 'basic';
ALTER TABLE voice_profiles ADD COLUMN quality_metrics_json TEXT;

-- Track per-chunk quality for improvement UI
ALTER TABLE enrollment_sessions ADD COLUMN chunk_quality_json TEXT;

-- Example chunk_quality_json structure:
-- {
--   "chunks": [
--     {"index": 0, "type": "spoken", "score": 75, "issues": []},
--     {"index": 1, "type": "spoken", "score": 68, "issues": ["moderate_noise"]},
--     {"index": 5, "type": "sung", "score": 52, "issues": ["high_reverb"], "weight": 0.6}
--   ],
--   "weighted_average": 67.2,
--   "preprocessing_strategy": "ffmpeg",
--   "ios_voice_processing": true
-- }

-- Feature flags table (if not exists)
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- Seed voice enrollment flags
INSERT OR REPLACE INTO feature_flags (id, value, description) VALUES
  ('voice_enrollment_preprocessing_strategy', '"ffmpeg"', 'Preprocessing pipeline: ffmpeg|ml_server|hybrid'),
  ('voice_enrollment_ml_provider', '"deepfilternet"', 'ML denoiser: deepfilternet|resemble|adobe'),
  ('voice_enrollment_min_tier_for_conversion', '"minimal"', 'Minimum quality tier to accept'),
  ('voice_enrollment_sung_threshold_relaxation', 'true', 'Relaxed thresholds for sung prompts'),
  ('voice_enrollment_sung_weight', '0.6', 'Sung prompt weight in scoring'),
  ('voice_enrollment_ios_voice_processing', 'true', 'On-device noise reduction'),
  ('voice_enrollment_ios_realtime_feedback', 'true', 'Real-time recording feedback UI');
```

---

## 8. API Changes

### Updated Enrollment Complete Response

```json
{
  "success": true,
  "voice_profile_id": "vp_abc123",
  "quality": {
    "tier": "good",
    "score": 72,
    "stars": 2,
    "disclosure": "Songs will sound like you with light AI enhancement",
    "can_improve": true,
    "improvement_tips": [
      "Re-record prompt 3 in a quieter environment",
      "Prompt 5 had some background noise"
    ]
  },
  "chunks": [
    {"index": 0, "type": "spoken", "quality": "excellent"},
    {"index": 1, "type": "spoken", "quality": "good"},
    {"index": 2, "type": "spoken", "quality": "good"},
    {"index": 3, "type": "spoken", "quality": "fair", "suggestion": "Background noise detected"},
    {"index": 4, "type": "spoken", "quality": "good"},
    {"index": 5, "type": "sung", "quality": "fair", "suggestion": "Reverb detected"}
  ]
}
```

### New Endpoint: Improve Voice Quality

```
POST /voice/profile/:id/improve
Content-Type: multipart/form-data

{
  "chunks": [
    { "index": 3, "audio": <binary> },
    { "index": 5, "audio": <binary> }
  ]
}

Response:
{
  "success": true,
  "quality": {
    "previous_tier": "good",
    "previous_score": 72,
    "new_tier": "excellent",
    "new_score": 85,
    "disclosure": "Songs will sound very close to your natural voice"
  }
}
```

---

## 9. Implementation Phases

### Phase 1: Backend Foundation (Week 1)
- [ ] Database schema changes (migrations)
- [ ] New quality scoring algorithm with tiers
- [ ] Feature flag infrastructure
- [ ] Enhanced FFmpeg pipeline
- [ ] API response changes
- [ ] Unit tests for all scoring/preprocessing

### Phase 2: iOS Recording UI (Week 2)
- [ ] Real-time audio analysis
- [ ] Audio level meter component
- [ ] Environment quality indicator
- [ ] Coaching tips system
- [ ] Per-prompt quality badges
- [ ] Completion screen with tier display
- [ ] "Improve Quality" flow

### Phase 3: ML Denoiser Integration (Week 3)
- [ ] DeepFilterNet integration (self-hosted or API)
- [ ] Fallback to FFmpeg on failure
- [ ] A/B test infrastructure
- [ ] Cost tracking

### Phase 4: Hybrid Pipeline (Week 4)
- [ ] iOS Voice Processing integration
- [ ] Server-side polish step
- [ ] End-to-end testing
- [ ] Performance optimization

### Phase 5: Admin & Monitoring (Week 5)
- [ ] Admin dashboard UI for flags
- [ ] Quality metrics dashboard
- [ ] Alerting on quality degradation
- [ ] A/B test result analysis

---

## 10. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Enrollment completion rate | ~60% (estimated) | >90% |
| Average quality score | Unknown | >65 |
| Excellent/Good tier rate | Unknown | >60% |
| Re-record rate | High | <15% |
| User-initiated improvement rate | N/A | >20% |
| Voice conversion satisfaction | Unknown | >4.0/5.0 |

---

## Appendix: Error Code Updates

| Code | Old Behavior | New Behavior |
|------|--------------|--------------|
| E101_AUDIO_TOO_NOISY | Hard reject | Downgrades tier, provides tip |
| E102_AUDIO_CLIPPED | Hard reject | Downgrades tier, provides tip |
| E103_NO_AUDIO_DETECTED | Hard reject | Still rejects (truly unusable) |
| E104_SESSION_NOT_FOUND | Hard reject | Still rejects (no data) |
| E105_INSUFFICIENT_DURATION | Hard reject | Downgrades tier, prompts for more |

Only E103 (silence/corrupt) and E104 (no files) remain as actual failures.
