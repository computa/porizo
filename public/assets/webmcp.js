// WebMCP tool registration for porizo.co.
// Exposes site-level actions to in-browser AI agents (Claude in Chrome,
// Chrome built-in agents, etc.) via the navigator.modelContext API.
// Silent no-op when navigator.modelContext is not present.

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
  var UNSAFE_PATTERN = /<script|javascript:/i;

  function clean(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    if (!trimmed || trimmed.length > SAFE_STRING_MAX) return "";
    if (UNSAFE_PATTERN.test(trimmed)) return "";
    return trimmed;
  }

  var pricingTiers = [
    {
      id: "free",
      name: "Free",
      price_monthly_usd: 0,
      price_annual_usd: 0,
      description: "Start free. Limited previews and shareable songs.",
    },
    {
      id: "premium_monthly",
      name: "Premium (monthly)",
      price_monthly_usd: 9.99,
      price_annual_usd: null,
      description: "Full access to song and poem creation, more previews per day, voice enrollment.",
    },
    {
      id: "premium_annual",
      name: "Premium (annual)",
      price_monthly_usd: null,
      price_annual_usd: 99.0,
      description: "All Premium features billed annually for the lower effective monthly rate.",
    },
  ];

  try {
    navigator.modelContext.provideContext({
      tools: [
        {
          name: "create-song",
          description:
            "Open the Porizo create-song flow with the occasion, recipient name, and personal message prefilled. The user completes voice enrollment and rendering in the iOS app.",
          inputSchema: {
            type: "object",
            required: ["occasion", "recipient", "message"],
            properties: {
              occasion: { type: "string", maxLength: SAFE_STRING_MAX, description: "The occasion (birthday, anniversary, etc.)" },
              recipient: { type: "string", maxLength: SAFE_STRING_MAX, description: "Recipient's name" },
              message: { type: "string", maxLength: SAFE_STRING_MAX, description: "Short personal message" },
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
            var url = "https://porizo.co/?" + params.toString();
            try {
              window.location.href = url;
            } catch (_e) {
              /* noop */
            }
            return { ok: true, deep_link: url };
          },
        },
        {
          name: "get-pricing",
          description: "Return the publicly available Porizo plan tiers (free and premium). Prices are in USD.",
          inputSchema: { type: "object", properties: {} },
          execute: function () {
            return { currency: "USD", tiers: pricingTiers };
          },
        },
      ],
    });
  } catch (_err) {
    // Provider rejected our schema or threw — silent failure beats blocking the page.
  }
})();
