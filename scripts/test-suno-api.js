#!/usr/bin/env node
/**
 * Test script for Suno API integration
 * Run: node scripts/test-suno-api.js
 */
require("dotenv/config");

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";

async function testSunoAPI() {
  console.log("=== Suno API Test ===\n");

  if (!SUNO_API_KEY) {
    console.error("❌ SUNO_API_KEY not set in .env");
    process.exit(1);
  }

  console.log(`Base URL: ${SUNO_BASE_URL}`);
  console.log(`API Key: ${SUNO_API_KEY.slice(0, 8)}...${SUNO_API_KEY.slice(-4)}\n`);

  // Step 1: Check credits
  console.log("1. Checking credits...");
  try {
    const creditRes = await fetch(`${SUNO_BASE_URL}/api/v1/generate/credit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SUNO_API_KEY}`,
      },
    });
    const creditData = await creditRes.json();
    console.log(`   Status: ${creditRes.status}`);
    console.log(`   Response:`, JSON.stringify(creditData, null, 2));

    if (!creditRes.ok) {
      console.error(`   ❌ Credit check failed: ${creditData.message || creditData.error || 'Unknown error'}`);
    } else {
      console.log(`   ✅ Credits available\n`);
    }
  } catch (err) {
    console.error(`   ❌ Credit check error: ${err.message}\n`);
  }

  // Step 2: Generate a short test song
  console.log("2. Generating test music (this may take 30-60 seconds)...");
  try {
    const generateRes = await fetch(`${SUNO_BASE_URL}/api/v1/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUNO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customMode: true,
        instrumental: false,
        model: "V4",
        prompt: "[Verse]\nHappy birthday to you\nHappy birthday dear friend\nMay your day be so bright\nWith joy that won't end\n\n[Chorus]\nCelebrate, celebrate\nIt's your special day",
        style: "upbeat pop, cheerful, acoustic guitar",
        title: "Happy Birthday Test",
        // Use a dummy callback URL - we'll poll for status instead
        callBackUrl: "https://httpbin.org/post",
      }),
    });
    const generateData = await generateRes.json();
    console.log(`   Status: ${generateRes.status}`);
    console.log(`   Response:`, JSON.stringify(generateData, null, 2));

    if (!generateRes.ok) {
      console.error(`   ❌ Generation failed: ${generateData.message || generateData.error || 'Unknown error'}`);
      return;
    }

    const taskId = generateData.task_id || generateData.id || generateData.data?.taskId || generateData.data?.task_id;
    if (!taskId) {
      console.log(`   ⚠️ No task_id in response, might be synchronous API`);
      if (generateData.audio_url || generateData.data?.audio_url) {
        console.log(`   ✅ Audio URL received directly!`);
        console.log(`   URL: ${generateData.audio_url || generateData.data?.audio_url}`);
      }
      return;
    }

    console.log(`   Task ID: ${taskId}`);
    console.log(`   ✅ Generation started\n`);

    // Step 3: Poll for completion
    console.log("3. Polling for completion...");
    const maxPolls = 24; // 2 minutes max
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 5000)); // 5 second intervals

      const statusRes = await fetch(`${SUNO_BASE_URL}/api/v1/generate/record-info?taskId=${taskId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SUNO_API_KEY}`,
        },
      });
      const statusData = await statusRes.json();
      const status = statusData.status || statusData.data?.status || statusData.data?.[0]?.status;

      console.log(`   Poll ${i + 1}/${maxPolls}: status=${status}`);

      if (status === "completed" || status === "success" || status === "complete" || status === "SUCCESS") {
        console.log(`\n   ✅ Generation completed!`);
        console.log(`   Full response:`, JSON.stringify(statusData, null, 2));

        // Extract audio URLs from response
        const data = statusData.data;
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.audioUrl) console.log(`   🎵 Audio URL: ${item.audioUrl}`);
            if (item.sourceAudioUrl) console.log(`   🎵 Source Audio URL: ${item.sourceAudioUrl}`);
          }
        } else if (data?.audioUrl) {
          console.log(`   🎵 Audio URL: ${data.audioUrl}`);
        }
        return;
      }

      if (status === "failed" || status === "error" || status === "FAILED" || status === "ERROR") {
        console.error(`   ❌ Generation failed`);
        console.log(`   Response:`, JSON.stringify(statusData, null, 2));
        return;
      }
    }

    console.log(`   ⚠️ Polling timed out after ${maxPolls * 5} seconds`);
  } catch (err) {
    console.error(`   ❌ Generation error: ${err.message}`);
  }
}

testSunoAPI().catch(console.error);
