const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppLinkService } = require("../src/services/app-link-service");

test("builds AppsFlyer OneLink with receiver handoff instead of playable share id", () => {
  const service = createAppLinkService({
    publicBaseUrl: "https://porizo.co",
    appsFlyerOneLinkBaseUrl: "https://porizo.onelink.me/abcd",
  });
  const url = new URL(service.buildReceiverSaveUrl({
    shareId: "sh_123",
    receiverSessionId: "rs_123",
    receiverHandoffId: "rh_123",
    contentKind: "song",
    placement: "post_play",
  }));

  assert.equal(url.origin + url.pathname, "https://porizo.onelink.me/abcd");
  assert.equal(url.searchParams.get("deep_link_value"), "rh_123");
  assert.equal(url.searchParams.get("deep_link_sub1"), "rs_123");
  assert.equal(url.searchParams.get("deep_link_sub2"), "song");
  assert.equal(url.searchParams.get("deep_link_sub3"), "post_play");
  assert.equal(url.searchParams.get("pid"), "share_receiver");
});

test("falls back to /download when AppsFlyer is not configured", () => {
  const service = createAppLinkService({ publicBaseUrl: "https://porizo.co" });
  const url = new URL(service.buildReceiverSaveUrl({
    shareId: "sh_123",
    receiverSessionId: "rs_123",
    receiverHandoffId: "rh_123",
    contentKind: "song",
    placement: "post_play",
  }));

  assert.equal(url.origin, "https://porizo.co");
  assert.equal(url.pathname, "/download");
  assert.equal(url.searchParams.get("deep_link"), "porizo:///receiver-handoff/rh_123");
  assert.equal(url.searchParams.get("receiver_session_id"), "rs_123");
});

test("falls back to generic /download when AppsFlyer is configured but handoff is missing", () => {
  const service = createAppLinkService({
    publicBaseUrl: "https://porizo.co",
    appsFlyerOneLinkBaseUrl: "https://porizo.onelink.me/abcd",
  });
  const url = new URL(service.buildReceiverSaveUrl({
    shareId: "sh_123",
    receiverSessionId: "rs_123",
    contentKind: "song",
  }));

  assert.equal(url.origin, "https://porizo.co");
  assert.equal(url.pathname, "/download");
  assert.equal(url.searchParams.has("deep_link"), false);
});
