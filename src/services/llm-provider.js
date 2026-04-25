/**
 * LLM Provider Service
 *
 * Provides a unified interface for text generation with:
 * - Primary provider: Gemini via @google/genai
 * - Fallback providers: Anthropic (Claude Sonnet), then OpenAI (GPT-4o)
 * - Cost guardrails: Token limits per request, usage tracking
 * - Error handling: Automatic fallback with retry logic
 */

const Anthropic = require("@anthropic-ai/sdk");
const { GoogleGenAI } = require("@google/genai");

// Provider configuration
const CONFIG = {
  primary: "gemini",
  fallback: ["anthropic", "openai"],
  timeoutMs: 30000,
  maxRetries: 2,
  retryDelayMs: 1000,
  // Token limits (cost guardrails)
  // Gemini Flash models support long-context creative prompting.
  // 6000 input tokens gives writer/reasoner headroom for long story contexts.
  maxInputTokens: 6000,
  maxOutputTokens: 2000,
};

// Default model selection for different use cases.
// Gemini defaults are env-overridable via:
// - GEMINI_MODEL_LYRICS / GEMINI_MODEL_SIMPLE
// - GEMINI_MODEL
const MODELS = {
  gemini: {
    lyrics: "gemini-3-flash",
    simple: "gemini-3-flash",
  },
  anthropic: {
    lyrics: "claude-sonnet-4-20250514", // Higher quality for creative tasks
    simple: "claude-3-haiku-20240307", // Faster/cheaper for simple tasks
  },
  openai: {
    lyrics: "gpt-4o", // Fallback for creative tasks
    simple: "gpt-4o-mini", // Fallback for simple tasks
  },
};

// Error codes
const ERROR_CODES = {
  API_ERROR: "E301_LLM_API_ERROR",
  TIMEOUT: "E302_LLM_TIMEOUT",
  RATE_LIMIT: "E303_LLM_RATE_LIMIT",
  TOKEN_LIMIT: "E304_TOKEN_LIMIT_EXCEEDED",
  ALL_PROVIDERS_FAILED: "E305_ALL_PROVIDERS_FAILED",
  OUTPUT_TRUNCATED: "E306_LLM_OUTPUT_TRUNCATED",
};

let googleGenAIFactory = (options) => new GoogleGenAI(options);
let cachedGeminiClient = null;
let cachedGeminiApiKey = null;

function getGeminiModel(taskType = "lyrics") {
  const normalizedTask = String(taskType || "lyrics").trim().toUpperCase();
  const taskOverride = process.env[`GEMINI_MODEL_${normalizedTask}`];
  if (taskOverride && taskOverride.trim()) {
    return taskOverride.trim();
  }
  if (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim()) {
    return process.env.GEMINI_MODEL.trim();
  }
  return MODELS.gemini[taskType] || MODELS.gemini.lyrics;
}

function getGeminiClient(apiKey) {
  if (!apiKey) return null;
  if (!cachedGeminiClient || cachedGeminiApiKey !== apiKey) {
    cachedGeminiClient = googleGenAIFactory({ apiKey });
    cachedGeminiApiKey = apiKey;
  }
  return cachedGeminiClient;
}

function resolveProviderModel(providerName, taskType = "lyrics") {
  if (providerName === "gemini") {
    return getGeminiModel(taskType);
  }
  return MODELS[providerName]?.[taskType] || MODELS[providerName]?.lyrics || "unknown";
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  // CJK characters (U+4E00-U+9FFF) count as ~2 tokens each
  const cjkCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
  const nonCjk = text.length - cjkCount;
  return Math.ceil(nonCjk / 4) + (cjkCount * 2);
}

/**
 * Validate input token limits
 * @param {string} prompt - Input prompt
 * @throws {Error} If prompt exceeds token limit
 */
function validateInputTokens(prompt) {
  const estimated = estimateTokens(prompt);
  if (estimated > CONFIG.maxInputTokens) {
    const error = new Error(
      `Input exceeds token limit: ~${estimated} tokens (max: ${CONFIG.maxInputTokens})`
    );
    error.code = ERROR_CODES.TOKEN_LIMIT;
    throw error;
  }
}

/**
 * Sleep helper for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJsonText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_err) {
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1].trim());
      } catch (_innerErr) {
        // fall through
      }
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (_innerErr) {
        // fall through
      }
    }

    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      } catch (_innerErr) {
        // fall through
      }
    }
  }

  return null;
}

function normalizeStructuredResult(result, responseMimeType) {
  if (responseMimeType !== "application/json") {
    return result;
  }

  const parsed = tryParseJsonText(result?.text);
  if (parsed === null) {
    const error = new Error(`Structured JSON response could not be parsed: ${String(result?.text || "").slice(0, 120)}`);
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  return {
    ...result,
    text: JSON.stringify(parsed),
  };
}

function isOutputTruncatedFinishReason(finishReason) {
  const normalized = String(finishReason || "").trim().toUpperCase();
  return normalized === "MAX_TOKENS" ||
    normalized === "MAX_TOKEN" ||
    normalized === "MAX_TOKENS_REACHED" ||
    normalized === "LENGTH";
}

/**
 * Create Anthropic client
 * @returns {Anthropic|null} Client or null if no API key
 */
function createAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Sanitize JSON Schema for Gemini's responseSchema (OpenAPI 3.0 based)
 * Gemini doesn't support full JSON Schema - strip unsupported fields
 *
 * @example
 * // Before: { type: "object", additionalProperties: false, properties: {...} }
 * // After:  { type: "object", properties: {...} }
 *
 * @param {Object} schema - JSON Schema object
 * @param {WeakSet} [visited] - Tracks visited objects to prevent circular reference loops
 * @returns {Object} Sanitized schema safe for Gemini
 */
function sanitizeSchemaForGemini(schema, visited = new WeakSet()) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  // Detect circular references to prevent stack overflow
  if (visited.has(schema)) {
    return {};
  }
  visited.add(schema);

  const sanitized = { ...schema };

  // Gemini's responseSchema (OpenAPI 3.0) doesn't support these JSON Schema fields
  const unsupportedFields = [
    "additionalProperties",
    "$ref",
    "anyOf",
    "oneOf",
    "allOf",
    "$schema",
    "$id",
    "definitions",
    "$defs",
    "not",
    "if",
    "then",
    "else",
    "patternProperties",
    "dependencies",
  ];
  unsupportedFields.forEach((field) => delete sanitized[field]);

  // Recursively sanitize nested properties
  if (sanitized.properties) {
    sanitized.properties = Object.fromEntries(
      Object.entries(sanitized.properties).map(([key, value]) => [
        key,
        sanitizeSchemaForGemini(value, visited),
      ])
    );
  }
  if (sanitized.items) {
    // Handle both single schema and tuple array forms
    if (Array.isArray(sanitized.items)) {
      sanitized.items = sanitized.items.map((item) =>
        sanitizeSchemaForGemini(item, visited)
      );
    } else {
      sanitized.items = sanitizeSchemaForGemini(sanitized.items, visited);
    }
  }

  return sanitized;
}

/**
 * Generate text using Google Gemini API
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateWithGemini({
  prompt,
  taskType = "lyrics",
  systemPrompt,
  temperature = 0.7,
  responseMimeType,
  responseSchema,
  maxOutputTokens,
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("Gemini API key not configured");
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  const model = getGeminiModel(taskType);
  const client = getGeminiClient(apiKey);

  const config = {
    temperature,
    maxOutputTokens: maxOutputTokens || CONFIG.maxOutputTokens,
    topP: 0.5, // Reduced from default 0.95 to prevent premature stop tokens
  };

  if (systemPrompt) {
    config.systemInstruction = systemPrompt;
  }

  if (responseMimeType) {
    config.responseMimeType = responseMimeType;
  }

  if (responseSchema) {
    const sanitized = sanitizeSchemaForGemini(responseSchema);
    const schemaProperties = sanitized?.properties || {};
    const hasObjectProperties =
      sanitized?.type !== "object" || Object.keys(schemaProperties).length > 0;

    if (hasObjectProperties) {
      config.responseSchema = sanitized;
    }
  }

  try {
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config,
    });

    const text = response.text || "";

    return {
      text,
      provider: "gemini",
      model,
      finishReason: response.candidates?.[0]?.finishReason || null,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  } catch (err) {
    const statusCode = Number(err?.status) || Number(err?.statusCode) || null;
    const message = err?.message || String(err);
    const isSchemaError =
      statusCode === 400 &&
      (message.includes("response_schema") || message.includes("responseSchema"));

    if (isSchemaError && config.responseSchema) {
      const retryConfig = { ...config };
      delete retryConfig.responseSchema;

      const retryResponse = await client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: retryConfig,
      });

      const text = retryResponse.text || "";
      if (retryConfig.responseMimeType === "application/json" && text) {
        try {
          JSON.parse(text);
        } catch {
          const parseError = new Error("Gemini schema retry returned non-JSON response");
          parseError.code = ERROR_CODES.API_ERROR;
          throw parseError;
        }
      }

      return {
        text,
        provider: "gemini",
        model,
        finishReason: retryResponse.candidates?.[0]?.finishReason || null,
        usage: {
          inputTokens: retryResponse.usageMetadata?.promptTokenCount || 0,
          outputTokens: retryResponse.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    }

    const error = new Error(`Gemini API error: ${statusCode || "unknown"} ${message}`);
    error.code =
      statusCode === 429 || message.includes("RESOURCE_EXHAUSTED")
        ? ERROR_CODES.RATE_LIMIT
        : ERROR_CODES.API_ERROR;
    error.statusCode = statusCode;
    throw error;
  }
}

/**
 * Generate text using Anthropic API
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateWithAnthropic({
  prompt,
  taskType = "lyrics",
  systemPrompt,
  temperature = 0.7,
  maxOutputTokens,
}) {
  const client = createAnthropicClient();
  if (!client) {
    const error = new Error("Anthropic API key not configured");
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  const model = MODELS.anthropic[taskType] || MODELS.anthropic.lyrics;

  const response = await client.messages.create({
    model,
    max_tokens: maxOutputTokens || CONFIG.maxOutputTokens,
    system: systemPrompt || "You are a helpful assistant.",
    messages: [{ role: "user", content: prompt }],
    temperature,
  });

  const text = response.content[0]?.text || "";
  return {
    text,
    provider: "anthropic",
    model,
    finishReason: response.stop_reason || null,
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

/**
 * Generate text using OpenAI API
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateWithOpenAI({
  prompt,
  taskType = "lyrics",
  systemPrompt,
  temperature = 0.7,
  maxOutputTokens,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("OpenAI API key not configured");
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  const model = MODELS.openai[taskType] || MODELS.openai.lyrics;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens || CONFIG.maxOutputTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt || "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`OpenAI API error: ${response.status} ${body}`);
    error.code = response.status === 429 ? ERROR_CODES.RATE_LIMIT : ERROR_CODES.API_ERROR;
    error.statusCode = response.status;
    throw error;
  }

  const data = await response.json();
  const choice = data.choices?.[0] || {};
  const text = choice.message?.content || "";

  return {
    text,
    provider: "openai",
    model,
    finishReason: choice.finish_reason || null,
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Generate text with automatic fallback between providers
 *
 * @param {Object} options - Generation options
 * @param {string} options.prompt - The prompt to send to the LLM
 * @param {string} [options.taskType='lyrics'] - Task type: 'lyrics' or 'simple'
 * @param {string} [options.systemPrompt] - System prompt for context
 * @param {number} [options.temperature=0.7] - Temperature for generation
 * @param {string} [options.responseMimeType] - Response MIME type for structured outputs
 * @param {Object} [options.responseSchema] - JSON schema for structured outputs (Gemini only)
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateText({
  prompt,
  taskType = "lyrics",
  systemPrompt,
  temperature = 0.7,
  responseMimeType,
  responseSchema,
  maxOutputTokens,
  providers,
  logLabel,
}) {
  // Validate input
  validateInputTokens(prompt);
  const promptTokens = estimateTokens(prompt);
  const label = typeof logLabel === "string" && logLabel.trim()
    ? logLabel.trim()
    : taskType;

  const availableProviders = [
    { name: "gemini", fn: generateWithGemini },
    { name: "anthropic", fn: generateWithAnthropic },
    { name: "openai", fn: generateWithOpenAI },
  ];
  const providerSet = Array.isArray(providers) && providers.length > 0
    ? new Set(providers)
    : null;
  const orderedProviders = providerSet
    ? availableProviders.filter((provider) => providerSet.has(provider.name))
    : availableProviders;

  const errors = [];

  for (const provider of orderedProviders) {
    for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
      try {
        const model = resolveProviderModel(provider.name, taskType);
        console.log(
          `[LLM] Attempting ${provider.name} model=${model} taskType=${taskType} label=${label} promptTokens=${promptTokens} maxOutputTokens=${maxOutputTokens || CONFIG.maxOutputTokens} (attempt ${attempt + 1}/${CONFIG.maxRetries + 1})`
        );

        let timeoutId;
        const result = await Promise.race([
          provider.fn({
            prompt,
            taskType,
            systemPrompt,
            temperature,
            responseMimeType,
            responseSchema,
            maxOutputTokens,
          }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              const error = new Error(`${provider.name} request timed out`);
              error.code = ERROR_CODES.TIMEOUT;
              reject(error);
            }, CONFIG.timeoutMs);
          }),
        ]);
        clearTimeout(timeoutId);

        if (isOutputTruncatedFinishReason(result.finishReason)) {
          const error = new Error(
            `${provider.name} output truncated before completion: finishReason=${result.finishReason}`
          );
          error.code = ERROR_CODES.OUTPUT_TRUNCATED;
          throw error;
        }

        console.log(
          `[LLM] Success with ${provider.name} model=${result.model || model} label=${label}: outputTokens=${result.usage.outputTokens} promptTokens=${promptTokens}${result.finishReason ? ` (finishReason=${result.finishReason})` : ""}${provider.name !== "gemini" ? " fallbackUsed=true" : ""}`
        );

        return normalizeStructuredResult({
          ...result,
          fallbackUsed: provider.name !== "gemini",
          attempts: attempt + 1,
        }, responseMimeType);
      } catch (err) {
        const model = resolveProviderModel(provider.name, taskType);
        console.error(
          `[LLM] ${provider.name} model=${model} label=${label} attempt ${attempt + 1} failed: code=${err.code || "unknown"} status=${err.statusCode || "n/a"} promptTokens=${promptTokens} message=${err.message}`
        );
        errors.push({ provider: provider.name, attempt, error: err.message });

        // Don't retry on token limit errors
        if (err.code === ERROR_CODES.TOKEN_LIMIT) {
          throw err;
        }

        // Delay before retry (unless it's a timeout)
        if (attempt < CONFIG.maxRetries && err.code !== ERROR_CODES.TIMEOUT) {
          await sleep(CONFIG.retryDelayMs * (attempt + 1));
        }
      }
    }
  }

  // All providers failed
  const error = new Error(
    `All LLM providers failed after ${errors.length} attempts`
  );
  error.code = ERROR_CODES.ALL_PROVIDERS_FAILED;
  error.errors = errors.map(e => ({ provider: e.provider, attempt: e.attempt }));
  throw error;
}

// Whitelist of valid music styles accepted by the LLM/music provider
const VALID_STYLES = new Set([
  'pop', 'rock', 'hip-hop', 'r&b', 'country', 'jazz', 'classical', 'folk',
  'electronic', 'dance', 'reggae', 'blues', 'soul', 'indie', 'alternative',
  'metal', 'punk', 'latin', 'gospel', 'acoustic', 'ambient', 'cinematic',
]);

/**
 * Generate lyrics using the LLM with lyrics-specific prompting
 *
 * @param {Object} options - Lyrics generation options
 * @param {string} options.songwriterPrompt - The songwriter prompt with context
 * @param {string} options.style - Music style for the lyrics
 * @returns {Promise<Object>} Generated lyrics and metadata
 */
async function generateLyricsWithLLM({ songwriterPrompt, style }) {
  // SVC-06: Validate style against whitelist to prevent prompt injection via style param
  const normalizedStyle = (style || 'pop').toLowerCase().trim();
  if (!VALID_STYLES.has(normalizedStyle)) {
    const error = new Error(`Invalid style: "${style}". Must be one of: ${[...VALID_STYLES].join(', ')}`);
    error.code = 'E306_INVALID_STYLE';
    throw error;
  }
  const safeStyle = normalizedStyle;

  const systemPrompt = `You are a professional songwriter who writes heartfelt, personal song lyrics.

STYLE: ${safeStyle}

RULES:
1. Write lyrics that are singable (6-12 syllables per line)
2. Include clear verse/chorus structure
3. Make the recipient's name the emotional anchor (in the chorus)
4. Use concrete imagery from the provided story context
5. Avoid clichés - find fresh ways to express emotions
6. Match the energy and vocabulary to the musical style

OUTPUT FORMAT:
Return lyrics in this exact JSON format:
{
  "title": "Song Title",
  "style": "${safeStyle}",
  "sections": [
    { "name": "verse1", "lines": ["line1", "line2", "line3", "line4"] },
    { "name": "chorus", "lines": ["line1", "line2", "line3", "line4"] },
    { "name": "verse2", "lines": ["line1", "line2", "line3", "line4"] },
    { "name": "chorus2", "lines": ["line1", "line2", "line3", "line4"] }
  ],
  "anchor_line": "The most memorable line that includes the recipient's name"
}

Only output valid JSON, no markdown code blocks or explanations.`;

  return generateText({
    prompt: songwriterPrompt,
    taskType: "lyrics",
    systemPrompt,
    temperature: 0.8, // Slightly higher for creative output
    responseMimeType: "application/json",
  });
}

/**
 * Check if any LLM provider is available
 * @returns {boolean} True if at least one provider is configured
 */
function isAvailable() {
  return !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Get configured providers
 * @returns {string[]} List of configured provider names
 */
function getConfiguredProviders() {
  const providers = [];
  if (process.env.GEMINI_API_KEY) providers.push("gemini");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  return providers;
}

module.exports = {
  generateText,
  generateLyricsWithLLM,
  isAvailable,
  getConfiguredProviders,
  estimateTokens,
  getGeminiModel,
  resolveProviderModel,
  isOutputTruncatedFinishReason,
  __setGoogleGenAIFactoryForTest(factory) {
    googleGenAIFactory = factory || ((options) => new GoogleGenAI(options));
    cachedGeminiClient = null;
    cachedGeminiApiKey = null;
  },
  // Export config and error codes for testing
  CONFIG,
  ERROR_CODES,
  MODELS,
};
