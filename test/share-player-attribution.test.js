const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("web player download CTAs use recipient-loop attribution", () => {
  const playerJs = fs.readFileSync(path.join(__dirname, "..", "web-player", "player.js"), "utf8");

  assert.match(playerJs, /utm_source:\s*'share_player'/);
  assert.match(playerJs, /utm_medium:\s*'recipient_loop'/);
  assert.match(playerJs, /utm_campaign:\s*'shared_song_recipient'/);
  assert.match(playerJs, /placement:\s*'post_play'/);
  assert.match(playerJs, /buildReceiverSaveFallbackUrl\('teaser_unlock'\)/);
  assert.match(playerJs, /receiver_save_cta_clicked/);
  assert.doesNotMatch(playerJs, /web-verify/);
  assert.doesNotMatch(playerJs, /requires_pin/);
  assert.doesNotMatch(playerJs, /porizo:\/\/\/play/);
  assert.doesNotMatch(playerJs, /utm_source=webplayer/);
});
