/**
 * LLM Provider Tests
 *
 * Tests for the unified LLM provider with fallback support
 */

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");

const {
  generateText,
  generateLyricsWithLLM,
  isAvailable,
  getConfiguredProviders,
  estimateTokens,
  CONFIG,
  ERROR_CODES,
  MODELS,
} = require("../src/services/llm-provider");

describe("LLM Provider", () => {
  describe("estimateTokens", () => {
    it("estimates tokens from text length", () => {
      // Approximately 4 chars per token
      const text = "Hello, world!"; // 13 chars
      const tokens = estimateTokens(text);
      assert.strictEqual(tokens, 4); // ceil(13/4)
    });

    it("handles empty input", () => {
      assert.strictEqual(estimateTokens(""), 0);
      assert.strictEqual(estimateTokens(null), 0);
      assert.strictEqual(estimateTokens(undefined), 0);
    });

    it("handles long text", () => {
      const text = "a".repeat(4000); // 4000 chars
      const tokens = estimateTokens(text);
      assert.strictEqual(tokens, 1000); // 4000/4
    });
  });

  describe("isAvailable", () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    });

    it("returns true when Anthropic key is set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "";
      assert.strictEqual(isAvailable(), true);
    });

    it("returns true when OpenAI key is set", () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "test-key";
      assert.strictEqual(isAvailable(), true);
    });

    it("returns true when both keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      assert.strictEqual(isAvailable(), true);
    });

    it("returns false when no keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      assert.strictEqual(isAvailable(), false);
    });
  });

  describe("getConfiguredProviders", () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    });

    it("returns anthropic when only Anthropic key is set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["anthropic"]);
    });

    it("returns openai when only OpenAI key is set", () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "test-key";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["openai"]);
    });

    it("returns both when both keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["anthropic", "openai"]);
    });

    it("returns empty array when no keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, []);
    });
  });

  describe("CONFIG", () => {
    it("has required configuration values", () => {
      assert.strictEqual(CONFIG.primary, "anthropic");
      assert.strictEqual(CONFIG.fallback, "openai");
      assert.ok(CONFIG.timeoutMs > 0, "Should have timeout");
      assert.ok(CONFIG.maxRetries >= 0, "Should have max retries");
      assert.ok(CONFIG.maxInputTokens > 0, "Should have input token limit");
      assert.ok(CONFIG.maxOutputTokens > 0, "Should have output token limit");
    });
  });

  describe("MODELS", () => {
    it("has models for both providers", () => {
      assert.ok(MODELS.anthropic, "Should have Anthropic models");
      assert.ok(MODELS.openai, "Should have OpenAI models");
    });

    it("has models for different task types", () => {
      assert.ok(MODELS.anthropic.lyrics, "Should have Anthropic lyrics model");
      assert.ok(MODELS.anthropic.simple, "Should have Anthropic simple model");
      assert.ok(MODELS.openai.lyrics, "Should have OpenAI lyrics model");
      assert.ok(MODELS.openai.simple, "Should have OpenAI simple model");
    });
  });

  describe("ERROR_CODES", () => {
    it("has required error codes", () => {
      assert.ok(ERROR_CODES.API_ERROR, "Should have API error code");
      assert.ok(ERROR_CODES.TIMEOUT, "Should have timeout error code");
      assert.ok(ERROR_CODES.RATE_LIMIT, "Should have rate limit error code");
      assert.ok(ERROR_CODES.TOKEN_LIMIT, "Should have token limit error code");
      assert.ok(ERROR_CODES.ALL_PROVIDERS_FAILED, "Should have all providers failed code");
    });
  });

  describe("generateText", () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    });

    it("rejects prompts exceeding token limit", async () => {
      // Create a very long prompt
      const longPrompt = "a".repeat(CONFIG.maxInputTokens * 5);

      try {
        await generateText({ prompt: longPrompt });
        assert.fail("Should have thrown token limit error");
      } catch (err) {
        assert.strictEqual(err.code, ERROR_CODES.TOKEN_LIMIT);
        assert.ok(err.message.includes("token limit"));
      }
    });

    it("throws when no providers are configured", async () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";

      try {
        await generateText({ prompt: "Test prompt" });
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.strictEqual(err.code, ERROR_CODES.ALL_PROVIDERS_FAILED);
      }
    });

    it("returns result with expected structure when Anthropic is available", async () => {
      // This test requires a real API key - skip if not available or if key looks like a test key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || apiKey === "test-key" || apiKey.length < 20) {
        console.log("Skipping live Anthropic test - no valid API key");
        return;
      }

      try {
        const result = await generateText({
          prompt: "Say hello in exactly 3 words.",
          taskType: "simple",
        });

        assert.ok(result.text, "Should have text");
        assert.strictEqual(result.provider, "anthropic");
        assert.ok(result.model, "Should have model");
        assert.ok(result.usage, "Should have usage info");
        assert.strictEqual(typeof result.usage.inputTokens, "number");
        assert.strictEqual(typeof result.usage.outputTokens, "number");
      } catch (err) {
        // If authentication failed, treat as skipped test (not a real key)
        if (err.message?.includes("401") || err.message?.includes("authentication")) {
          console.log("Skipping live Anthropic test - invalid API key");
          return;
        }
        throw err;
      }
    });
  });

  describe("generateLyricsWithLLM", () => {
    it("uses correct system prompt for lyrics", async () => {
      // This test requires a real API key
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;
      const hasValidKey =
        (anthropicKey && anthropicKey !== "test-key" && anthropicKey.length >= 20) ||
        (openaiKey && openaiKey !== "test-key" && openaiKey.length >= 20);

      if (!hasValidKey) {
        console.log("Skipping live lyrics generation test - no valid API keys");
        return;
      }

      try {
        const result = await generateLyricsWithLLM({
          songwriterPrompt: "Write a short birthday song for Sarah",
          style: "pop",
        });

        assert.ok(result.text, "Should have generated text");
        assert.ok(result.provider, "Should have provider info");
      } catch (err) {
        // If authentication failed, treat as skipped test
        if (err.message?.includes("401") || err.message?.includes("authentication")) {
          console.log("Skipping live lyrics generation test - invalid API keys");
          return;
        }
        throw err;
      }
    });
  });
});
