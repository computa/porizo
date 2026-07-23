"use strict";

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, afterEach, describe, test } = require("node:test");

const { trackMasterKey, trackPreviewKey } = require("../../src/storage");
const { getFFmpegPath } = require("../../src/utils/ffmpeg");
const { execFileSync } = require("node:child_process");

const { _testing } = require("../../src/workflows/runner");
const { uploadTrackMasterMp3 } = _testing;

// The two serving routes derive their mp3 storage key DIFFERENTLY:
//   GET /full/:id.mp3    -> trackMasterKey({format:"mp3"})            -> .../master.mp3
//   GET /preview/:id.mp3 -> trackPreviewKey(...).replace(.m4a,.mp3)   -> .../preview.mp3
// uploadTrackMasterMp3 must upload under the EXACT key the route reads.
function routeMp3KeyForFull({ userId, trackId, versionNum }) {
  return trackMasterKey({ userId, trackId, versionNum, format: "mp3" });
}

function routeMp3KeyForPreview({ userId, trackId, versionNum }) {
  return trackPreviewKey({ userId, trackId, versionNum }).replace(
    /\.m4a$/,
    ".mp3",
  );
}

function writeValidM4a(filePath, durationSec = 2) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  execFileSync(
    getFFmpegPath(),
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=44100:duration=${durationSec}`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      filePath,
    ],
    { stdio: "ignore" },
  );
}

function makeFakeStorage() {
  const objects = new Map(); // key -> { contentType, bytes }
  return {
    type: "s3",
    objects,
    putCalls: [],
    existsCalls: [],
    forceExists: new Set(),
    async objectExists({ key }) {
      this.existsCalls.push(key);
      return this.forceExists.has(key) || objects.has(key);
    },
    async putFile({ key, filePath, contentType }) {
      this.putCalls.push({ key, contentType });
      const bytes = fs.readFileSync(filePath);
      objects.set(key, { contentType, size: bytes.length });
    },
  };
}

describe("uploadTrackMasterMp3", () => {
  let storageDir;
  let track;
  let trackVersion;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-mp3-upload-"));
    track = { id: "track-1", user_id: "user-1" };
    trackVersion = { version_num: 1 };
  });

  afterEach(() => {
    if (storageDir) {
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = null;
    }
  });

  function versionDirFor() {
    const dir = path.join(
      storageDir,
      "tracks",
      track.user_id,
      track.id,
      `v${trackVersion.version_num}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  test("full render: uploads mp3 under the exact key GET /full/:id.mp3 reads", async () => {
    const versionDir = versionDirFor();
    writeValidM4a(path.join(versionDir, "full.m4a"));
    const storage = makeFakeStorage();

    const result = await uploadTrackMasterMp3({
      storageProvider: storage,
      versionDir,
      track,
      trackVersion,
      kind: "full",
    });

    const expectedKey = routeMp3KeyForFull({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    assert.equal(result, expectedKey);
    assert.equal(storage.putCalls.length, 1);
    assert.equal(storage.putCalls[0].key, expectedKey);
    assert.equal(storage.putCalls[0].contentType, "audio/mpeg");
    assert.ok(storage.objects.get(expectedKey).size > 0);
  });

  test("preview render: uploads mp3 under the exact key GET /preview/:id.mp3 reads", async () => {
    const versionDir = versionDirFor();
    writeValidM4a(path.join(versionDir, "preview.m4a"));
    const storage = makeFakeStorage();

    const result = await uploadTrackMasterMp3({
      storageProvider: storage,
      versionDir,
      track,
      trackVersion,
      kind: "preview",
    });

    const expectedKey = routeMp3KeyForPreview({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    assert.equal(result, expectedKey);
    assert.equal(storage.putCalls.length, 1);
    assert.equal(storage.putCalls[0].key, expectedKey);
    assert.equal(storage.putCalls[0].contentType, "audio/mpeg");
  });

  test("full and preview mp3 keys are distinct (master.mp3 vs preview.mp3)", () => {
    const fullKey = routeMp3KeyForFull({
      userId: track.user_id,
      trackId: track.id,
      versionNum: 1,
    });
    const previewKey = routeMp3KeyForPreview({
      userId: track.user_id,
      trackId: track.id,
      versionNum: 1,
    });
    assert.notEqual(fullKey, previewKey);
    assert.match(fullKey, /\/master\.mp3$/);
    assert.match(previewKey, /\/preview\.mp3$/);
  });

  test("idempotent: skips transcode+upload when the mp3 object already exists", async () => {
    const versionDir = versionDirFor();
    writeValidM4a(path.join(versionDir, "full.m4a"));
    const storage = makeFakeStorage();
    const expectedKey = routeMp3KeyForFull({
      userId: track.user_id,
      trackId: track.id,
      versionNum: trackVersion.version_num,
    });
    storage.forceExists.add(expectedKey);

    const result = await uploadTrackMasterMp3({
      storageProvider: storage,
      versionDir,
      track,
      trackVersion,
      kind: "full",
    });

    assert.equal(result, expectedKey);
    assert.equal(storage.putCalls.length, 0);
  });

  test("non-fatal: transcode/upload failure resolves (does not throw) so render still succeeds", async () => {
    const versionDir = versionDirFor();
    writeValidM4a(path.join(versionDir, "full.m4a"));
    const storage = makeFakeStorage();
    storage.putFile = async () => {
      throw new Error("simulated mp3 upload failure");
    };

    // Must not reject — mp3 is a secondary artifact; the m4a is primary.
    const result = await uploadTrackMasterMp3({
      storageProvider: storage,
      versionDir,
      track,
      trackVersion,
      kind: "full",
    });
    assert.equal(result, null);
  });

  test("missing local audio: no upload attempted, resolves null", async () => {
    const versionDir = versionDirFor();
    const storage = makeFakeStorage();

    const result = await uploadTrackMasterMp3({
      storageProvider: storage,
      versionDir,
      track,
      trackVersion,
      kind: "full",
    });
    assert.equal(result, null);
    assert.equal(storage.putCalls.length, 0);
  });
});
