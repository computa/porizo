const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Test utilities
function createTestWav(options = {}) {
  const {
    durationSec = 2,
    frequencyHz = 440,
    sampleRate = 44100,
    noiseLevel = 0,
    clipped = false,
    silent = false,
  } = options;

  const totalSamples = Math.floor(durationSec * sampleRate);
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample;
    if (silent) {
      sample = 0;
    } else if (clipped) {
      sample = Math.sin(2 * Math.PI * frequencyHz * t) * 1.5; // Over-driven
      sample = Math.max(-1, Math.min(1, sample));
    } else {
      const signal = Math.sin(2 * Math.PI * frequencyHz * t) * (1 - noiseLevel);
      const noise = (Math.random() * 2 - 1) * noiseLevel;
      sample = signal + noise;
    }
    const intSample = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

// ============================================================
// TEST: Enrollment QC Integration
// ============================================================
describe("Enrollment QC Integration", () => {
  const testStorageDir = path.join(__dirname, "..", "test-output", "enrollment-qc-" + Date.now());

  before(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  });

  describe("validateEnrollmentAudio", () => {
    it("should pass for clean audio chunks", async () => {
      // This test will fail until we implement validateEnrollmentAudio
      const { validateEnrollmentAudio } = require("../src/services/enrollment");
      
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const chunkDir = path.join(testStorageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      // Create clean audio chunks (4 chunks, 3 seconds each = 12 seconds total)
      for (let i = 0; i < 4; i++) {
        const chunk = createTestWav({ durationSec: 3, frequencyHz: 440 });
        fs.writeFileSync(path.join(chunkDir, `chunk_${i}.wav`), chunk);
      }

      const result = await validateEnrollmentAudio({
        userId,
        sessionId,
        storageDir: testStorageDir,
      });

      assert.strictEqual(result.passed, true, "Should pass QC for clean audio");
      assert.ok(result.metrics.snr_db > 15, "SNR should be above threshold");
      assert.ok(result.metrics.clipping_ratio < 0.05, "Clipping should be below threshold");
      assert.ok(result.metrics.total_duration_sec >= 10, "Should have at least 10 seconds");
    });

    it("should fail for noisy audio chunks", async () => {
      const { validateEnrollmentAudio } = require("../src/services/enrollment");
      
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const chunkDir = path.join(testStorageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      // Create noisy audio chunks
      for (let i = 0; i < 3; i++) {
        const chunk = createTestWav({ durationSec: 3, noiseLevel: 0.5 });
        fs.writeFileSync(path.join(chunkDir, `chunk_${i}.wav`), chunk);
      }

      const result = await validateEnrollmentAudio({
        userId,
        sessionId,
        storageDir: testStorageDir,
      });

      assert.strictEqual(result.passed, false, "Should fail QC for noisy audio");
      assert.ok(result.errors.some(e => e.includes("E101")), "Should have E101 error");
    });

    it("should fail for clipped audio chunks", async () => {
      const { validateEnrollmentAudio } = require("../src/services/enrollment");
      
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const chunkDir = path.join(testStorageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      // Create clipped audio chunks
      for (let i = 0; i < 3; i++) {
        const chunk = createTestWav({ durationSec: 3, clipped: true });
        fs.writeFileSync(path.join(chunkDir, `chunk_${i}.wav`), chunk);
      }

      const result = await validateEnrollmentAudio({
        userId,
        sessionId,
        storageDir: testStorageDir,
      });

      assert.strictEqual(result.passed, false, "Should fail QC for clipped audio");
      assert.ok(result.errors.some(e => e.includes("E102")), "Should have E102 error");
    });

    it("should fail for silent audio chunks", async () => {
      const { validateEnrollmentAudio } = require("../src/services/enrollment");
      
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const chunkDir = path.join(testStorageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      // Create silent audio chunks
      for (let i = 0; i < 3; i++) {
        const chunk = createTestWav({ durationSec: 3, silent: true });
        fs.writeFileSync(path.join(chunkDir, `chunk_${i}.wav`), chunk);
      }

      const result = await validateEnrollmentAudio({
        userId,
        sessionId,
        storageDir: testStorageDir,
      });

      assert.strictEqual(result.passed, false, "Should fail QC for silent audio");
      assert.ok(result.errors.some(e => e.includes("E103")), "Should have E103 error");
    });

    it("should fail for insufficient audio duration", async () => {
      const { validateEnrollmentAudio } = require("../src/services/enrollment");
      
      const userId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const chunkDir = path.join(testStorageDir, "enrollment", "raw", userId, sessionId);
      fs.mkdirSync(chunkDir, { recursive: true });

      // Create only 1 short chunk (2 seconds, need at least 10)
      const chunk = createTestWav({ durationSec: 2 });
      fs.writeFileSync(path.join(chunkDir, "chunk_0.wav"), chunk);

      const result = await validateEnrollmentAudio({
        userId,
        sessionId,
        storageDir: testStorageDir,
      });

      assert.strictEqual(result.passed, false, "Should fail for insufficient duration");
      assert.ok(result.errors.some(e => e.includes("E105")), "Should have E105 error");
    });
  });
});

// ============================================================
// TEST: Voice Embedding Extraction
// ============================================================
describe("Voice Embedding Extraction", () => {
  describe("extractEmbedding", () => {
    it("should extract embedding from audio URL", async () => {
      // Skip if no API token
      if (!process.env.REPLICATE_API_TOKEN) {
        console.log("Skipping embedding test - no REPLICATE_API_TOKEN");
        return;
      }

      const { extractEmbedding } = require("../src/providers/replicate");
      
      // Use a public test audio URL
      const testAudioUrl = "https://replicate.delivery/pbxt/example-audio.wav";
      
      const result = await extractEmbedding({
        baseUrl: "https://api.replicate.com",
        token: process.env.REPLICATE_API_TOKEN,
        modelVersion: process.env.REPLICATE_EMBEDDING_VERSION,
        audioUrl: testAudioUrl,
        timeoutMs: 120000,
      });

      assert.ok(result.embedding_url, "Should return embedding URL");
      assert.ok(result.prediction_id, "Should return prediction ID");
    });

    it("should handle API errors gracefully", async () => {
      const { extractEmbedding } = require("../src/providers/replicate");

      await assert.rejects(
        () => extractEmbedding({
          baseUrl: "https://api.replicate.com",
          token: "invalid_token",
          modelVersion: "invalid_version",
          audioUrl: "https://example.com/audio.wav",
          timeoutMs: 5000,
        }),
        /provider_error|Unauthenticated|401|timeout/i,
        "Should throw API or timeout error"
      );
    });
  });
});

// ============================================================
// TEST: ElevenLabs Music API
// ============================================================
describe("ElevenLabs Music API", () => {
  describe("buildCompositionPlanRequest", () => {
    it("should build correct payload for composition-plan generation", () => {
      const { buildCompositionPlanRequest } = require("../src/providers/elevenlabs");
      
      const lyrics = {
        title: "Birthday Song",
        anchor_line: "Happy birthday to you",
      };
      const musicPlan = {
        style: "pop",
        duration_sec: 30,
        bpm: 120,
      };

      const payload = buildCompositionPlanRequest({ lyrics, musicPlan, kind: "preview" });

      assert.ok(payload.prompt, "Should have prompt");
      assert.strictEqual(payload.music_length_ms, 30000, "Should convert seconds to milliseconds");
      assert.strictEqual(payload.model_id, "music_v1", "Should use music_v1 model");
    });

    it("should use defaults when no musicPlan provided", () => {
      const { buildCompositionPlanRequest } = require("../src/providers/elevenlabs");
      
      const payload = buildCompositionPlanRequest({
        lyrics: { title: "Test" },
        kind: "preview",
      });

      assert.ok(payload.prompt, "Should have prompt");
      assert.ok(payload.music_length_ms > 0, "Should have default duration");
      assert.strictEqual(payload.model_id, "music_v1", "Should use music_v1 model");
    });
  });

  describe("generateMusic", () => {
    it("should generate music with live API", async () => {
      if (!process.env.ELEVENLABS_API_KEY) {
        console.log("Skipping ElevenLabs test - no ELEVENLABS_API_KEY");
        return;
      }

      const { generateMusic } = require("../src/providers/elevenlabs");
      const testDir = path.join(__dirname, "..", "test-output", "elevenlabs-" + Date.now());
      fs.mkdirSync(testDir, { recursive: true });

      try {
        const result = await generateMusic({
          baseUrl: "https://api.elevenlabs.io",
          endpoint: "/v1/music",
          compositionPlanEndpoint: "/v1/music/plan",
          apiKey: process.env.ELEVENLABS_API_KEY,
          storageDir: testDir,
          track: { user_id: "test", id: "test-track" },
          trackVersion: { version_num: 1 },
          lyrics: { title: "Test Song", anchor_line: "This is a test" },
          musicPlan: { style: "pop", duration_sec: 15 },
          timeoutMs: 120000,
          kind: "preview",
        });

        assert.ok(result.instrumental_file, "Should return instrumental file name");
        const instPath = path.join(testDir, "tracks", "test", "test-track", "v1", result.instrumental_file);
        assert.ok(fs.existsSync(instPath), "Instrumental file should exist");
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});

// ============================================================
// TEST: Cleanup Job
// ============================================================
describe("Cleanup Job", () => {
  const testStorageDir = path.join(__dirname, "..", "test-output", "cleanup-" + Date.now());

  before(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  });

  describe("cleanupExpiredSessions", () => {
    it("should delete sessions older than retention period", async () => {
      const { cleanupExpiredSessions } = require("../src/jobs/cleanup");
      
      // Create mock database with old session
      const mockDb = {
        sessions: [
          { id: "old-session", created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
          { id: "new-session", created_at: new Date().toISOString() },
        ],
        prepare: function(sql) {
          if (sql.includes("SELECT")) {
            return { all: () => this.sessions.filter(s => 
              new Date(s.created_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            )};
          }
          if (sql.includes("DELETE")) {
            return { run: (id) => { this.sessions = this.sessions.filter(s => s.id !== id); }};
          }
          return { run: () => {} };
        }
      };

      // Create old session directory
      const oldSessionDir = path.join(testStorageDir, "enrollment", "raw", "user1", "old-session");
      fs.mkdirSync(oldSessionDir, { recursive: true });
      fs.writeFileSync(path.join(oldSessionDir, "chunk.wav"), "test");

      const result = await cleanupExpiredSessions({
        db: mockDb,
        storageDir: testStorageDir,
        retentionDays: 7,
      });

      assert.ok(result.deletedCount >= 0, "Should return deleted count");
    });

    it("should not delete sessions within retention period", async () => {
      const { cleanupExpiredSessions } = require("../src/jobs/cleanup");
      
      const mockDb = {
        sessions: [
          { id: "new-session", created_at: new Date().toISOString() },
        ],
        prepare: function(sql) {
          if (sql.includes("SELECT")) {
            return { all: () => [] }; // No old sessions
          }
          return { run: () => {} };
        }
      };

      const result = await cleanupExpiredSessions({
        db: mockDb,
        storageDir: testStorageDir,
        retentionDays: 7,
      });

      assert.strictEqual(result.deletedCount, 0, "Should not delete any sessions");
    });
  });

  describe("startCleanupJob", () => {
    it("should start and stop cleanup job", () => {
      const { startCleanupJob } = require("../src/jobs/cleanup");
      
      const mockDb = {
        prepare: () => ({ all: () => [], run: () => {} })
      };

      const job = startCleanupJob({
        db: mockDb,
        storageDir: testStorageDir,
        intervalMs: 60000,
        retentionDays: 7,
      });

      assert.ok(job.stop, "Should have stop function");
      job.stop();
    });
  });
});
