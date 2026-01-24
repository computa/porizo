/**
 * LLM Provider Service
 *
 * Provides a unified interface for text generation with:
 * - Primary provider: Gemini (gemini-1.5-pro for lyrics, gemini-1.5-flash for simple)
 * - Fallback providers: Anthropic (Claude Sonnet), then OpenAI (GPT-4o)
 * - Cost guardrails: Token limits per request, usage tracking
 * - Error handling: Automatic fallback with retry logic
 */

const Anthropic = require("@anthropic-ai/sdk");

// Provider configuration
const CONFIG = {
  primary: "gemini",
  fallback: ["anthropic", "openai"],
  timeoutMs: 30000,
  maxRetries: 2,
  retryDelayMs: 1000,
  // Token limits (cost guardrails)
  maxInputTokens: 4000,
  maxOutputTokens: 2000,
};

// Model selection for different use cases
const MODELS = {
  gemini: {
    lyrics: "gemini-2.5-flash", // Fast and capable for creative tasks
    simple: "gemini-2.5-flash", // Same model, very cost-effective
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
};

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
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
 * Generate text using Google Gemini API
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateWithGemini({ prompt, taskType = "lyrics", systemPrompt, temperature = 0.7 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("Gemini API key not configured");
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  const model = MODELS.gemini[taskType] || MODELS.gemini.lyrics;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: CONFIG.maxOutputTokens,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Gemini API error: ${response.status} ${body}`);
    error.code = response.status === 429 ? ERROR_CODES.RATE_LIMIT : ERROR_CODES.API_ERROR;
    error.statusCode = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return {
    text,
    provider: "gemini",
    model,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

/**
 * Generate text using Anthropic API
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateWithAnthropic({ prompt, taskType = "lyrics", systemPrompt, temperature = 0.7 }) {
  const client = createAnthropicClient();
  if (!client) {
    const error = new Error("Anthropic API key not configured");
    error.code = ERROR_CODES.API_ERROR;
    throw error;
  }

  const model = MODELS.anthropic[taskType] || MODELS.anthropic.lyrics;

  const response = await client.messages.create({
    model,
    max_tokens: CONFIG.maxOutputTokens,
    system: systemPrompt || "You are a helpful assistant.",
    messages: [{ role: "user", content: prompt }],
    temperature,
  });

  const text = response.content[0]?.text || "";
  return {
    text,
    provider: "anthropic",
    model,
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
async function generateWithOpenAI({ prompt, taskType = "lyrics", systemPrompt, temperature = 0.7 }) {
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
      max_tokens: CONFIG.maxOutputTokens,
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
  const text = data.choices?.[0]?.message?.content || "";

  return {
    text,
    provider: "openai",
    model,
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
 * @returns {Promise<Object>} Generated text and metadata
 */
async function generateText({
  prompt,
  taskType = "lyrics",
  systemPrompt,
  temperature = 0.7,
}) {
  // Validate input
  validateInputTokens(prompt);

  const providers = [
    { name: "gemini", fn: generateWithGemini },
    { name: "anthropic", fn: generateWithAnthropic },
    { name: "openai", fn: generateWithOpenAI },
  ];

  const errors = [];

  for (const provider of providers) {
    for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
      try {
        console.log(
          `[LLM] Attempting ${provider.name} (attempt ${attempt + 1}/${CONFIG.maxRetries + 1})`
        );

        const result = await Promise.race([
          provider.fn({ prompt, taskType, systemPrompt, temperature }),
          new Promise((_, reject) =>
            setTimeout(() => {
              const error = new Error(`${provider.name} request timed out`);
              error.code = ERROR_CODES.TIMEOUT;
              reject(error);
            }, CONFIG.timeoutMs)
          ),
        ]);

        console.log(
          `[LLM] Success with ${provider.name}: ${result.usage.outputTokens} tokens`
        );

        return {
          ...result,
          fallbackUsed: provider.name !== "gemini",
          attempts: attempt + 1,
        };
      } catch (err) {
        console.error(
          `[LLM] ${provider.name} attempt ${attempt + 1} failed:`,
          err.message
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
  error.errors = errors;
  throw error;
}

/**
 * Generate lyrics using the LLM with lyrics-specific prompting
 *
 * @param {Object} options - Lyrics generation options
 * @param {string} options.songwriterPrompt - The songwriter prompt with context
 * @param {string} options.style - Music style for the lyrics
 * @returns {Promise<Object>} Generated lyrics and metadata
 */
async function generateLyricsWithLLM({ songwriterPrompt, style }) {
  const systemPrompt = `You are a professional songwriter who writes heartfelt, personal song lyrics.

STYLE: ${style || "pop"}

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
  "style": "${style || "pop"}",
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
  // Export config and error codes for testing
  CONFIG,
  ERROR_CODES,
  MODELS,
};
