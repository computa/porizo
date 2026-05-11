"use strict";

function createAppLinkService({ publicBaseUrl, appsFlyerOneLinkBaseUrl }) {
  function buildReceiverSaveUrl({
    shareId: _shareId,
    receiverSessionId,
    receiverHandoffId,
    contentKind = "song",
    placement = "post_play",
  }) {
    const kind = contentKind === "poem" ? "poem" : "song";
    if (appsFlyerOneLinkBaseUrl && receiverHandoffId) {
      const url = new URL(appsFlyerOneLinkBaseUrl);
      url.searchParams.set("pid", "share_receiver");
      url.searchParams.set("c", "shared_gift_receiver");
      url.searchParams.set("deep_link_value", receiverHandoffId);
      url.searchParams.set("deep_link_sub1", receiverSessionId || "");
      url.searchParams.set("deep_link_sub2", kind);
      url.searchParams.set("deep_link_sub3", placement);
      url.searchParams.set("af_xp", "custom");
      return url.toString();
    }

    const fallback = new URL("/download", publicBaseUrl);
    fallback.searchParams.set("channel", "appstore");
    if (receiverHandoffId) {
      fallback.searchParams.set("deep_link", `porizo:///receiver-handoff/${receiverHandoffId}`);
    }
    fallback.searchParams.set("receiver_session_id", receiverSessionId || "");
    fallback.searchParams.set("utm_source", "share_player");
    fallback.searchParams.set("utm_medium", "receiver_loop");
    fallback.searchParams.set("utm_campaign", "shared_gift_receiver");
    fallback.searchParams.set("utm_content", `${kind}_${placement}`);
    return fallback.toString();
  }

  return { buildReceiverSaveUrl };
}

module.exports = { createAppLinkService };
