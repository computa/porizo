#!/usr/bin/env node

/**
 * Backfill Lyrics Timing
 *
 * Runs Whisper forced alignment on existing rendered tracks that have
 * lyrics_json but no timing data (startTime/endTime).
 *
 * Usage:
 *   node scripts/backfill-lyrics-timing.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Show what would be updated without making changes
 *   --limit N   Process at most N tracks (default: all)
 */

const path = require("path");
const fs = require("fs");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

  // Bootstrap database
  const { createDatabase } = require("../src/database");
  const db = createDatabase();

  const { alignLyrics } = require("../src/providers/whisper");
  const { alignSectionsToTimestamps, sectionsToText } = require("../src/utils/lyrics-alignment");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  const storageDir = process.env.STORAGE_DIR || path.join(__dirname, "..", "storage");

  // Find track versions with lyrics but no timing data
  const rows = db.prepare(`
    SELECT tv.id, tv.version_num, tv.lyrics_json, tv.status,
           t.id AS track_id, t.user_id, t.title
    FROM track_versions tv
    JOIN tracks t ON tv.track_id = t.id
    WHERE tv.lyrics_json IS NOT NULL
      AND tv.lyrics_json != ''
      AND tv.status IN ('preview_ready', 'full_ready')
    ORDER BY tv.id DESC
  `).all();

  // Filter to those without startTime in lyrics
  const candidates = rows.filter(row => {
    try {
      const lyrics = JSON.parse(row.lyrics_json);
      return Array.isArray(lyrics) && lyrics.length > 0 && lyrics[0].startTime === undefined;
    } catch {
      return false;
    }
  });

  const toProcess = candidates.slice(0, limit);
  console.log(`Found ${candidates.length} tracks needing alignment (processing ${toProcess.length})`);

  if (dryRun) {
    for (const row of toProcess) {
      console.log(`  [dry-run] Would align: track=${row.track_id} version=${row.id} "${row.title}"`);
    }
    console.log("Dry run complete.");
    return;
  }

  const updateStmt = db.prepare(`
    UPDATE track_versions SET lyrics_json = ? WHERE id = ?
  `);

  let success = 0;
  let failed = 0;

  for (const row of toProcess) {
    const isFull = row.status === "full_ready";
    const versionDir = path.join(
      storageDir, "tracks", row.user_id, row.track_id, `v${row.version_num}`
    );
    const audioFile = path.join(versionDir, isFull ? "full.m4a" : "preview.m4a");

    if (!fs.existsSync(audioFile)) {
      console.warn(`  Skip: ${row.track_id} v${row.version_num} — audio file not found`);
      failed++;
      continue;
    }

    try {
      const lyrics = JSON.parse(row.lyrics_json);
      const lyricsText = sectionsToText(lyrics);
      const whisperResult = await alignLyrics(audioFile, lyricsText);
      const enriched = alignSectionsToTimestamps(lyrics, whisperResult);

      updateStmt.run(JSON.stringify(enriched), row.id);

      const wordCount = whisperResult.words?.length || 0;
      console.log(`  OK: track=${row.track_id} "${row.title}" — ${wordCount} words, ${enriched.length} sections`);
      success++;
    } catch (err) {
      console.error(`  FAIL: track=${row.track_id} "${row.title}" — ${err.message}`);
      failed++;
    }

    // Brief pause to avoid rate limits
    if (success + failed < toProcess.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\nDone: ${success} aligned, ${failed} failed, ${candidates.length - toProcess.length} remaining`);
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
