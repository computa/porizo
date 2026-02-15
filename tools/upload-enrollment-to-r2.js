#!/usr/bin/env node
/**
 * Upload local enrollment audio files to R2 for a specific user.
 *
 * Usage: node tools/upload-enrollment-to-r2.js <userId> <localSessionDir>
 *
 * This uploads all .wav files from a local enrollment session directory
 * to R2 under the correct key path: enrollment/raw/{userId}/{sessionId}/{chunkId}.wav
 */

const fs = require("fs");
const path = require("path");
const { createS3Storage } = require("../src/storage/s3");

const userId = process.argv[2];
const localDir = process.argv[3];

if (!userId || !localDir) {
  console.error("Usage: node tools/upload-enrollment-to-r2.js <userId> <localSessionDir>");
  console.error("Example: node tools/upload-enrollment-to-r2.js user_abc123 storage/enrollment/raw/ios_xyz/");
  process.exit(1);
}

if (!fs.existsSync(localDir)) {
  console.error(`Directory not found: ${localDir}`);
  process.exit(1);
}

async function main() {
  const s3 = createS3Storage({
    S3_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    S3_REGION: "auto",
    S3_BUCKET: process.env.R2_BUCKET_NAME,
    S3_ENDPOINT: process.env.R2_ENDPOINT,
    S3_FORCE_PATH_STYLE: "true",
  });

  // Find all .wav files recursively
  const wavFiles = [];
  function findWavs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findWavs(full);
      else if (entry.name.endsWith(".wav")) wavFiles.push(full);
    }
  }
  findWavs(localDir);

  if (wavFiles.length === 0) {
    console.error("No .wav files found in", localDir);
    process.exit(1);
  }

  console.log(`Found ${wavFiles.length} WAV files to upload`);

  // Use the parent directory name as session ID
  const sessionId = path.basename(localDir.replace(/\/$/, ""));
  let uploaded = 0;

  for (const filePath of wavFiles) {
    // Build a chunk ID from the relative path (flatten subdirectories)
    const relPath = path.relative(localDir, filePath);
    // Replace path separators with underscores and drop .wav extension for chunkId
    const chunkId = relPath.replace(/\//g, "_").replace(/\.wav$/, "");
    const key = `enrollment/raw/${userId}/${sessionId}/${chunkId}.wav`;

    console.log(`Uploading: ${filePath} → ${key}`);
    try {
      await s3.putFile({ key, filePath, contentType: "audio/wav" });
      uploaded++;
      console.log(`  ✓ Uploaded (${fs.statSync(filePath).size} bytes)`);
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
    }
  }

  console.log(`\nDone: ${uploaded}/${wavFiles.length} files uploaded`);

  // Verify by listing
  const prefix = `enrollment/raw/${userId}/`;
  console.log(`\nVerifying R2 contents at ${prefix}:`);
  const result = await s3.listObjects({ prefix });
  console.log("Prefixes:", JSON.stringify(result.prefixes));
  console.log("Keys:", JSON.stringify(result.keys));
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
