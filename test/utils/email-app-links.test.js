"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APP_LINK_INTENTS,
  buildAppOpenUrl,
  buildDeepLinkFromDownloadIntent,
  buildOpenShareUrlFromShareUrl,
  buildPorizoDeepLink,
  extractShareTarget,
} = require("../../src/utils/email-app-links");

test("buildPorizoDeepLink creates the native create-song route", () => {
  const deepLink = buildPorizoDeepLink(APP_LINK_INTENTS.CREATE_SONG, {
    occasion: "birthday",
    recipient: "Sarah",
  });

  const parsed = new URL(deepLink);
  assert.equal(parsed.protocol, "porizo:");
  assert.equal(parsed.host, "create");
  assert.equal(parsed.searchParams.get("type"), "song");
  assert.equal(parsed.searchParams.get("occasion"), "birthday");
  assert.equal(parsed.searchParams.get("recipient"), "Sarah");
});

test("buildAppOpenUrl emits a /download intent URL with attribution", () => {
  const href = buildAppOpenUrl({
    publicBaseUrl: "https://porizo.co/",
    intent: APP_LINK_INTENTS.CREATE_SONG,
    utm: {
      utm_source: "share_followup",
      utm_medium: "email",
      utm_campaign: "sender_7d",
      utm_content: "start_song_cta",
    },
  });

  const parsed = new URL(href);
  assert.equal(parsed.origin, "https://porizo.co");
  assert.equal(parsed.pathname, "/download");
  assert.equal(parsed.searchParams.get("intent"), "create_song");
  assert.equal(parsed.searchParams.get("utm_campaign"), "sender_7d");
  assert.equal(parsed.searchParams.get("utm_content"), "start_song_cta");
});

test("buildDeepLinkFromDownloadIntent maps validated query params to porizo links", () => {
  assert.equal(
    buildDeepLinkFromDownloadIntent({
      intent: "open_share",
      share_id: "share_abc123",
      content_kind: "poem",
    }),
    "porizo:///poem/share_abc123",
  );

  assert.equal(
    buildDeepLinkFromDownloadIntent({
      intent: "receiver_handoff",
      receiver_handoff_id: "rh_aaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    "porizo:///receiver-handoff/rh_aaaaaaaaaaaaaaaaaaaaaaaa",
  );

  assert.equal(
    buildDeepLinkFromDownloadIntent({
      intent: "open_share",
      share_id: "https://bad.example/share",
    }),
    null,
  );
});

test("extractShareTarget recognizes canonical share and gift URLs", () => {
  assert.deepEqual(extractShareTarget("https://porizo.co/play/sh_1"), {
    shareId: "sh_1",
    contentKind: "song",
  });
  assert.deepEqual(extractShareTarget("https://porizo.co/poem/pm_1"), {
    shareId: "pm_1",
    contentKind: "poem",
  });
  assert.deepEqual(extractShareTarget("https://porizo.co/g/gift_1", "poem"), {
    shareId: "gift_1",
    contentKind: "poem",
  });
});

test("buildOpenShareUrlFromShareUrl produces app-open gift and share CTAs", () => {
  const href = buildOpenShareUrlFromShareUrl({
    publicBaseUrl: "https://porizo.co",
    shareUrl: "https://porizo.co/g/gift_song_1",
    contentKind: "song",
    utm: { utm_source: "gift_email", utm_medium: "email" },
  });

  const parsed = new URL(href);
  assert.equal(parsed.pathname, "/download");
  assert.equal(parsed.searchParams.get("intent"), "open_share");
  assert.equal(parsed.searchParams.get("share_id"), "gift_song_1");
  assert.equal(parsed.searchParams.get("content_kind"), "song");
  assert.equal(parsed.searchParams.get("utm_source"), "gift_email");
});
