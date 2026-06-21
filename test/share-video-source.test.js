const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveShareVideoAudio,
  SHARE_TEASER_MAX_SECONDS,
} = require("../src/media/share-video-source");
const fakeFs = (present) => ({ existsSync: (p) => present.includes(p) });

describe("resolveShareVideoAudio", () => {
  it("uses preview.m4a when present and caps duration to 15s", () => {
    const r = resolveShareVideoAudio({
      versionDir: "/v",
      fs: fakeFs(["/v/preview.m4a"]),
    });
    assert.equal(r.audioPath, "/v/preview.m4a");
    assert.equal(r.maxSeconds, SHARE_TEASER_MAX_SECONDS);
    assert.equal(SHARE_TEASER_MAX_SECONDS, 15);
  });
  it("NEVER selects full.m4a even when it is the only local file", () => {
    const r = resolveShareVideoAudio({
      versionDir: "/v",
      fs: fakeFs(["/v/full.m4a"]),
    });
    assert.equal(r.audioPath, null);
  });
  it("returns null audioPath when no preview exists locally", () => {
    const r = resolveShareVideoAudio({ versionDir: "/v", fs: fakeFs([]) });
    assert.equal(r.audioPath, null);
  });
});
