// WebMCP tool registration. Exposes site-level actions to in-browser AI
// agents via navigator.modelContext (Claude in Chrome, Chrome built-in, etc.).
// Pricing tiers come from /data/pricing-tiers.json so the browser surface and
// the server's MCP get-pricing tool stay in sync. Validation rules below
// mirror the server-side rules in src/routes/mcp.js as a UX-layer pre-check;
// the server is the security boundary.

(function () {
  "use strict";

  if (
    typeof navigator === "undefined" ||
    !navigator.modelContext ||
    typeof navigator.modelContext.provideContext !== "function"
  ) {
    return;
  }

  var SAFE_STRING_MAX = 200;
  // JSON Schema-compatible pattern: declares the same constraint as the
  // server's UNSAFE_PATTERN so a JSON-Schema-aware MCP client validates the
  // same way the server's zod schema validates.
  var UNSAFE_PATTERN_STR = "<script|javascript:";
  var UNSAFE_PATTERN_RE = new RegExp(UNSAFE_PATTERN_STR, "i");

  function clean(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    if (!trimmed || trimmed.length > SAFE_STRING_MAX) return "";
    if (UNSAFE_PATTERN_RE.test(trimmed)) return "";
    return trimmed;
  }

  // Schema fragment shared by all 3 string inputs of create-song. Mirrors the
  // server's safeShortString (min 1, max 200, reject unsafe).
  function safeStringSchema(description) {
    return {
      type: "string",
      minLength: 1,
      maxLength: SAFE_STRING_MAX,
      // JSON Schema's `pattern` is implicitly anchored as a search; an
      // input matching this pattern anywhere is rejected upstream by the
      // execute() callback's clean(). Surfacing it here lets a validator
      // pre-reject without round-tripping through execute().
      not: { pattern: UNSAFE_PATTERN_STR },
      description: description,
    };
  }

  var createSongTool = {
    name: "create-song",
    description:
      "Open the Porizo create-song flow with the occasion, recipient name, and personal message prefilled. The user completes voice enrollment and rendering in the iOS app.",
    inputSchema: {
      type: "object",
      required: ["occasion", "recipient", "message"],
      properties: {
        occasion: safeStringSchema("The occasion (birthday, anniversary, etc.)"),
        recipient: safeStringSchema("Recipient's name"),
        message: safeStringSchema("Short personal message"),
      },
    },
    execute: function (input) {
      var occasion = clean(input && input.occasion);
      var recipient = clean(input && input.recipient);
      var message = clean(input && input.message);
      if (!occasion || !recipient || !message) {
        return { ok: false, error: "All inputs are required, must be 1-200 chars, and must not contain <script or javascript: substrings." };
      }
      var params = new URLSearchParams({ occasion: occasion, recipient: recipient, message: message });
      // Same-origin: webmcp.js is only loaded from /, so a relative URL is
      // correct on porizo.co, on staging hosts, and in local dev.
      var url = "/?" + params.toString();
      try {
        window.location.href = url;
      } catch (err) {
        // Navigation can be blocked by CSP frame-ancestors, sandbox, etc.
        // Surface failure so the agent can present the URL to the user instead.
        return { ok: false, error: "navigation_blocked", deep_link: url };
      }
      return { ok: true, deep_link: url };
    },
  };

  function buildGetPricingTool(pricing) {
    return {
      name: "get-pricing",
      description: "Return the publicly available Porizo plan tiers (free and premium). Prices are in USD.",
      inputSchema: { type: "object", properties: {} },
      execute: function () {
        return pricing;
      },
    };
  }

  function provide(tools) {
    try {
      navigator.modelContext.provideContext({ tools: tools });
    } catch (err) {
      // Provider rejected our schema or threw. Don't block the page, but leave a breadcrumb
      // so a developer can debug "why doesn't my browser see the tools?".
      try { console.warn("[webmcp] provideContext rejected:", err); } catch (_e) { /* noop */ }
    }
  }

  // Register both tools synchronously with a placeholder pricing payload so
  // agents that list tools before the fetch resolves don't see a registration
  // gap. Re-register with the real prices once the fetch resolves.
  var placeholderPricing = { currency: "USD", tiers: [], loading: true };
  provide([createSongTool, buildGetPricingTool(placeholderPricing)]);

  function fetchPricing() {
    try {
      return fetch("/data/pricing-tiers.json", { credentials: "omit" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .catch(function (err) {
          try { console.warn("[webmcp] pricing fetch failed:", err); } catch (_e) { /* noop */ }
          return { currency: "USD", tiers: [] };
        });
    } catch (err) {
      // fetch may not exist in very old browsers — fall back to empty list.
      try { console.warn("[webmcp] fetch unavailable:", err); } catch (_e) { /* noop */ }
      return Promise.resolve({ currency: "USD", tiers: [] });
    }
  }

  fetchPricing().then(function (pricing) {
    provide([createSongTool, buildGetPricingTool(pricing)]);
  });
})();
