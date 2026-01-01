#!/usr/bin/env node
/**
 * Test script for Replicate API (voice conversion and embedding)
 * Run: node scripts/test-replicate-api.js
 */
require("dotenv/config");

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION;
const REPLICATE_EMBEDDING_MODEL_VERSION = process.env.REPLICATE_EMBEDDING_MODEL_VERSION;

async function testReplicateAPI() {
  console.log("=== Replicate API Test ===\n");

  if (!REPLICATE_API_TOKEN) {
    console.error("❌ REPLICATE_API_TOKEN not set in .env");
    process.exit(1);
  }

  console.log(`API Token: ${REPLICATE_API_TOKEN.slice(0, 8)}...${REPLICATE_API_TOKEN.slice(-4)}`);
  console.log(`RVC Model Version: ${REPLICATE_MODEL_VERSION || "(not set)"}`);
  console.log(`Embedding Model Version: ${REPLICATE_EMBEDDING_MODEL_VERSION || "(not set)"}\n`);

  // Step 1: Check account / list models
  console.log("1. Checking account status...");
  try {
    const accountRes = await fetch("https://api.replicate.com/v1/account", {
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      },
    });
    const accountData = await accountRes.json();
    console.log(`   Status: ${accountRes.status}`);
    if (accountRes.ok) {
      console.log(`   Username: ${accountData.username}`);
      console.log(`   ✅ Account valid\n`);
    } else {
      console.error(`   ❌ Account check failed:`, accountData);
      return;
    }
  } catch (err) {
    console.error(`   ❌ Account check error: ${err.message}\n`);
    return;
  }

  // Step 2: Test RVC model with a sample audio
  if (REPLICATE_MODEL_VERSION) {
    console.log("2. Testing RVC voice conversion model...");

    // Use one of our test Suno audio files
    const testAudioUrl = "https://cdn1.suno.ai/9e071d93-7c2c-4117-bd6f-5540cbcbc625.mp3";

    try {
      const predictionRes = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: REPLICATE_MODEL_VERSION,
          input: {
            song_input: testAudioUrl,
            // RVC parameters
            rvc_model: "Squidward",  // Default model
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
      console.log(`   Status: ${predictionRes.status}`);

      if (!predictionRes.ok) {
        console.error(`   ❌ RVC prediction failed:`, JSON.stringify(predictionData, null, 2));
        console.log("\n   Trying to list available RVC models...");
        // List some popular RVC models
        const searchRes = await fetch("https://api.replicate.com/v1/models?query=rvc", {
          headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
        });
        const searchData = await searchRes.json();
        if (searchData.results) {
          console.log("   Available RVC models:");
          for (const model of searchData.results.slice(0, 5)) {
            console.log(`     - ${model.owner}/${model.name}: ${model.description?.slice(0, 60)}...`);
          }
        }
      } else {
        console.log(`   Prediction ID: ${predictionData.id}`);
        console.log(`   Status: ${predictionData.status}`);
        console.log(`   ✅ RVC model accepted prediction\n`);

        // Poll for result (quick check)
        console.log("   Polling for result (max 30s)...");
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const statusRes = await fetch(predictionData.urls.get, {
            headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
          });
          const statusData = await statusRes.json();
          console.log(`   Poll ${i + 1}/6: ${statusData.status}`);

          if (statusData.status === "succeeded") {
            console.log(`   ✅ RVC conversion completed!`);
            console.log(`   Output: ${statusData.output}`);
            break;
          }
          if (statusData.status === "failed") {
            console.error(`   ❌ RVC conversion failed: ${statusData.error}`);
            break;
          }
        }
      }
    } catch (err) {
      console.error(`   ❌ RVC test error: ${err.message}`);
    }
  } else {
    console.log("2. Skipping RVC test - REPLICATE_MODEL_VERSION not set\n");
    console.log("   Looking for RVC models...");
    try {
      const searchRes = await fetch("https://api.replicate.com/v1/models?query=rvc%20voice", {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      const searchData = await searchRes.json();
      if (searchData.results) {
        console.log("   Available RVC models:");
        for (const model of searchData.results.slice(0, 5)) {
          console.log(`     - ${model.owner}/${model.name}`);
          // Get latest version
          const versionsRes = await fetch(`https://api.replicate.com/v1/models/${model.owner}/${model.name}/versions`, {
            headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
          });
          const versionsData = await versionsRes.json();
          if (versionsData.results?.[0]) {
            console.log(`       Latest version: ${versionsData.results[0].id}`);
          }
        }
      }
    } catch (err) {
      console.error(`   Model search error: ${err.message}`);
    }
  }

  // Step 3: Test embedding model
  if (REPLICATE_EMBEDDING_MODEL_VERSION) {
    console.log("\n3. Testing voice embedding model...");
    // Add embedding test here when needed
    console.log("   (Embedding model configured but test not implemented yet)");
  } else {
    console.log("\n3. Skipping embedding test - REPLICATE_EMBEDDING_MODEL_VERSION not set");
  }

  console.log("\n=== Test Complete ===");
}

testReplicateAPI().catch(console.error);
