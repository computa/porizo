#!/usr/bin/env node
/**
 * Standalone test script for Seed-VC voice cloning
 *
 * Tests the Seed-VC Hugging Face Space integration separately from the full pipeline.
 *
 * Usage:
 *   node scripts/test-seedvc.js --source <audio> --reference <audio> [--output <path>]
 *
 * Example:
 *   node scripts/test-seedvc.js \
 *     --source storage/tracks/debug_mjtdnehipl49/track123/v1/guide_vocal.mp3 \
 *     --reference storage/enrollment/raw/debug_mjtdnehipl49/session123/chunk_sung.wav
 */

const fs = require("fs");
const path = require("path");

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    source: null,
    reference: null,
    output: null,
    diffusionSteps: 25,
    lengthAdjust: 1.0,
    cfgRate: 0.7,
    hfToken: process.env.HF_TOKEN || null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--source":
      case "-s":
        options.source = args[++i];
        break;
      case "--reference":
      case "-r":
        options.reference = args[++i];
        break;
      case "--output":
      case "-o":
        options.output = args[++i];
        break;
      case "--steps":
        options.diffusionSteps = parseInt(args[++i], 10);
        break;
      case "--length":
        options.lengthAdjust = parseFloat(args[++i]);
        break;
      case "--cfg":
        options.cfgRate = parseFloat(args[++i]);
        break;
      case "--token":
        options.hfToken = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Seed-VC Voice Cloning Test Script

Usage:
  node scripts/test-seedvc.js --source <audio> --reference <audio> [options]

Required Arguments:
  --source, -s     Path to source audio (the singing to convert)
  --reference, -r  Path to reference audio (the voice to clone)

Optional Arguments:
  --output, -o     Output path (default: seedvc_output.wav in current dir)
  --steps          Diffusion steps, higher = better quality but slower (default: 25)
  --length         Length adjustment factor (default: 1.0)
  --cfg            CFG rate (default: 0.7)
  --token          Hugging Face token (or set HF_TOKEN env var)
  --help, -h       Show this help message

Example:
  node scripts/test-seedvc.js \\
    --source storage/tracks/user/track/v1/guide_vocal.mp3 \\
    --reference storage/enrollment/raw/user/session/chunk_sung.wav \\
    --output test_output.wav
  `);
}

async function main() {
  const options = parseArgs();

  // Validate required arguments
  if (!options.source || !options.reference) {
    console.error("Error: --source and --reference are required");
    printUsage();
    process.exit(1);
  }

  // Validate files exist
  if (!fs.existsSync(options.source)) {
    console.error(`Error: Source file not found: ${options.source}`);
    process.exit(1);
  }
  if (!fs.existsSync(options.reference)) {
    console.error(`Error: Reference file not found: ${options.reference}`);
    process.exit(1);
  }

  const outputPath = options.output || path.join(process.cwd(), "seedvc_output.wav");

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("              Seed-VC Voice Cloning Test");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`Source audio:    ${options.source}`);
  console.log(`Reference audio: ${options.reference}`);
  console.log(`Output path:     ${outputPath}`);
  console.log(`Diffusion steps: ${options.diffusionSteps}`);
  console.log(`Length adjust:   ${options.lengthAdjust}`);
  console.log(`CFG rate:        ${options.cfgRate}`);
  console.log(`HF Token:        ${options.hfToken ? "***provided***" : "(not set)"}`);
  console.log("\n───────────────────────────────────────────────────────────\n");

  // Dynamic import for @gradio/client (ESM module)
  console.log("[1/4] Loading Gradio client...");
  let Client, handle_file;
  try {
    const gradioModule = await import("@gradio/client");
    Client = gradioModule.Client;
    handle_file = gradioModule.handle_file;
    console.log("      ✓ Gradio client loaded");
  } catch (error) {
    console.error("      ✗ Failed to load Gradio client");
    console.error("      Make sure @gradio/client is installed: npm install @gradio/client");
    console.error(`      Error: ${error.message}`);
    process.exit(1);
  }

  // Connect to Seed-VC Space
  console.log("\n[2/4] Connecting to Seed-VC Hugging Face Space...");
  const SEEDVC_SPACE = "Plachta/Seed-VC";

  const connectOptions = {};
  if (options.hfToken) {
    connectOptions.hf_token = options.hfToken;
  }

  let client;
  try {
    client = await Client.connect(SEEDVC_SPACE, connectOptions);
    console.log("      ✓ Connected to Plachta/Seed-VC");
  } catch (error) {
    console.error("      ✗ Failed to connect to Seed-VC Space");
    console.error(`      Error: ${error.message}`);
    if (error.message.includes("rate limit")) {
      console.error("\n      Tip: Set HF_TOKEN to bypass rate limits");
      console.error("           export HF_TOKEN=hf_your_token_here");
    }
    process.exit(1);
  }

  // Perform voice conversion
  console.log("\n[3/4] Running voice conversion (this may take 1-5 minutes)...");
  const startTime = Date.now();

  try {
    // gr.Interface uses /predict endpoint with positional arguments
    // Parameters in order: source, target, diffusion_steps, length_adjust, inference_cfg_rate, f0_condition, auto_f0_adjust, pitch_shift
    const result = await client.predict("/predict", [
      handle_file(options.source),      // source audio
      handle_file(options.reference),   // reference audio
      options.diffusionSteps,           // diffusion_steps
      options.lengthAdjust,             // length_adjust
      options.cfgRate,                  // inference_cfg_rate
      true,                             // f0_condition - enable for singing
      true,                             // auto_f0_adjust
      0,                                // pitch_shift
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`      ✓ Voice conversion completed in ${elapsed}s`);

    // Handle result - Seed-VC returns streaming output [mp3_bytes, final_wav_tuple]
    console.log("\n[4/4] Saving output...");

    if (!result || !result.data) {
      throw new Error("No data returned from Seed-VC");
    }

    console.log("      Result data length:", result.data.length);
    console.log("      Result types:", result.data.map(d => typeof d === 'object' && d !== null ? (d.url ? 'url-object' : d.path ? 'path-object' : 'other-object') : typeof d));

    // Seed-VC returns:
    // - data[0]: streaming mp3 (M3U playlist or partial data)
    // - data[1]: final audio as a tuple (sample_rate, audio_array) or file object
    let audioData = null;

    // Check the second output (final audio)
    if (result.data.length > 1 && result.data[1]) {
      audioData = result.data[1];
      console.log("      Using final audio from data[1]");
    } else {
      audioData = result.data[0];
      console.log("      Using data from data[0]");
    }

    if (typeof audioData === "string") {
      // URL returned - need to download
      if (audioData.includes("m3u") || audioData.includes("playlist")) {
        console.log("      Got M3U playlist, checking for direct audio...");
        // Try to get the actual audio file from the playlist
        const response = await fetch(audioData);
        const playlistText = await response.text();
        const lines = playlistText.split("\n").filter(l => !l.startsWith("#") && l.trim());
        if (lines.length > 0) {
          // Get the audio segment URL
          const audioUrl = lines[0];
          const baseUrl = audioData.substring(0, audioData.lastIndexOf("/") + 1);
          const fullUrl = audioUrl.startsWith("http") ? audioUrl : baseUrl + audioUrl;
          console.log(`      Downloading audio segment: ${fullUrl.substring(0, 80)}...`);
          const audioResponse = await fetch(fullUrl);
          if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.status}`);
          }
          const buffer = Buffer.from(await audioResponse.arrayBuffer());
          fs.writeFileSync(outputPath, buffer);
        } else {
          throw new Error("No audio segments in M3U playlist");
        }
      } else {
        console.log(`      Downloading from: ${audioData.substring(0, 80)}...`);
        const response = await fetch(audioData);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
      }
    } else if (audioData && audioData.url) {
      // Object with URL
      console.log(`      Downloading from: ${audioData.url.substring(0, 80)}...`);
      const response = await fetch(audioData.url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
    } else if (audioData && audioData.path) {
      // Local file path returned (unlikely for remote Space)
      fs.copyFileSync(audioData.path, outputPath);
    } else if (Array.isArray(audioData) && audioData.length === 2) {
      // Tuple format: [sample_rate, audio_array]
      console.log("      Got audio tuple format, sample_rate:", audioData[0]);
      throw new Error("Audio array format not yet supported - need to convert to WAV");
    } else {
      console.log("      Result structure:", JSON.stringify(result, null, 2).substring(0, 500));
      throw new Error("Unexpected result format from Seed-VC");
    }

    const stats = fs.statSync(outputPath);
    console.log(`      ✓ Saved to: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("                    SUCCESS!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`\nPlay the output: afplay "${outputPath}"`);
    console.log("\nCompare with original:");
    console.log(`  Original voice (reference): afplay "${options.reference}"`);
    console.log(`  Source singing:             afplay "${options.source}"`);
    console.log(`  Cloned voice output:        afplay "${outputPath}"`);
    console.log("");

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`      ✗ Voice conversion failed after ${elapsed}s`);
    console.error(`      Error: ${error.message}`);

    if (error.message.includes("queue")) {
      console.error("\n      The Seed-VC Space might be busy. Try again in a few minutes.");
    }
    if (error.message.includes("429") || error.message.includes("rate")) {
      console.error("\n      Rate limited. Set HF_TOKEN to bypass:");
      console.error("      export HF_TOKEN=hf_your_token_here");
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
