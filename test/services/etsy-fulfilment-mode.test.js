"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getEtsyFulfilmentMode,
  normalizeEtsyFulfilmentMode,
  runEtsyFulfilmentSweep,
} = require("../../src/services/etsy-fulfilment-mode");

describe("Etsy fulfilment mode", () => {
  it("accepts only the three explicit modes", () => {
    assert.equal(normalizeEtsyFulfilmentMode("off"), "off");
    assert.equal(normalizeEtsyFulfilmentMode("code"), "code");
    assert.equal(normalizeEtsyFulfilmentMode("api"), "api");
    for (const value of [null, true, "CODE", "receipt", "", 1]) {
      assert.equal(normalizeEtsyFulfilmentMode(value), "off");
    }
  });

  it("fails closed when the flag cannot be read", async () => {
    const mode = await getEtsyFulfilmentMode(
      {},
      {
        readFlag: async () => {
          throw new Error("database unavailable");
        },
      },
    );
    assert.equal(mode, "off");
  });

  it("runs neutral artifact repair in every mode and provider work only in api", async () => {
    for (const mode of ["off", "code", "api"]) {
      const calls = [];
      const result = await runEtsyFulfilmentSweep({
        getMode: async () => mode,
        processArtifacts: async () => calls.push("artifacts"),
        processApi: async () => calls.push("api"),
      });
      assert.deepEqual(
        calls,
        mode === "api" ? ["artifacts", "api"] : ["artifacts"],
      );
      assert.equal(result.apiProcessed, mode === "api");
    }
  });
});
