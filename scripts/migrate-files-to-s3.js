#!/usr/bin/env node
/**
 * Migrate Files to S3
 *
 * Migrates existing local storage files to S3 with proper encryption.
 *
 * Usage:
 *   node scripts/migrate-files-to-s3.js --dry-run     # Preview what would be uploaded
 *   node scripts/migrate-files-to-s3.js               # Actually upload files
 *   node scripts/migrate-files-to-s3.js --verbose     # Show detailed progress
 *
 * Environment variables required:
 *   STORAGE_DIR - Local storage directory (default: ./storage)
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION
 *   KMS_KEY_ID (optional) - For encrypting sensitive files
 */

const fs = require("fs");
const path = require("path");

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");

// Require dotenv for environment variables
require("dotenv/config");

const { createS3Storage } = require("../src/storage/s3");
const { getKeyForPath } = require("../src/storage/kms");

// File type to content type mapping
const CONTENT_TYPES = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".json": "application/json",
  ".txt": "text/plain",
  ".bin": "application/octet-stream",
  ".m3u8": "application/x-mpegURL",
  ".ts": "video/MP2T",
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/**
 * Recursively scan directory for files
 */
function scanDirectory(dir, baseDir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, baseDir, files);
    } else if (entry.isFile()) {
      // Convert absolute path to S3 key (relative path from storage dir)
      const s3Key = path.relative(baseDir, fullPath);
      const stat = fs.statSync(fullPath);

      files.push({
        localPath: fullPath,
        s3Key,
        size: stat.size,
        mtime: stat.mtime,
      });
    }
  }

  return files;
}

/**
 * Format file size for display
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Main migration function
 */
async function migrateFilesToS3() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           Porizo File Migration to S3                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  // Validate configuration
  const storageDir = process.env.STORAGE_DIR || "./storage";
  const requiredEnvVars = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  // Create S3 storage provider
  const storage = createS3Storage({
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION || "us-east-1",
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    KMS_KEY_ID: process.env.KMS_KEY_ID,
    KMS_REGION: process.env.KMS_REGION,
    KMS_USE_BUCKET_KEY: process.env.KMS_USE_BUCKET_KEY,
  });

  console.log(`📁 Storage directory: ${path.resolve(storageDir)}`);
  console.log(`☁️  S3 bucket: ${process.env.S3_BUCKET}`);
  console.log(`🔐 KMS encryption: ${storage.isEncryptionEnabled() ? "Enabled" : "Disabled"}`);
  console.log(`🔍 Mode: ${dryRun ? "DRY RUN (no uploads)" : "LIVE (uploading files)"}`);
  console.log("");

  // Scan for files
  console.log("Scanning for files...");
  const files = scanDirectory(path.resolve(storageDir), path.resolve(storageDir));

  if (files.length === 0) {
    console.log("No files found to migrate.");
    return;
  }

  // Categorize files
  const categories = {
    enrollment_raw: [],
    enrollment_clean: [],
    voice_profiles: [],
    tracks: [],
    other: [],
  };

  for (const file of files) {
    if (file.s3Key.startsWith("enrollment/raw/")) {
      categories.enrollment_raw.push(file);
    } else if (file.s3Key.startsWith("enrollment/clean/")) {
      categories.enrollment_clean.push(file);
    } else if (file.s3Key.startsWith("voice_profiles/")) {
      categories.voice_profiles.push(file);
    } else if (file.s3Key.startsWith("tracks/")) {
      categories.tracks.push(file);
    } else {
      categories.other.push(file);
    }
  }

  // Print summary
  console.log("");
  console.log("📊 File Summary:");
  console.log("─────────────────────────────────────────");

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  console.log(`  📁 Enrollment (raw):   ${categories.enrollment_raw.length} files`);
  console.log(`  📁 Enrollment (clean): ${categories.enrollment_clean.length} files`);
  console.log(`  📁 Voice profiles:     ${categories.voice_profiles.length} files (🔐 encrypted)`);
  console.log(`  📁 Tracks:             ${categories.tracks.length} files`);
  console.log(`  📁 Other:              ${categories.other.length} files`);
  console.log("─────────────────────────────────────────");
  console.log(`  Total: ${files.length} files (${formatSize(totalSize)})`);
  console.log("");

  if (dryRun) {
    console.log("🔍 DRY RUN - Showing files that would be uploaded:");
    console.log("");

    for (const file of files) {
      const pathInfo = getKeyForPath(file.s3Key);
      const encryptionTag = pathInfo.encrypted ? " 🔐" : "";
      console.log(`  ${file.s3Key} (${formatSize(file.size)})${encryptionTag}`);
    }

    console.log("");
    console.log("To actually upload files, run without --dry-run flag.");
    return;
  }

  // Upload files
  console.log("Starting upload...");
  console.log("");

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    const pathInfo = getKeyForPath(file.s3Key);
    const contentType = getContentType(file.localPath);

    try {
      // Check if file already exists in S3
      const exists = await storage.objectExists({ key: file.s3Key });
      if (exists) {
        skipped++;
        if (verbose) {
          console.log(`  ⏭️  SKIP: ${file.s3Key} (already exists)`);
        }
        continue;
      }

      // Upload file
      await storage.putFile({
        key: file.s3Key,
        filePath: file.localPath,
        contentType,
      });

      uploaded++;
      if (verbose) {
        const encryptionTag = pathInfo.encrypted ? " 🔐" : "";
        console.log(`  ✅ ${file.s3Key} (${formatSize(file.size)})${encryptionTag}`);
      } else {
        // Progress indicator
        process.stdout.write(`\r  Uploaded: ${uploaded} / ${files.length} files`);
      }
    } catch (error) {
      failed++;
      errors.push({ file: file.s3Key, error: error.message });
      if (verbose) {
        console.log(`  ❌ FAILED: ${file.s3Key} - ${error.message}`);
      }
    }
  }

  if (!verbose) {
    console.log(""); // New line after progress
  }

  // Print results
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log("📊 Migration Results:");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  ✅ Uploaded: ${uploaded} files`);
  console.log(`  ⏭️  Skipped:  ${skipped} files (already in S3)`);
  console.log(`  ❌ Failed:   ${failed} files`);
  console.log("");

  if (errors.length > 0) {
    console.log("❌ Errors:");
    for (const { file, error } of errors.slice(0, 10)) {
      console.log(`   - ${file}: ${error}`);
    }
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more errors`);
    }
  }

  if (failed === 0 && uploaded > 0) {
    console.log("✅ Migration completed successfully!");
  } else if (failed > 0) {
    console.log("⚠️  Migration completed with errors. Check the logs above.");
    process.exit(1);
  }
}

// Run migration
migrateFilesToS3().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
