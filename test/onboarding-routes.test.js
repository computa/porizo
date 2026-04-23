const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  loadOnboardingGraph,
  getOnboardingGraphPathCandidates,
  generateTemplateSuggestion,
} = require("../src/routes/onboarding");

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
      path.join(process.cwd(), "src", "routes", "..", "resources", "onboarding-graph.json")
    );
  });

  it("generates deterministic onboarding suggestions", () => {
    const suggestion = generateTemplateSuggestion({
      recipient_name: "Sarah",
      relationship_type: "mom",
      emotional_seed: "thank_you_everything",
      occasion: "birthday",
    });

    assert.equal(suggestion.title, "Birthday Song for Sarah");
    assert.equal(suggestion.source, "template");
    assert.match(suggestion.preview_line, /Sarah/);
  });
});
