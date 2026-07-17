const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  loadOnboardingGraph,
  getOnboardingGraphPathCandidates,
  generateTemplateSuggestion,
  buildSongTitle,
} = require("../src/routes/onboarding");

describe("buildSongTitle", () => {
  it("composes occasion + recipient + sender", () => {
    assert.equal(
      buildSongTitle({
        recipientName: "Chioma",
        occasionLabel: "Thank You",
        senderFirstName: "Ambrose",
      }),
      "A Thank You Song for Chioma by Ambrose",
    );
  });

  it("does not double 'Song' when the occasion label already ends in Song", () => {
    // i_love_you formats to "Love Song" — must not become "A Love Song Song…".
    assert.equal(
      buildSongTitle({ recipientName: "Chioma", occasionLabel: "Love Song" }),
      "A Love Song for Chioma",
    );
  });

  it("omits the occasion clause when there is none", () => {
    assert.equal(
      buildSongTitle({ recipientName: "Chioma", occasionLabel: null }),
      "A Song for Chioma",
    );
  });

  it("omits the sender clause when there is none", () => {
    assert.equal(
      buildSongTitle({ recipientName: "Chioma", occasionLabel: "Birthday" }),
      "A Birthday Song for Chioma",
    );
  });
});

describe("onboarding routes", () => {
  it("loads the server-owned onboarding graph", async () => {
    const graph = await loadOnboardingGraph();

    assert.equal(graph.version, 1);
    assert.equal(graph.entry_node, "pain_points");
    assert.ok(graph.nodes.pain_points);
    assert.ok(graph.nodes.payoff);
  });

  it("prefers the backend resource path first", () => {
    const candidates = getOnboardingGraphPathCandidates();

    assert.equal(
      candidates[0],
      path.join(
        process.cwd(),
        "src",
        "routes",
        "..",
        "resources",
        "onboarding-graph.json",
      ),
    );
  });

  it("generates deterministic onboarding suggestions", () => {
    const suggestion = generateTemplateSuggestion({
      recipient_name: "Sarah",
      relationship_type: "mom",
      emotional_seed: "thank_you_everything",
      occasion: "birthday",
    });

    assert.equal(suggestion.title, "A Birthday Song for Sarah");
    assert.equal(suggestion.source, "template");
    assert.match(suggestion.preview_line, /Sarah/);
  });

  it("renders mothers_day with proper apostrophe + casing", () => {
    const suggestion = generateTemplateSuggestion({
      recipient_name: "Chioma",
      relationship_type: "partner",
      emotional_seed: "first_met",
      occasion: "mothers_day",
      sender_name: "Ambrose",
    });
    assert.equal(suggestion.title, "A Mother's Day Song for Chioma by Ambrose");
    assert.equal(suggestion.source, "template");
    assert.match(suggestion.preview_line, /Chioma/);
  });

  it("appends 'by {FirstName}' when sender_name is provided", () => {
    const suggestion = generateTemplateSuggestion({
      recipient_name: "Chioma",
      relationship_type: "partner",
      emotional_seed: "first_met",
      occasion: "birthday",
      sender_name: "Ambrose Obimma",
    });
    assert.equal(suggestion.title, "A Birthday Song for Chioma by Ambrose");
  });

  it("omits the 'by' attribution when sender_name is missing or blank", () => {
    const noSender = generateTemplateSuggestion({
      recipient_name: "Chioma",
      relationship_type: "partner",
      emotional_seed: "first_met",
      occasion: "birthday",
    });
    assert.equal(noSender.title, "A Birthday Song for Chioma");

    const blankSender = generateTemplateSuggestion({
      recipient_name: "Chioma",
      relationship_type: "partner",
      emotional_seed: "first_met",
      occasion: "birthday",
      sender_name: "   ",
    });
    assert.equal(blankSender.title, "A Birthday Song for Chioma");
  });

  it("drops the occasion phrase when no occasion is provided", () => {
    const suggestion = generateTemplateSuggestion({
      recipient_name: "Chioma",
      relationship_type: "partner",
      emotional_seed: "first_met",
      occasion: null,
      sender_name: "Ambrose",
    });
    assert.equal(suggestion.title, "A Song for Chioma by Ambrose");
  });
});
