const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractPolicyTermsFromMessage,
  expandPolicyTermVariants,
} = require("../../src/utils/policy-terms");

describe("policy term extraction", () => {
  test("extracts blocked terms from quoted/list provider messages", () => {
    const message =
      'E302_SUNO_POLICY_ERROR: Generation failed - blocked words: "drake", "metro boomin"';
    const terms = extractPolicyTermsFromMessage(message);

    assert.deepEqual(terms, ["drake", "metro boomin"]);
  });

  test("extracts terms from json-like payload fragments", () => {
    const message =
      '{"error":"sensitive_word_error","terms":["future","taylorswift"],"detail":"policy rejected"}';
    const terms = extractPolicyTermsFromMessage(message);

    assert.deepEqual(terms, ["future", "taylorswift"]);
  });

  test("extracts producer tag term and expands merged number words", () => {
    const message = "provider rejected: producer tag twentythree is not allowed";
    const extracted = extractPolicyTermsFromMessage(message);
    const variants = extracted.flatMap((term) => expandPolicyTermVariants(term));

    assert.ok(extracted.includes("twentythree"));
    assert.ok(variants.includes("23"));
    assert.ok(variants.includes("twenty three"));
  });

  test("returns no terms for generic policy failures", () => {
    const message =
      "Music generation failed due to provider content policy. Please adjust the lyrics and try again.";

    assert.deepEqual(extractPolicyTermsFromMessage(message), []);
  });
});
