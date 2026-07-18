"use strict";

function aggregateGiftDeliveryStatus({ gift, channels }) {
  if (!gift) return "not_requested";
  if (gift.delivery_mode === "manual") return "ready_to_share";
  if (gift.dispatch_status === "cancelled") return "cancelled";

  const statuses = (channels || []).map((channel) => channel.status);
  const delivered = statuses.filter((status) => status === "delivered").length;
  const accepted = statuses.filter((status) => status === "accepted").length;
  const failed = statuses.filter((status) =>
    ["failed", "cancelled", "uncertain"].includes(status),
  ).length;

  if (statuses.length > 0 && delivered === statuses.length) return "delivered";
  if (delivered + accepted > 0 && failed > 0) return "partial";
  if (accepted > 0 || gift.status === "dispatching") return "sending";
  if (statuses.length > 0 && failed === statuses.length) {
    return statuses.every((status) => status === "cancelled")
      ? "cancelled"
      : "failed";
  }
  if (gift.status === "failed") return "failed";
  return "scheduled";
}

module.exports = { aggregateGiftDeliveryStatus };
