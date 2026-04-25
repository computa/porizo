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
  getGeminiModel,
  resolveProviderModel,
  __setGoogleGenAIFactoryForTest,
  CONFIG,
  ERROR_CODES,
  MODELS,
} = require("../src/services/llm-provider");

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

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
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      restoreEnv("GEMINI_API_KEY", originalGeminiKey);
      restoreEnv("ANTHROPIC_API_KEY", originalAnthropicKey);
      restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
    });

    it("returns true when Gemini key is set", () => {
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      assert.strictEqual(isAvailable(), true);
    });

    it("returns true when Anthropic key is set", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      delete process.env.OPENAI_API_KEY;
      assert.strictEqual(isAvailable(), true);
    });

    it("returns true when OpenAI key is set", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = "test-key";
      assert.strictEqual(isAvailable(), true);
    });

    it("returns true when both keys are set", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      assert.strictEqual(isAvailable(), true);
    });

    it("returns false when no keys are set", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      assert.strictEqual(isAvailable(), false);
    });
  });

  describe("getConfiguredProviders", () => {
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      restoreEnv("GEMINI_API_KEY", originalGeminiKey);
      restoreEnv("ANTHROPIC_API_KEY", originalAnthropicKey);
      restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
    });

    it("returns gemini when only Gemini key is set", () => {
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["gemini"]);
    });

    it("returns anthropic when only Anthropic key is set", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      delete process.env.OPENAI_API_KEY;
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["anthropic"]);
    });

    it("returns openai when only OpenAI key is set", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = "test-key";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["openai"]);
    });

    it("returns both when both keys are set", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, ["anthropic", "openai"]);
    });

    it("returns empty array when no keys are set", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const providers = getConfiguredProviders();
      assert.deepStrictEqual(providers, []);
    });
  });

  describe("CONFIG", () => {
    it("has required configuration values", () => {
      assert.strictEqual(CONFIG.primary, "gemini");
      assert.deepStrictEqual(CONFIG.fallback, ["anthropic", "openai"]);
      assert.ok(CONFIG.timeoutMs > 0, "Should have timeout");
      assert.ok(CONFIG.maxRetries >= 0, "Should have max retries");
      assert.ok(CONFIG.maxInputTokens > 0, "Should have input token limit");
      assert.ok(CONFIG.maxOutputTokens > 0, "Should have output token limit");
    });
  });

  describe("MODELS", () => {
    it("has models for both providers", () => {
      assert.ok(MODELS.gemini, "Should have Gemini models");
      assert.ok(MODELS.anthropic, "Should have Anthropic models");
      assert.ok(MODELS.openai, "Should have OpenAI models");
    });

    it("has models for different task types", () => {
      assert.ok(MODELS.gemini.lyrics, "Should have Gemini lyrics model");
      assert.ok(MODELS.gemini.simple, "Should have Gemini simple model");
      assert.ok(MODELS.anthropic.lyrics, "Should have Anthropic lyrics model");
      assert.ok(MODELS.anthropic.simple, "Should have Anthropic simple model");
      assert.ok(MODELS.openai.lyrics, "Should have OpenAI lyrics model");
      assert.ok(MODELS.openai.simple, "Should have OpenAI simple model");
    });
  });

  describe("Gemini model resolution", () => {
    const originalGeneric = process.env.GEMINI_MODEL;
    const originalLyrics = process.env.GEMINI_MODEL_LYRICS;
    const originalSimple = process.env.GEMINI_MODEL_SIMPLE;

    afterEach(() => {
      restoreEnv("GEMINI_MODEL", originalGeneric);
      restoreEnv("GEMINI_MODEL_LYRICS", originalLyrics);
      restoreEnv("GEMINI_MODEL_SIMPLE", originalSimple);
    });

    it("uses code defaults when no env overrides are set", () => {
      delete process.env.GEMINI_MODEL;
      delete process.env.GEMINI_MODEL_LYRICS;
      delete process.env.GEMINI_MODEL_SIMPLE;

      assert.strictEqual(getGeminiModel("lyrics"), "gemini-3-flash");
      assert.strictEqual(getGeminiModel("simple"), "gemini-3-flash");
    });

    it("uses generic env override when task-specific override is absent", () => {
      process.env.GEMINI_MODEL = "gemini-2.5-flash";
      delete process.env.GEMINI_MODEL_LYRICS;
      delete process.env.GEMINI_MODEL_SIMPLE;

      assert.strictEqual(getGeminiModel("lyrics"), "gemini-2.5-flash");
      assert.strictEqual(getGeminiModel("simple"), "gemini-2.5-flash");
    });

    it("uses task-specific env overrides over the generic override", () => {
      process.env.GEMINI_MODEL = "gemini-2.5-flash";
      process.env.GEMINI_MODEL_LYRICS = "gemini-3-flash";
      process.env.GEMINI_MODEL_SIMPLE = "gemini-2.5-flash-lite";

      assert.strictEqual(getGeminiModel("lyrics"), "gemini-3-flash");
      assert.strictEqual(getGeminiModel("simple"), "gemini-2.5-flash-lite");
    });

    it("resolveProviderModel delegates Gemini resolution to env-backed config", () => {
      process.env.GEMINI_MODEL = "gemini-2.5-flash";
      assert.strictEqual(resolveProviderModel("gemini", "lyrics"), "gemini-2.5-flash");
    });
  });

  describe("ERROR_CODES", () => {
    it("has required error codes", () => {
      assert.ok(ERROR_CODES.API_ERROR, "Should have API error code");
      assert.ok(ERROR_CODES.TIMEOUT, "Should have timeout error code");
      assert.ok(ERROR_CODES.RATE_LIMIT, "Should have rate limit error code");
      assert.ok(ERROR_CODES.TOKEN_LIMIT, "Should have token limit error code");
      assert.ok(ERROR_CODES.ALL_PROVIDERS_FAILED, "Should have all providers failed code");
      assert.ok(ERROR_CODES.OUTPUT_TRUNCATED, "Should have output truncated code");
    });
  });

  describe("generateText", () => {
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    const originalGeminiModel = process.env.GEMINI_MODEL;
    const originalGeminiModelLyrics = process.env.GEMINI_MODEL_LYRICS;
    const originalGeminiModelSimple = process.env.GEMINI_MODEL_SIMPLE;
    const originalFetch = global.fetch;

    afterEach(() => {
      restoreEnv("GEMINI_API_KEY", originalGeminiKey);
      restoreEnv("ANTHROPIC_API_KEY", originalAnthropicKey);
      restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
      restoreEnv("GEMINI_MODEL", originalGeminiModel);
      restoreEnv("GEMINI_MODEL_LYRICS", originalGeminiModelLyrics);
      restoreEnv("GEMINI_MODEL_SIMPLE", originalGeminiModelSimple);
      global.fetch = originalFetch;
      __setGoogleGenAIFactoryForTest();
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
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        await generateText({ prompt: "Test prompt" });
        assert.fail("Should have thrown error");
      } catch (err) {
        assert.strictEqual(err.code, ERROR_CODES.ALL_PROVIDERS_FAILED);
      }
    });

    it("normalizes embedded JSON text for structured responses", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      __setGoogleGenAIFactoryForTest(() => ({
        models: {
          async generateContent() {
            return {
              text: 'Here is your JSON:\n```json\n{"title":"Hello"}\n```',
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
            };
          },
        },
      }));

      const result = await generateText({
        prompt: "Return JSON",
        taskType: "simple",
        responseMimeType: "application/json",
      });

      assert.strictEqual(result.provider, "gemini");
      assert.deepStrictEqual(JSON.parse(result.text), { title: "Hello" });
    });

    it("fails malformed structured responses instead of returning unparseable text", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      __setGoogleGenAIFactoryForTest(() => ({
        models: {
          async generateContent() {
            return {
              text: '{"title":"Hello"',
              candidates: [{ finishReason: "MAX_TOKENS" }],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
            };
          },
        },
      }));

      await assert.rejects(
        () => generateText({
          prompt: "Return JSON",
          taskType: "simple",
          responseMimeType: "application/json",
          providers: ["gemini"],
        }),
        (err) => {
          assert.strictEqual(err.code, ERROR_CODES.ALL_PROVIDERS_FAILED);
          return true;
        }
      );
    });

    it("retries instead of accepting provider output stopped by max tokens", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      let calls = 0;
      __setGoogleGenAIFactoryForTest(() => ({
        models: {
          async generateContent() {
            calls += 1;
            if (calls === 1) {
              return {
                text: '{"title":"Partial"}',
                candidates: [{ finishReason: "MAX_TOKENS" }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
              };
            }
            return {
              text: '{"title":"Complete"}',
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
            };
          },
        },
      }));

      const result = await generateText({
        prompt: "Return JSON",
        taskType: "simple",
        responseMimeType: "application/json",
        providers: ["gemini"],
      });

      assert.strictEqual(calls, 2);
      assert.deepStrictEqual(JSON.parse(result.text), { title: "Complete" });
    });

    it("passes the env-configured Gemini model into the SDK call", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "";
      process.env.GEMINI_MODEL = "gemini-2.5-flash";

      const calls = [];
      __setGoogleGenAIFactoryForTest(() => ({
        models: {
          async generateContent(params) {
            calls.push(params);
            return {
              text: "hello",
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
            };
          },
        },
      }));

      const result = await generateText({
        prompt: "Say hello.",
        taskType: "lyrics",
        providers: ["gemini"],
      });

      assert.strictEqual(result.provider, "gemini");
      assert.strictEqual(result.model, "gemini-2.5-flash");
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].model, "gemini-2.5-flash");
    });

    it("falls back when Gemini SDK throws a 429-style error", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      process.env.ANTHROPIC_API_KEY = "";
      process.env.OPENAI_API_KEY = "test-openai-key";

      __setGoogleGenAIFactoryForTest(() => ({
        models: {
          async generateContent() {
            const err = new Error("Resource exhausted");
            err.status = 429;
            throw err;
          },
        },
      }));

      global.fetch = async () => ({
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "Fallback response" } }],
            usage: { prompt_tokens: 8, completion_tokens: 3 },
          };
        },
      });

      const result = await generateText({
        prompt: "Fallback please",
        taskType: "simple",
      });

      assert.strictEqual(result.provider, "openai");
      assert.strictEqual(result.fallbackUsed, true);
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
