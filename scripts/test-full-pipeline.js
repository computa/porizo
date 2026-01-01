#!/usr/bin/env node
/**
 * Full Pipeline Test: Suno Music Generation → Replicate Voice Conversion
 *
 * This tests the complete song generation flow:
 * 1. Generate music with vocals using Suno API
 * 2. Convert vocals using Replicate RVC (with pre-built voice model)
 *
 * Run: node scripts/test-full-pipeline.js
 */
require("dotenv/config");

const fs = require("fs");
const path = require("path");

// Environment variables
const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION;

// Test configuration
const TEST_LYRICS = `[Verse]
Happy birthday to you
Happy birthday dear friend
May your day be so bright
With joy that won't end

[Chorus]
Celebrate, celebrate
It's your special day
Celebrate, celebrate
Hip hip hooray`;

const TEST_STYLE = "upbeat pop, cheerful, acoustic guitar, female vocals";
const TEST_TITLE = "Birthday Song Pipeline Test";

// Pre-built RVC voice model to use for testing
const TEST_RVC_MODEL = "Squidward";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Step 1: Generate music with Suno
 */
async function generateMusicWithSuno() {
  console.log("\n=== STEP 1: Generate Music with Suno ===\n");

  const payload = {
    customMode: true,
    instrumental: false, // We want vocals for voice conversion
    model: "V4",
    prompt: TEST_LYRICS,
    style: TEST_STYLE,
    title: TEST_TITLE,
    callBackUrl: "https://httpbin.org/post",
  };

  console.log("Submitting generation request...");
  console.log(`  Title: ${TEST_TITLE}`);
  console.log(`  Style: ${TEST_STYLE}`);

  const submitRes = await fetch(`${SUNO_BASE_URL}/api/v1/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUNO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const submitData = await submitRes.json();

  if (submitData.code !== 200) {
    throw new Error(`Suno submit failed: ${submitData.msg || JSON.stringify(submitData)}`);
  }

  const taskId = submitData.data?.taskId || submitData.data?.task_id;
  if (!taskId) {
    throw new Error("No task ID returned from Suno");
  }

  console.log(`  Task ID: ${taskId}`);
  console.log("\nPolling for completion (this may take 1-2 minutes)...");

  // Poll for completion
  const maxPolls = 30; // 2.5 minutes max
  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);

    const statusRes = await fetch(
      `${SUNO_BASE_URL}/api/v1/generate/record-info?taskId=${taskId}`,
      {
        headers: { Authorization: `Bearer ${SUNO_API_KEY}` },
      }
    );
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    process.stdout.write(`  Poll ${i + 1}/${maxPolls}: ${status}\r`);

    if (status === "SUCCESS") {
      console.log(`\n  ✅ Suno generation completed!`);

      const sunoData = statusData.data?.response?.sunoData;
      if (!sunoData || sunoData.length === 0) {
        throw new Error("No audio data in Suno response");
      }

      // Get the first track's audio URL
      const firstTrack = sunoData[0];
      const audioUrl = firstTrack.sourceAudioUrl || firstTrack.audioUrl;

      console.log(`  Duration: ${firstTrack.duration}s`);
      console.log(`  Audio URL: ${audioUrl}`);

      return {
        taskId,
        audioUrl,
        duration: firstTrack.duration,
        title: firstTrack.title,
      };
    }

    if (status === "FAILED" || status === "ERROR") {
      throw new Error(`Suno generation failed: ${statusData.data?.errorMessage || "Unknown"}`);
    }
  }

  throw new Error("Suno generation timed out");
}

/**
 * Step 2: Convert voice using Replicate RVC
 */
async function convertVoiceWithReplicate(audioUrl) {
  console.log("\n=== STEP 2: Convert Voice with Replicate RVC ===\n");

  console.log(`  Input audio: ${audioUrl}`);
  console.log(`  RVC Model: ${TEST_RVC_MODEL}`);
  console.log(`  Model Version: ${REPLICATE_MODEL_VERSION?.slice(0, 12)}...`);

  const predictionRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input: {
        song_input: audioUrl,
        rvc_model: TEST_RVC_MODEL,
        pitch_detection_algorithm: "rmvpe",
        index_rate: 0.5,
        filter_radius: 3,
        rms_mix_rate: 0.25,
        protect: 0.33,
        output_format: "mp3",
      },
    }),
  });

  const predictionData = await predictionRes.json();

  if (!predictionRes.ok) {
    throw new Error(`Replicate prediction failed: ${JSON.stringify(predictionData)}`);
  }

  const predictionId = predictionData.id;
  console.log(`  Prediction ID: ${predictionId}`);
  console.log("\nPolling for completion (this may take 2-3 minutes)...");

  // Poll for completion
  const maxPolls = 40; // ~3.5 minutes max
  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);

    const statusRes = await fetch(predictionData.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    const statusData = await statusRes.json();

    process.stdout.write(`  Poll ${i + 1}/${maxPolls}: ${statusData.status}\r`);

    if (statusData.status === "succeeded") {
      console.log(`\n  ✅ Voice conversion completed!`);
      console.log(`  Output URL: ${statusData.output}`);

      return {
        predictionId,
        outputUrl: statusData.output,
      };
    }

    if (statusData.status === "failed") {
      throw new Error(`Replicate conversion failed: ${statusData.error}`);
    }
  }

  throw new Error("Replicate conversion timed out");
}

/**
 * Step 3: Download the final audio
 */
async function downloadFinalAudio(outputUrl) {
  console.log("\n=== STEP 3: Download Final Audio ===\n");

  const outputDir = path.join(process.cwd(), "storage", "test-output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `pipeline-test-${timestamp}.mp3`;
  const filepath = path.join(outputDir, filename);

  console.log(`  Downloading to: ${filepath}`);

  const response = await fetch(outputUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  console.log(`  ✅ Saved ${buffer.length} bytes`);

  return filepath;
}

/**
 * Main test runner
 */
async function runFullPipelineTest() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     FULL PIPELINE TEST: Suno → Replicate RVC               ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  // Validate environment
  const missing = [];
  if (!SUNO_API_KEY) missing.push("SUNO_API_KEY");
  if (!REPLICATE_API_TOKEN) missing.push("REPLICATE_API_TOKEN");
  if (!REPLICATE_MODEL_VERSION) missing.push("REPLICATE_MODEL_VERSION");

  if (missing.length > 0) {
    console.error(`\n❌ Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("\nEnvironment:");
  console.log(`  Suno API: ${SUNO_BASE_URL}`);
  console.log(`  Suno Key: ${SUNO_API_KEY.slice(0, 8)}...`);
  console.log(`  Replicate Key: ${REPLICATE_API_TOKEN.slice(0, 8)}...`);

  const startTime = Date.now();

  try {
    // Step 1: Generate music with Suno
    const sunoResult = await generateMusicWithSuno();

    // Step 2: Convert voice with Replicate
    const replicateResult = await convertVoiceWithReplicate(sunoResult.audioUrl);

    // Step 3: Download final audio
    const finalPath = await downloadFinalAudio(replicateResult.outputUrl);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║     ✅ PIPELINE TEST SUCCESSFUL                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log(`\nTotal time: ${duration}s`);
    console.log(`\nResults:`);
    console.log(`  Suno Task ID: ${sunoResult.taskId}`);
    console.log(`  Original Audio: ${sunoResult.audioUrl}`);
    console.log(`  Converted Audio: ${replicateResult.outputUrl}`);
    console.log(`  Local File: ${finalPath}`);
    console.log(`\n🎵 Play the result: open "${finalPath}"`);

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n\n❌ Pipeline failed after ${duration}s`);
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
}

runFullPipelineTest();
