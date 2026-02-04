# Voice Conversion Technology Research

> **Last Updated:** January 2026
> **Purpose:** Technical reference for voice conversion in AI music generation

---

## Table of Contents

1. [Overview: How AI Cover Apps Work](#overview-how-ai-cover-apps-work)
2. [Voice Conversion vs Voice Cloning](#voice-conversion-vs-voice-cloning)
3. [RVC Architecture Deep Dive](#rvc-architecture-deep-dive)
4. [Seed-VC Architecture](#seed-vc-architecture)
5. [Kits AI (Commercial Solution)](#kits-ai-commercial-solution)
6. [Core Technologies Explained](#core-technologies-explained)
7. [Porizo's Current Implementation](#porizos-current-implementation)
8. [Technology Comparison](#technology-comparison)
9. [Upgrade Recommendations](#upgrade-recommendations)
10. [References](#references)

---

## Overview: How AI Cover Apps Work

Apps like Mozart AI, Kits AI, and similar platforms use **voice conversion + singing voice synthesis** on top of modern generative models. They turn a short voice sample into a reusable "voice profile" and then drive it with a separate singing model to generate covers.

### Step-by-Step Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  1. VOICE CAPTURE & CLEANUP                                     │
│     User records speech/humming → Noise reduction → Normalize   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. SPEAKER EMBEDDING EXTRACTION                                │
│     Neural network (ECAPA-TDNN) → Speaker embedding vector      │
│     Captures timbre & characteristics, not words                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. LYRICS + MELODY PROCESSING                                  │
│     Source song → Phoneme alignment → Timing extraction         │
│     Or: MIDI/sheet music → Phoneme-level control                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. SINGING VOICE SYNTHESIS/CONVERSION                          │
│     Option A: Voice Conversion (SVC)                            │
│       Source vocal + User embedding → Convert timbre            │
│     Option B: Neural Singing TTS                                │
│       Phonemes + F0 + Embedding → Synthesize from scratch       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  5. POST-PROCESSING & MIXING                                    │
│     De-noising → EQ → Compression → Reverb → Mix with backing   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  6. EXPORT                                                      │
│     Final audio encoded (AAC/MP3/Opus)                          │
│     Embedding cached for future "instant" generation            │
└─────────────────────────────────────────────────────────────────┘
```

### Two Main Synthesis Patterns

#### Pattern A: Singing Voice Conversion (SVC)
- Start from a reference vocal (source singer or synthetic)
- Diffusion-based or VITS-style network converts the vocal
- **Preserves:** pitch, rhythm, expression from source
- **Replaces:** timbre with user's voice embedding

#### Pattern B: Neural Singing Text-to-Speech
- Directly synthesizes singing from phonemes + F0 curve + embedding
- No source vocal needed
- Similar to TTS but with musical controls (pitch, duration, vibrato)

---

## Voice Conversion vs Voice Cloning

**This is the critical distinction for quality.**

| Aspect | Voice Cloning (TTS) | Voice Conversion (SVC) |
|--------|---------------------|------------------------|
| **Input** | Text → Generate speech | Existing audio → Transform |
| **Output** | New speech from scratch | Same performance, new voice |
| **What it preserves** | Nothing (generates new) | Melody, timing, emotion |
| **What it changes** | Everything | Only timbre/voice character |
| **For singing** | Struggles with expression | Works well |
| **Training** | Need lots of data | Can work zero-shot |

### Why Voice Cloning Fails for Music

Voice cloning tries to answer: *"How would this person sing this new thing?"*

This is extremely hard because:
- Singing requires precise pitch control
- Expression/emotion is hard to synthesize
- Timing/rhythm needs to match music exactly

### Why Voice Conversion Works

Voice conversion answers: *"How would this person's voice sound singing exactly like this reference?"*

Much easier because:
- Performance already exists (pitch, timing, emotion)
- Only changing the timbre/vocal characteristics
- Can use zero-shot with speaker embeddings

---

## RVC Architecture Deep Dive

**RVC (Retrieval-based Voice Conversion)** is the most popular open-source singing voice conversion system.

### Core Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    RVC INFERENCE PIPELINE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Source Audio                                                    │
│       ↓                                                          │
│  ┌─────────────────┐     ┌─────────────────┐                    │
│  │ HuBERT/ContentVec│     │   RMVPE         │                    │
│  │ (Content Extract)│     │ (Pitch Extract) │                    │
│  └────────┬────────┘     └────────┬────────┘                    │
│           ↓                       ↓                              │
│  ┌─────────────────────────────────────────┐                    │
│  │         FAISS Retrieval Module           │                    │
│  │  (Search target speaker features)        │                    │
│  │  Top-8 nearest → Blend with α=0.3        │                    │
│  └────────────────────┬────────────────────┘                    │
│                       ↓                                          │
│  ┌─────────────────────────────────────────┐                    │
│  │       VITS Acoustic Model                │                    │
│  │  (Conditional VAE + Normalizing Flows)   │                    │
│  └────────────────────┬────────────────────┘                    │
│                       ↓                                          │
│  ┌─────────────────────────────────────────┐                    │
│  │       NSF-HiFiGAN Vocoder                │                    │
│  │  (Spectrogram → Waveform)                │                    │
│  └────────────────────┬────────────────────┘                    │
│                       ↓                                          │
│  Output Audio (User's Voice)                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Content Feature Extractor (HuBERT/ContentVec)

- Based on self-supervised learning (like BERT for audio)
- Extracts **speaker-invariant** content information
- ContentVec improves upon HuBERT with speaker augmentation:
  - During training, audio randomly converted to other speakers
  - Contrastive loss enforces timbre invariance

#### 2. Pitch Extractor (RMVPE)

- Robust Multi-resolution Phase Estimation
- Extracts fundamental frequency (F0) even from polyphonic audio
- Critical for singing: preserves exact melody contour
- Discretized into "F0 tokens" for model input

#### 3. Retrieval Module (FAISS)

**This is RVC's key innovation.**

- During training: stores all ContentVec features for target speaker
- During inference:
  1. Extract source audio features
  2. Search FAISS index for top-8 most similar vectors
  3. Blend source + retrieved features with interpolation (α)
- **Purpose:** Reduces "timbre leakage" from source speaker
- Uses IVF (Inverted File Index) for fast approximate search

#### 4. Acoustic Model (VITS-based)

- Conditional Variational Autoencoder (CVAE)
- Augmented with normalizing flows for expressiveness
- Adversarial training for realistic output
- Takes: content features + pitch + speaker info
- Outputs: mel-spectrogram

#### 5. Vocoder (NSF-HiFiGAN)

- Neural Source Filter + HiFi-GAN architecture
- Harmonic + noise source module for excitation
- Neural filter module for final waveform
- High-quality audio at 44.1kHz

### Training Requirements

| Parameter | Recommended |
|-----------|-------------|
| **Audio Duration** | 5-10 minutes minimum |
| **Audio Quality** | Clean, no reverb/delay, no background music |
| **Sample Rate** | 44.1kHz or 48kHz |
| **Epochs** | 50-200 depending on audio quality |
| **GPU** | ~30 minutes on modern GPU |

### Key Parameters at Inference

| Parameter | Default | Effect |
|-----------|---------|--------|
| `index_rate` (α) | 0.3-0.5 | How much to blend retrieved features |
| `filter_radius` | 3 | Smoothing filter size |
| `rms_mix_rate` | 0.25 | Volume envelope mixing |
| `protect` | 0.33 | Protect voiceless consonants |

---

## Seed-VC Architecture

**Seed-VC** is a zero-shot voice conversion system using diffusion transformers.

### Key Differences from RVC

| Aspect | RVC | Seed-VC |
|--------|-----|---------|
| **Training** | Per-user model required | Zero-shot (no training) |
| **Reference Audio** | Full training dataset | Single reference (14s-6min) |
| **Architecture** | VITS + FAISS retrieval | Diffusion Transformer |
| **Speaker Similarity** | 0.7264 | 0.7405 (better) |
| **Audio Quality** | Better (DNSMOS) | Slightly lower |

### Architecture

```
Source Audio + Reference Audio
         ↓              ↓
    ┌────────────┐  ┌────────────┐
    │ Content    │  │ Speaker    │
    │ Encoder    │  │ Encoder    │
    └─────┬──────┘  └─────┬──────┘
          ↓              ↓
    ┌─────────────────────────────┐
    │   Diffusion Transformer      │
    │   (Iterative denoising)      │
    │   Steps: 25-100              │
    └─────────────┬───────────────┘
                  ↓
    ┌─────────────────────────────┐
    │      Neural Vocoder          │
    └─────────────┬───────────────┘
                  ↓
         Output Audio
```

### Key Parameters

| Parameter | Range | Effect |
|-----------|-------|--------|
| `diffusionSteps` | 4-100 | Quality vs speed (higher = better, slower) |
| `cfgRate` | 0.0-1.0 | Classifier-free guidance (timbre balance) |
| `f0_condition` | boolean | Enable pitch conditioning (always true for singing) |
| `auto_f0_adjust` | boolean | Automatic pitch adjustment |
| `pitch_shift` | -12 to +12 | Semitone shift |

### Benchmarks (from Seed-VC paper)

| Metric | Seed-VC | RVC v2 |
|--------|---------|--------|
| **Speaker Similarity (SECS)** | 0.7405 ✓ | 0.7264 |
| **F0 Correlation** | 0.94 | 0.94 |
| **Character Error Rate** | Lower ✓ | Higher |
| **DNSMOS (Quality)** | Slightly lower | Better |

---

## Kits AI (Commercial Solution)

**Kits Voice Conversion (KVC)** is Kits AI's proprietary system.

### Key Innovations

1. **Adaptive Content Feature Retrieval**
   - Applies retrieval strength adaptively
   - More aligned features → more target speaker influence
   - Claims higher speaker similarity than standard RVC

2. **Kits Hybrid Pitch**
   - Custom F0 detection algorithm
   - Outperforms Crepe, RMVPE, Mangio-Crepe
   - Better pitch accuracy for singing

3. **Adaptive Pre-Processing**
   - Addresses volume artifacts common in open-source RVC
   - Balances volume and frequency response
   - Smoother, lower-distortion conversions

4. **Professional Training Dataset**
   - Hand-processed recordings from compensated vocalists
   - Higher quality base weights

### API Availability

- Voice conversion, stem separation, voice training endpoints
- Beta access: contact outreach@kits.ai
- Pricing: Starts at $9.99/month

---

## Core Technologies Explained

### Neural Vocoders

Transform mel-spectrograms into raw waveform audio.

| Vocoder | Quality | Speed | Common Use |
|---------|---------|-------|------------|
| HiFi-GAN | High | Fast | RVC, Seed-VC |
| WaveRNN | High | Slow | Research |
| NSF-HiFiGAN | Highest | Medium | RVC (singing) |

### Speaker Embedding Models

Extract voice characteristics into fixed-size vectors.

| Model | Dimensions | Use Case |
|-------|------------|----------|
| ECAPA-TDNN | 192-512 | Speaker verification |
| Resemblyzer | 256 | Voice similarity |
| WavLM | 768-1024 | General audio |

### Stem Separation

Isolate vocals from mixed audio (required for SVC on songs).

| Tool | Model | Quality |
|------|-------|---------|
| Demucs | Hybrid Transformer | Best |
| LALAL.AI | Proprietary | Very Good |
| Spleeter | U-Net | Good |

### Phoneme Alignment

Map text to audio timing for precise synthesis.

| Tool | Type | Use |
|------|------|-----|
| Montreal Forced Aligner | HMM-based | Research |
| Wav2Vec2 | End-to-end | Modern apps |
| Whisper | End-to-end | Transcription first |

---

## Porizo's Current Implementation

### Architecture

```
Guide Vocal (Suno/TTS)
    ↓
Stem Separation (Demucs via Replicate)
    ↓
Voice Conversion (Seed-VC via HuggingFace Space)
    ↓
Mix with Instrumental (FFmpeg)
    ↓
Watermark + Encode (M4A)
```

### Key Files

| File | Purpose |
|------|---------|
| `/src/providers/voice.js` | Voice conversion router |
| `/src/providers/seedvc.js` | Seed-VC integration |
| `/src/providers/demucs.js` | Stem separation |
| `/src/providers/replicate.js` | RVC + embeddings (AI voice mode) |

### Current Parameters

```javascript
// Preview render
{
  diffusionSteps: 50,
  cfgRate: 0.7,
  f0_condition: true,
  auto_f0_adjust: true,
  pitch_shift: 0
}

// Full render
{
  diffusionSteps: 100,
  cfgRate: 0.7,
  f0_condition: true,
  auto_f0_adjust: true,
  pitch_shift: 0
}
```

### Enrollment Flow

1. User records 6-10 phrases (~2 min)
2. Quality checks (SNR ≥15dB, clipping <5%)
3. Audio stored: `storage/enrollment/raw/{user_id}/{session_id}/`
4. Voice profile created with `status='active'`
5. At conversion: most recent sung sample used as reference

---

## Technology Comparison

### Quality Metrics

| Metric | Seed-VC | RVC | Kits AI |
|--------|---------|-----|---------|
| Speaker Similarity (SECS) | 0.7405 | 0.7264 | Claims higher |
| F0 Correlation | 0.94 | 0.94 | "Better" |
| DNSMOS (Quality) | Lower | Higher | Improved |
| Character Error Rate | Lower | Higher | - |

### Operational Comparison

| Aspect | Seed-VC | RVC | Kits AI |
|--------|---------|-----|---------|
| Training Required | None | 5-10 min audio | 30s-30min |
| GPU Required | For speed | Yes | No (API) |
| Self-hosting | Possible | Possible | No |
| Cost (1000 renders) | ~$50-150 | ~$50-150 | TBD |

### Recommendation Matrix

| Use Case | Best Choice |
|----------|-------------|
| Quick MVP | Seed-VC (current) |
| Maximum quality | RVC (trained models) |
| Simple integration | Kits AI (API) |
| Cost optimization | Self-hosted Seed-VC |

---

## Upgrade Recommendations

### Phase 1: Optimize Current Setup (Quick Wins)

1. **Increase diffusion steps**
   - Change: `diffusionSteps: 100` → `150-200` for full renders
   - Impact: Better quality, ~2x slower

2. **Improve reference audio selection**
   - Prioritize sung samples over spoken
   - Use longer references (30s+ when available)
   - File: `/src/providers/voice.js`

3. **Self-host Seed-VC**
   - Deploy on dedicated GPU (A10/A100)
   - Eliminates HuggingFace Space queue issues

### Phase 2: Add RVC for Premium Tier

1. **Extended enrollment flow**
   - 5-10 minute recording session
   - Train RVC model (~30 min background job)
   - Store model weights in S3

2. **Implementation**
   - New provider: `/src/providers/rvc.js`
   - New field: `voice_profiles.rvc_model_ref`
   - Route based on model availability

### Phase 3: Evaluate Commercial Options

1. **Kits AI API**
   - Request beta access
   - A/B test quality vs current
   - Consider if quality justifies cost

---

## References

### Research Papers
- [Zero-shot Voice Conversion with Diffusion Transformers (Seed-VC)](https://arxiv.org/html/2411.09943v1)
- [Annotated RVC](https://gudgud96.github.io/2024/09/26/annotated-rvc/)
- [ContentVec Paper](https://arxiv.org/abs/2204.09224)

### Code Repositories
- [Seed-VC GitHub](https://github.com/Plachtaa/seed-vc)
- [RVC WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
- [Demucs](https://github.com/facebookresearch/demucs)

### Commercial Services
- [Kits AI](https://www.kits.ai/)
- [Kits Voice Conversion Research](https://www.kits.ai/research/kits-voice-conversion-kvc)

### Tools
- [LALAL.AI](https://www.lalal.ai/) - Stem separation
- [Replicate](https://replicate.com/) - API hosting for models

---

## Alternative Technologies for Voice-to-Singing

Several technology families can transform a normal speaking voice into singing:

### 1. Singing Voice Conversion (SVC) Tools

Research and open-source systems (RVC, So-VITS-SVC) take any sung (or sometimes spoken) input and convert it to a target singer's timbre.

**Workflow:**
1. Feed in your speaking voice
2. Let the model infer pitch
3. Refine or correct with pitch-correction tools

### 2. Neural Singing TTS (Text-to-Singing)

Systems that accept lyrics + sheet music/MIDI and a voice embedding, then synthesize singing with no human performance.

**Key characteristics:**
- Similar to LLM-TTS stacks but with musical controls
- Controls: pitch, duration, loudness, vibrato
- Example: DiffSinger, VISinger

### 3. Classical Pitch Correction + Formant Shifting

Tools like Auto-Tune, Melodyne, or DAW plugins can take spoken or poorly sung audio and:
- Extract pitch
- Snap it to a scale
- Adjust formants to keep it sounding natural as notes change

**Limitations:** Older tech, less powerful than neural synthesis, but can make a speaking voice "sing" when combined with note automation.

### 4. Voice Cloning + Multi-Speaker TTS

Multi-speaker TTS systems (often diffusion-based) can clone a voice from a short sample then read anything with that cloned voice.

**For singing:**
- Combine with a singing front-end (melody + phonemes)
- Effectively become singing voice generators using that cloned voice

### 5. End-to-End Music Generation with Voice

Research models generate entire songs (backing + vocals) from text prompts and optional voice references.
- Voice embedding conditions just the vocal
- Model generates the rest of the arrangement
- Example: Suno, Udio (with voice conditioning)

---

## Audio Preprocessing Best Practices

### Noise Suppression Comparison

| Tool | PESQ Score | STOI | Latency | Best For |
|------|------------|------|---------|----------|
| DeepFilterNet3 | 3.5-4.0+ | >0.95 | <20ms | Complex noise, real-time |
| RNNoise | Good | Good | <10ms | Simple noise, low latency |
| Spectral Gate | Variable | Variable | <5ms | Stationary noise |

### DeepFilterNet3 Advantages
- Handles non-stationary noise (crowds, traffic, AC)
- Fewer artifacts than RNNoise
- Better speech quality preservation
- CPU-efficient for mobile/embedded

### Preprocessing Pipeline for Voice Conversion

```
Raw Recording
    ↓
[Noise Detection] Measure SNR
    ↓
[Conditional Denoise] If SNR < 20dB → DeepFilterNet3
    ↓
[RMS Normalization] Target -20 LUFS
    ↓
[VAD Trim] Remove silence
    ↓
[Quality Assessment] Score A/B/C/F
    ↓
Store with metadata
```

### Reference Audio Quality Checklist

| Factor | Good | Acceptable | Poor |
|--------|------|------------|------|
| SNR | >25dB | 15-25dB | <15dB |
| Clipping | <1% | 1-5% | >5% |
| Reverb | Dry | Light | Echoey |
| Duration | >30s | 10-30s | <10s |
| Content | Singing | Mixed | Speech only |

---

## Quality Metrics for Voice Conversion

### Objective Metrics

| Metric | What it Measures | Range | Target |
|--------|------------------|-------|--------|
| **PESQ** | Perceptual speech quality | -0.5 to 4.5 | ≥3.5 |
| **STOI** | Speech intelligibility | 0 to 1 | ≥0.90 |
| **SECS** | Speaker similarity | 0 to 1 | ≥0.75 |
| **F0 Correlation** | Pitch accuracy | 0 to 1 | ≥0.90 |
| **CER** | Lyric intelligibility | 0 to 1 | ≤0.10 |

### How to Measure

```python
# Using speechmetrics library
from speechmetrics import relative, absolute

# PESQ (requires reference)
pesq_score = relative.PESQ(reference_audio, converted_audio)

# STOI (requires reference)
stoi_score = relative.STOI(reference_audio, converted_audio)

# Speaker similarity (requires embedding model)
from resemblyzer import VoiceEncoder
encoder = VoiceEncoder()
ref_embed = encoder.embed_utterance(reference_audio)
conv_embed = encoder.embed_utterance(converted_audio)
secs = np.dot(ref_embed, conv_embed)
```

### Subjective Evaluation

| Question | Scale | Target |
|----------|-------|--------|
| "Does this sound like you?" | 1-5 | ≥4.0 |
| "Is the singing natural?" | 1-5 | ≥3.5 |
| "Would you share this?" | 1-5 | ≥3.5 |

---

## Glossary

| Term | Definition |
|------|------------|
| **SVC** | Singing Voice Conversion - transforming existing vocals to new voice |
| **TTS** | Text-to-Speech - generating speech from text |
| **F0** | Fundamental frequency (pitch) |
| **SECS** | Speaker Embedding Cosine Similarity |
| **DNSMOS** | Deep Noise Suppression Mean Opinion Score |
| **CER** | Character Error Rate (lyric intelligibility) |
| **FAISS** | Facebook AI Similarity Search (vector database) |
| **HuBERT** | Hidden Unit BERT - self-supervised audio model |
| **ContentVec** | Speaker-invariant version of HuBERT |
| **VITS** | Variational Inference TTS - generative model |
| **RMVPE** | Robust Multi-resolution Phase Estimation (pitch detection) |
| **CFG** | Classifier-Free Guidance - controls generation strength |
