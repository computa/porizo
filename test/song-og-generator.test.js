const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  generateSongArtworkPreviewImage,
} = require("../src/services/song-og-generator");

test("generateSongArtworkPreviewImage returns artwork-first landscape preview", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-og-"));
  const coverPath = path.join(dir, "artwork.jpg");
  try {
    await sharp({
      create: {
        width: 900,
        height: 1350,
        channels: 3,
        background: { r: 238, g: 185, b: 178 },
      },
    })
      .jpeg()
      .toFile(coverPath);

    const output = await generateSongArtworkPreviewImage({
      coverPath,
      width: 1200,
      height: 630,
    });

    assert.ok(Buffer.isBuffer(output));
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
    assert.equal(metadata.format, "jpeg");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generateSongArtworkPreviewImage returns null without artwork", async () => {
  const output = await generateSongArtworkPreviewImage({
    coverPath: null,
    width: 1200,
    height: 630,
  });

  assert.equal(output, null);
});
