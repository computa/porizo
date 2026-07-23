"use strict";

const { getFeatureFlag } = require("./feature-flags");

const ETSY_FULFILMENT_MODES = Object.freeze(["off", "code", "api"]);
const ETSY_FULFILMENT_MODE_FLAG = "etsy_fulfilment_mode";

function normalizeEtsyFulfilmentMode(value) {
  return ETSY_FULFILMENT_MODES.includes(value) ? value : "off";
}

async function getEtsyFulfilmentMode(
  db,
  { readFlag = getFeatureFlag } = {},
) {
  try {
    return normalizeEtsyFulfilmentMode(
      await readFlag(db, ETSY_FULFILMENT_MODE_FLAG, {
        throwOnError: true,
      }),
    );
  } catch {
    return "off";
  }
}

async function runEtsyFulfilmentSweep({
  db,
  getMode = () => getEtsyFulfilmentMode(db),
  processArtifacts,
  processApi,
}) {
  await processArtifacts();
  if ((await getMode()) === "api") {
    await processApi();
    return { apiProcessed: true };
  }
  return { apiProcessed: false };
}

module.exports = {
  ETSY_FULFILMENT_MODES,
  ETSY_FULFILMENT_MODE_FLAG,
  getEtsyFulfilmentMode,
  normalizeEtsyFulfilmentMode,
  runEtsyFulfilmentSweep,
};
