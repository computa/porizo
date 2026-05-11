/**
 * Share Embed Tests
 *
 * Tests for social share audio playback features:
 * - generateShareMp4() FFmpeg function
 * - /share/:shareId/share.mp4 endpoint
 * - /embed/:shareId embed player page
 * - /oembed endpoint
 * - OG video tags in /play/:shareId
 * Requires PostgreSQL to be running (npm run db:up)
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

// --- Unit tests for generateShareMp4 ---

const { generateShareMp4, getFFmpegPath } = require("../src/utils/ffmpeg");
const { writeWav } = require("../src/utils/audio");

const TEST_DIR = path.join(__dirname, "..", "storage", "test-share-embed");

function probeStreams(filePath) {
  const ffmpegPath = getFFmpegPath();
  const ffprobeCandidate = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  const ffprobePath = fs.existsSync(ffprobeCandidate) ? ffprobeCandidate : "ffprobe";
  const probe = execFileSync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
    "-of", "json",
    filePath,
  ], { encoding: "utf-8" });
  return JSON.parse(probe);
}

describe("generateShareMp4", () => {
  const artworkPath = path.join(TEST_DIR, "artwork.jpg");
  const audioPath = path.join(TEST_DIR, "audio.wav");

  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Generate a small test audio file (2 seconds)
    writeWav(audioPath, { durationSec: 2, frequencyHz: 440 });
    // Generate a minimal JPEG artwork (1x1 red pixel)
    const ffmpegPath = getFFmpegPath();
    execFileSync(ffmpegPath, [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=100x100:d=1",
      "-frames:v", "1", artworkPath,
    ]);
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("produces valid MP4 with video and audio streams", async () => {
    const outputPath = path.join(TEST_DIR, "share.mp4");
    await generateShareMp4({
      artworkPath,
      audioPath,
      outputPath,
      maxDuration: 5,
    });

    assert.ok(fs.existsSync(outputPath), "Output MP4 should exist");
    const stat = fs.statSync(outputPath);
    assert.ok(stat.size > 0, "Output MP4 should not be empty");

    const info = probeStreams(outputPath);
    const streams = info.streams || [];
    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStream = streams.find((s) => s.codec_type === "audio");

    assert.ok(videoStream, "Should have a video stream");
    assert.ok(audioStream, "Should have an audio stream");
    assert.equal(videoStream.codec_name, "h264", "Video should be H.264");
    assert.equal(audioStream.codec_name, "aac", "Audio should be AAC");
  });

  test("caps duration at maxDuration", async () => {
    const outputPath = path.join(TEST_DIR, "share-capped.mp4");
    await generateShareMp4({
      artworkPath,
      audioPath,
      outputPath,
      maxDuration: 1,
    });

    const info = probeStreams(outputPath);
    const duration = parseFloat(info.format.duration);
    assert.ok(duration <= 2, "Duration should be capped (audio is 2s, cap at 1s)");
  });

  test("throws on missing artwork", async () => {
    await assert.rejects(
      () => generateShareMp4({
        artworkPath: "/nonexistent/art.jpg",
        audioPath,
        outputPath: path.join(TEST_DIR, "fail.mp4"),
      }),
      /Artwork file not found/
    );
  });

  test("throws on missing audio", async () => {
    await assert.rejects(
      () => generateShareMp4({
        artworkPath,
        audioPath: "/nonexistent/audio.wav",
        outputPath: path.join(TEST_DIR, "fail.mp4"),
      }),
      /Audio file not found/
    );
  });
});

// --- Integration tests for server routes ---

async function isPostgresAvailable() {
  try {
    const { createPool } = require("../src/database/postgres.js");
    const db = createPool({});
    await db.query("SELECT 1");
    await db.close();
    return true;
  } catch (err) {
    return false;
  }
}

describe("Share Embed Routes", () => {
  let db;
  let app;
  let testShareId;
  let testCrawlerFallbackShareId;
  let testPoemShareId;
  let postgresAvailable = false;
  const testSchema = "test_share_embed_" + Date.now();
  const testUserId = "u_test_embed_" + Date.now();
  const testTrackId = "t_test_embed_" + Date.now();
  const testCrawlerFallbackTrackId = "t_test_embed_crawler_" + Date.now();
  const testPoemId = "p_test_embed_" + Date.now();
  const testVersionId = "tv_test_embed_" + Date.now();
  const testVersionDir = path.join(
    __dirname,
    "..",
    "storage",
    "tracks",
    testUserId,
    testTrackId,
    "v1"
  );

  before(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      console.log("[Share Embed Tests] PostgreSQL not available, skipping integration tests");
      return;
    }

    process.env.JWT_SECRET =
      process.env.JWT_SECRET || "test-jwt-secret-share-embed-0123456789abcdef";
    process.env.ALLOW_ANON_USER_ID = process.env.ALLOW_ANON_USER_ID || "true";

    const { createPool, runMigrations } = require("../src/database/postgres.js");
    const { buildServer } = require("../src/server.js");
    const { createStorageProvider } = require("../src/storage");

    const adminDb = createPool({});
    await adminDb.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`);
    await adminDb.close();

    db = createPool({ schema: testSchema, maxConnections: 1 });
    await runMigrations(db, path.join(__dirname, "../migrations/pg"));

    const storage = createStorageProvider({ type: "memory" });
    const config = {
      isProduction: false,
      STORAGE_DIR: path.join(__dirname, "..", "storage"),
      STREAM_BASE_URL: "http://localhost:3999",
      PUBLIC_BASE_URL: "http://localhost:3999",
      FACEBOOK_APP_ID: "1234567890",
    };

    app = await buildServer({ db, config, storage });
    await app.listen({ port: 0 }); // Random port

    // Seed test data
    testShareId = "sh_test_embed_" + crypto.randomBytes(4).toString("hex");
    testCrawlerFallbackShareId = "sh_test_crawler_" + crypto.randomBytes(4).toString("hex");
    const now = new Date().toISOString();
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();

    await db.query(
      `INSERT INTO users (id, created_at, risk_level) VALUES ($1, $2, 'low')`,
      [testUserId, now]
    );
    await db.query(
      `INSERT INTO entitlements (user_id, tier, songs_remaining, preview_count_today, preview_count_reset_at, updated_at) VALUES ($1, 'free', 1, 0, $2, $2)`,
      [testUserId, now]
    );
    await db.query(
      `INSERT INTO tracks (id, user_id, title, recipient_name, occasion, status, created_at, updated_at) VALUES ($1, $2, 'Test Song', 'Maria', 'birthday', 'completed', $3, $3)`,
      [testTrackId, testUserId, now]
    );
    await db.query(
      `INSERT INTO tracks (id, user_id, title, recipient_name, occasion, status, created_at, updated_at) VALUES ($1, $2, 'Fallback Song', 'Chioma', 'celebration', 'completed', $3, $3)`,
      [testCrawlerFallbackTrackId, testUserId, now]
    );
    await db.query(
      `INSERT INTO track_versions (id, track_id, version_num, params_json, params_hash, status, render_type, created_at) VALUES ($1, $2, 1, '{}', 'hash123', 'completed', 'preview', $3)`,
      [testVersionId, testTrackId, now]
    );
    await db.query(
      `INSERT INTO poems (id, user_id, title, recipient_name, occasion, tone, verses, message, status, created_at, updated_at)
       VALUES ($1, $2, 'Poem Title', 'Ada', 'birthday', 'heartfelt', $3, 'Gift poem', 'generated', $4, $4)`,
      [testPoemId, testUserId, JSON.stringify([["Line one"], ["Line two"]]), now]
    );
    await db.query(
      `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, web_stream_allowed, created_at) VALUES ($1, $2, $3, $4, 'unbound', $5, 1, $6)`,
      [testShareId, testTrackId, testVersionId, testUserId, futureExpiry, now]
    );
    // Seed a share that points to a non-existent track version to simulate "video not ready" crawler path.
    await db.query(
      `INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, web_stream_allowed, created_at) VALUES ($1, $2, $3, $4, 'unbound', $5, 1, $6)`,
      [testCrawlerFallbackShareId, testCrawlerFallbackTrackId, `missing_${testVersionId}`, testUserId, futureExpiry, now]
    );
    testPoemShareId = "psh_test_embed_" + crypto.randomBytes(4).toString("hex");
    await db.query(
      `INSERT INTO poem_share_tokens (id, poem_id, creator_id, status, claim_pin, claim_attempts, allow_save, expires_at, created_at, access_count)
       VALUES ($1, $2, $3, 'active', '123456', 0, true, $4, $5, 0)`,
      [testPoemShareId, testPoemId, testUserId, futureExpiry, now]
    );

    // Seed a track cover so /share/:id/cover.jpg can prove it returns
    // the generated social card instead of the raw 1024x1024 cover file.
    fs.mkdirSync(testVersionDir, { recursive: true });
    const ffmpegPath = getFFmpegPath();
    execFileSync(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#29324A:s=1024x1024:d=1",
      "-frames:v",
      "1",
      path.join(testVersionDir, "cover_1024.jpg"),
    ]);
  });

  after(async () => {
    if (app) await app.close();
    if (db) {
      await db.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await db.close();
    }
    fs.rmSync(path.join(__dirname, "..", "storage", "tracks", testUserId), { recursive: true, force: true });
  });

  test("/play/:shareId includes og:video meta tags", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/play/${testShareId}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes("og:video"), "Should contain og:video meta tag");
    assert.ok(body.includes("og:video:url"), "Should include structured og:video:url tag");
    assert.ok(body.includes("share.mp4"), "og:video should reference share.mp4");
    assert.ok(body.includes(`/share/${testShareId}/cover.jpg`), "Should use stable crawler-safe cover endpoint");
    assert.ok(body.includes(`cover.jpg?v=`), "Should append cover version query to bust stale social caches");
    assert.ok(body.includes('og:image:width" content="1200'), "Should declare 1200px OG image width");
    assert.ok(body.includes('og:image:height" content="630'), "Should declare 630px OG image height");
    assert.ok(body.includes('twitter:card" content="player'), "Should have twitter player card");
    assert.ok(body.includes('twitter:player:stream'), "Should include twitter player stream tag");
    assert.ok(body.includes(`/embed/${testShareId}`), "Should reference embed URL");
    assert.ok(body.includes("oembed"), "Should have oEmbed discovery link");
  });

  test("/play/:shareId falls back to image-only card for crawler when teaser video is unavailable", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/play/${testCrawlerFallbackShareId}`,
      headers: {
        "user-agent": "facebookexternalhit/1.1",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes('og:type" content="website'), "Crawler fallback should use og:type=website");
    assert.ok(body.includes('twitter:card" content="summary_large_image'), "Crawler fallback should use summary card");
    assert.ok(!body.includes("og:video"), "Crawler fallback should not include og:video tags");
    assert.ok(!body.includes("twitter:player"), "Crawler fallback should not include twitter player tags");
    assert.ok(body.includes(`/share/${testCrawlerFallbackShareId}/cover.jpg`), "Crawler fallback should still provide a cover image");
  });

  test("/play/:shareId omits og:video for Facebook crawler even when video is available", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/play/${testShareId}`,
      headers: {
        "user-agent": "facebookexternalhit/1.1",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(body.includes('og:type" content="website'), "Facebook crawler should get image card type");
    assert.ok(body.includes('twitter:card" content="summary_large_image'), "Facebook crawler should use summary card");
    assert.ok(!body.includes("og:video"), "Facebook crawler response should omit og:video tags");
    assert.ok(!body.includes("twitter:player"), "Facebook crawler response should omit twitter player tags");
  });

  test("/play/:shareId preserves request query params in og:url for social cache busting", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/play/${testShareId}?sv=2&fbv=cache123`,
      headers: {
        "user-agent": "facebookexternalhit/1.1",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(
      body.includes(`og:url" content="http://localhost:3999/play/${testShareId}?sv=2&amp;fbv=cache123"`),
      "og:url should preserve request query params so social cache-busted links remain distinct"
    );
    assert.ok(
      body.includes(`/share/${testShareId}/cover.jpg?v=2&amp;smv=cache123`),
      "og:image should carry social cache token so crawlers fetch a fresh card variant"
    );
  });

  test("/poem/:shareId preserves request query params in og:url for social cache busting", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/poem/${testPoemShareId}?sv=2&smv=poemcache999`,
      headers: {
        "user-agent": "facebookexternalhit/1.1",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body;
    assert.ok(
      body.includes(`og:url" content="http://localhost:3999/poem/${testPoemShareId}?sv=2&amp;smv=poemcache999"`),
      "Poem og:url should preserve request query params so social cache-busted links remain distinct"
    );
    assert.ok(
      body.includes(`poem/${testPoemShareId}/og-image.png?v=2&amp;smv=poemcache999`),
      "Poem og:image should include version + social cache token"
    );
    assert.ok(
      body.includes('meta property="fb:app_id"'),
      "Poem cards should include Facebook app metadata for consistent crawler treatment"
    );
  });

  test("/tracks/:id/og-previews returns all variants for owner with no-store cache", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/tracks/${testTrackId}/og-previews`,
      headers: {
        "x-user-id": testUserId,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = JSON.parse(response.body);
    assert.equal(body.current_variant, null);
    assert.equal(body.variants.length, 3);
    assert.deepEqual(
      body.variants.map((item) => item.name),
      ["spotlight", "envelope", "greeting_card"]
    );
    assert.ok(
      body.variants.every((item) => item.preview.startsWith("data:image/jpeg;base64,")),
      "All song previews should return base64 JPEG data URLs"
    );
  });

  test("/tracks/:id/share updates og_variant and returns existing active share payload", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${testTrackId}/share`,
      headers: {
        "x-user-id": testUserId,
        "content-type": "application/json",
      },
      payload: {
        og_variant: "spotlight",
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.share_id, testShareId);
    assert.equal(body.existing, true);
    assert.ok(body.share_url.includes(`/play/${testShareId}`));

    const variantRow = await db.query("SELECT og_variant FROM tracks WHERE id = $1", [testTrackId]);
    assert.equal(variantRow.rows[0].og_variant, "spotlight");

    const coverResponse = await app.inject({
      method: "GET",
      url: `/share/${testShareId}/cover.jpg`,
    });
    assert.equal(coverResponse.statusCode, 200);

    const cachedVariantCards = fs
      .readdirSync(testVersionDir)
      .filter((name) => /^share_og_1200x630_v.+_spotlight\.jpg$/.test(name));
    assert.ok(
      cachedVariantCards.length > 0,
      "Variant song card should be cached with variant suffix in filename"
    );
  });

  test("/tracks/:id/share rejects invalid og_variant", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "POST",
      url: `/tracks/${testTrackId}/share`,
      headers: {
        "x-user-id": testUserId,
        "content-type": "application/json",
      },
      payload: {
        og_variant: "not_a_variant",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.error, "INVALID_VARIANT");
  });

  test("/poems/:id/og-previews returns all variants for owner with no-store cache", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/poems/${testPoemId}/og-previews`,
      headers: {
        "x-user-id": testUserId,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = JSON.parse(response.body);
    assert.equal(body.current_variant, null);
    assert.equal(body.variants.length, 3);
    assert.deepEqual(
      body.variants.map((item) => item.name),
      ["open_book", "verse_window", "whisper"]
    );
    assert.ok(
      body.variants.every((item) => item.preview.startsWith("data:image/png;base64,")),
      "All poem previews should return base64 PNG data URLs"
    );
  });

  test("/poems/:id/share sets og_variant and poem OG cache uses versioned variant filename", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const shareResponse = await app.inject({
      method: "POST",
      url: `/poems/${testPoemId}/share`,
      headers: {
        "x-user-id": testUserId,
        "content-type": "application/json",
      },
      payload: {
        og_variant: "whisper",
      },
    });
    assert.equal(shareResponse.statusCode, 200);
    const shareBody = JSON.parse(shareResponse.body);
    const poemShareId = shareBody.share_id;
    assert.ok(poemShareId, "Poem share should return a share id");

    const imageResponse = await app.inject({
      method: "GET",
      url: `/poem/${poemShareId}/og-image.png?v=2`,
    });
    assert.equal(imageResponse.statusCode, 200);
    assert.ok(
      (imageResponse.headers["content-type"] || "").startsWith("image/png"),
      "Poem OG endpoint should return PNG content type"
    );

    const poemOgPath = path.join(
      __dirname,
      "..",
      "storage",
      "poems",
      testUserId,
      testPoemId,
      "og_1200x630_v2_whisper.png"
    );
    assert.ok(fs.existsSync(poemOgPath), "Poem OG image should be cached with version + variant filename");
  });

  test("/share/:shareId/cover.jpg returns a stable social image", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/share/${testShareId}/cover.jpg`,
    });

    assert.equal(response.statusCode, 200);
    assert.ok(
      (response.headers["content-type"] || "").startsWith("image/"),
      "Cover endpoint should return an image content type"
    );

    // The social card should be landscape OG dimensions, not the raw square cover.
    const sharp = require("sharp");
    const metadata = await sharp(response.rawPayload).metadata();
    assert.equal(metadata.width, 1200, "OG cover width should be 1200");
    assert.equal(metadata.height, 630, "OG cover height should be 630");

    const generatedVersionedCards = fs
      .readdirSync(testVersionDir)
      .filter((name) => /^share_og_1200x630_v.+\.jpg$/.test(name));
    assert.ok(
      generatedVersionedCards.length > 0,
      "Should cache generated OG cards with a versioned filename to avoid stale legacy card reuse"
    );
  });

  test("/share/:shareId/cover.jpg falls back to default cover when track version is missing", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/share/${testCrawlerFallbackShareId}/cover.jpg`,
    });

    assert.equal(response.statusCode, 200);
    assert.ok(
      (response.headers["content-type"] || "").startsWith("image/"),
      "Fallback cover endpoint should still return an image content type"
    );
  });

  test("/embed/:shareId returns embeddable HTML player", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/embed/${testShareId}`,
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.headers["content-type"].includes("text/html"), "Should be HTML");
    assert.equal(response.headers["content-security-policy"], "frame-ancestors *", "CSP should allow framing");
    const body = response.body;
    assert.ok(body.includes("A song for Maria"), "Should have title");
    assert.ok(body.includes(testShareId), "Should have share ID in body");
    assert.ok(body.includes(`/share/${testShareId}/share.mp4`), "Should use share.mp4 teaser media");
    assert.ok(body.includes("embed.js"), "Should load embed player JS");
  });

  test("/embed/:shareId remains playable after claim by using teaser media and preserving public web metadata", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    await db.query(
      `UPDATE share_tokens SET status = 'claimed', web_stream_allowed = 1 WHERE id = $1`,
      [testShareId]
    );

    const embedResponse = await app.inject({
      method: "GET",
      url: `/embed/${testShareId}`,
    });
    assert.equal(embedResponse.statusCode, 200);
    assert.ok(
      embedResponse.body.includes(`/share/${testShareId}/share.mp4`),
      "Embed should use claim-independent teaser media"
    );

    const shareInfoResponse = await app.inject({
      method: "GET",
      url: `/share/${testShareId}`,
    });
    assert.equal(shareInfoResponse.statusCode, 200, "Claimed share metadata should still load");
    const shareInfo = JSON.parse(shareInfoResponse.body);
    assert.equal(shareInfo.status, "claimed");
    assert.ok(shareInfo.web_stream_url, "Claimed share should still advertise a public browser listening surface");
    assert.equal(shareInfo.app_required, false, "Claimed share should not require the app when public listening is still allowed");
    const downloadUrl = new URL(shareInfo.app_download_url);
    assert.equal(downloadUrl.pathname, "/download");
    assert.equal(downloadUrl.searchParams.get("utm_source"), "share_player");
    assert.equal(downloadUrl.searchParams.get("utm_medium"), "recipient_loop");
    assert.equal(downloadUrl.searchParams.get("utm_campaign"), "shared_song_recipient");
    assert.equal(downloadUrl.searchParams.get("utm_content"), "song_generic_install");
    assert.equal(downloadUrl.searchParams.has("ref"), false);
    assert.equal(downloadUrl.searchParams.has("deep_link"), false);

    await db.query(
      `UPDATE share_tokens SET status = 'unbound', web_stream_allowed = 1 WHERE id = $1`,
      [testShareId]
    );
  });

  test("/embed/:shareId returns 404 for nonexistent share", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: "/embed/nonexistent_share_id",
    });
    assert.equal(response.statusCode, 404);
  });

  test("/oembed returns valid JSON response", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/oembed?url=${encodeURIComponent(`http://localhost:3999/play/${testShareId}`)}&format=json`,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.type, "rich");
    assert.equal(body.version, "1.0");
    assert.equal(body.provider_name, "Porizo");
    assert.equal(body.title, "A song for Maria");
    assert.ok(body.thumbnail_url.includes("cover.jpg?v="), "thumbnail_url should include cover version query");
    assert.equal(body.thumbnail_width, 1200);
    assert.equal(body.thumbnail_height, 630);
    assert.equal(body.width, 480);
    assert.equal(body.height, 180);
    assert.ok(body.html.includes("iframe"), "Should contain iframe HTML");
    assert.ok(body.html.includes(`/embed/${testShareId}`), "iframe should reference embed URL");
    assert.equal(body.cache_age, 86400);
  });

  test("/oembed returns 400 without url param", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: "/oembed",
    });
    assert.equal(response.statusCode, 400);
  });

  test("/oembed returns 404 for invalid URL pattern", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/oembed?url=${encodeURIComponent("http://example.com/not-a-share")}`,
    });
    assert.equal(response.statusCode, 404);
  });

  test("/oembed returns 501 for non-JSON format", async (t) => {
    if (!postgresAvailable) { t.skip("PostgreSQL not available"); return; }
    const response = await app.inject({
      method: "GET",
      url: `/oembed?url=${encodeURIComponent(`http://localhost:3999/play/${testShareId}`)}&format=xml`,
    });
    assert.equal(response.statusCode, 501);
  });
});
