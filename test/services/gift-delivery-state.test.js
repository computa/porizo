"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  aggregateGiftDeliveryStatus,
} = require("../../src/services/gift-delivery-state");

describe("aggregateGiftDeliveryStatus", () => {
  const automaticGift = {
    delivery_mode: "immediate",
    status: "dispatched",
    dispatch_status: "sent",
  };

  test("does not call provider acceptance delivered", () => {
    assert.equal(
      aggregateGiftDeliveryStatus({
        gift: automaticGift,
        channels: [{ status: "accepted" }],
      }),
      "sending",
    );
  });

  test("requires every channel receipt before reporting delivered", () => {
    assert.equal(
      aggregateGiftDeliveryStatus({
        gift: automaticGift,
        channels: [{ status: "delivered" }, { status: "delivered" }],
      }),
      "delivered",
    );
    assert.equal(
      aggregateGiftDeliveryStatus({
        gift: automaticGift,
        channels: [{ status: "delivered" }, { status: "failed" }],
      }),
      "partial",
    );
  });

  test("keeps manual gifts ready to share", () => {
    assert.equal(
      aggregateGiftDeliveryStatus({
        gift: { delivery_mode: "manual", status: "ready_to_share" },
        channels: [],
      }),
      "ready_to_share",
    );
  });
});
