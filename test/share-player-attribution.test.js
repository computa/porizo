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
  assert.match(playerJs, /placement:\s*'teaser_unlock'/);
  assert.match(playerJs, /placement:\s*'app_bar_android'/);
  assert.doesNotMatch(playerJs, /utm_source=webplayer/);
});
