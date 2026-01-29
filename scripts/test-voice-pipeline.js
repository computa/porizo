#!/usr/bin/env node
/**
 * Test the full voice conversion pipeline:
 * findReferenceAudio() → convertVoice() (personalized mode)
 *
 * This validates that enrollment is properly wired to voice conversion.
 */

const path = require("path");
const fs = require("fs");

// Mock database for testing
const mockDb = {
  prepare: (sql) => ({
    get: async (userId) => {
      // Simulate an active voice profile
      if (sql.includes("voice_profiles") && sql.includes("status = 'active'")) {
        console.log(`[MockDB] Checking voice profile for user: ${userId}`);
        return { id: "mock-profile-id", user_id: userId, status: "active" };
      }
      return null;
    }
  })
};

async function main() {
  const storageDir = path.resolve(__dirname, "..", "storage");

  // Test user with good enrollment data
  const userId = "ios_706fe628-e79";

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("        Voice Pipeline Integration Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Step 1: Test findReferenceAudio
  console.log("[Step 1] Testing findReferenceAudio()...\n");

  const { findReferenceAudio } = require("../src/providers/voice");

  const referenceResult = await findReferenceAudio({
    storageDir,
    userId,
    preferSinging: true,
  });

  if (!referenceResult) {
    console.error("✗ findReferenceAudio returned null - no enrollment found");
    process.exit(1);
  }

  console.log("  ✓ Found reference audio:");
  console.log(`    Path:  ${referenceResult.path}`);
  console.log(`    Grade: ${referenceResult.grade}`);
  console.log(`    Score: ${referenceResult.score}`);

  // Step 2: Test convertVoice with personalized mode
  console.log("\n[Step 2] Testing convertVoice() in personalized mode...\n");

  const { convertVoice } = require("../src/providers/voice");

  // Find a guide vocal to convert
  const guideVocalPath = path.join(
    storageDir,
    "tracks",
    "ios_9a50158f-7b2",
    "4099232d-9317-4140-ad97-fb74aae0621e",
    "v1",
    "guide_vocal.wav"
  );

  if (!fs.existsSync(guideVocalPath)) {
    console.error(`✗ Guide vocal not found: ${guideVocalPath}`);
    process.exit(1);
  }

  console.log(`  Guide vocal: ${guideVocalPath}`);

  // Create test track/version objects
  const testTrack = {
    id: "test-track-" + Date.now(),
    user_id: userId,
    voice_mode: "user_voice", // Triggers personalized mode
  };

  const testTrackVersion = {
    version_num: 1,
  };

  // Create output directory
  const versionDir = path.join(
    storageDir,
    "tracks",
    testTrack.user_id,
    testTrack.id,
    `v${testTrackVersion.version_num}`
  );
  fs.mkdirSync(versionDir, { recursive: true });

  // Copy guide vocal to version directory (convertVoice expects it there)
  const guideDestPath = path.join(versionDir, "guide_vocal.wav");
  fs.copyFileSync(guideVocalPath, guideDestPath);
  console.log(`  Copied guide vocal to: ${guideDestPath}`);

  try {
    console.log("\n  Starting voice conversion (this may take 1-3 minutes)...\n");
    const startTime = Date.now();

    const result = await convertVoice({
      storageDir,
      track: testTrack,
      trackVersion: testTrackVersion,
      kind: "preview",
      providerConfig: {
        replicate: { live: false }, // Use Seed-VC, not Replicate RVC
      },
      inputUrl: null, // Use local file
      seedvcConfig: {
        timeoutMs: 300000,
        replicateToken: process.env.REPLICATE_API_TOKEN || null,
        params: {
          diffusionSteps: 25,
          cfgRate: 0.7,
        },
      },
      db: mockDb, // Pass mock database
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  ✓ Voice conversion completed in ${elapsed}s`);
    console.log(`    Output file: ${result.file}`);
    if (result.output_path) {
      console.log(`    Full path: ${result.output_path}`);
      const stats = fs.statSync(result.output_path);
      console.log(`    File size: ${(stats.size / 1024).toFixed(1)} KB`);
    }
    if (result.instrumental_path) {
      console.log(`    Instrumental: ${result.instrumental_path}`);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("                    SUCCESS!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("\nVoice enrollment is properly wired to voice conversion.");
    console.log("\nPlay the results:");
    console.log(`  Reference voice: afplay "${referenceResult.path}"`);
    console.log(`  Source audio:    afplay "${guideVocalPath}"`);
    if (result.output_path) {
      console.log(`  Converted:       afplay "${result.output_path}"`);
    }
    console.log("");

  } catch (error) {
    console.error(`\n  ✗ Voice conversion failed: ${error.message}`);

    if (error.message.includes("E302_VOICE_ERROR")) {
      console.error("\n  This error indicates a problem in the voice conversion pipeline.");
    }

    // Clean up test directory
    fs.rmSync(versionDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
