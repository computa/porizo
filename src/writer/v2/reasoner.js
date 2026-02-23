/**
 * V2 Reasoner
 *
 * Unified reasoning module that handles perception, reasoning, and action
 * selection in a single LLM call.
 *
 * V3 Update: Uses context-only prompts without embedded decision rules.
 * The LLM makes all qualitative decisions; the harness only validates structure.
 *
 * @module writer/v2/reasoner
 */

const { generateText, isAvailable } = require("../../services/llm-provider");
const {
  buildContextPrompt,
  buildSelectionPrompt,
  buildOutlinePrompt,
  buildEditorPrompt,
  buildPovPrompt,
} = require("./prompts/builder");
const { callLightweightModel } = require("../v3/fallback-llm");
const { generateSmartHeuristicFallback } = require("./engine");
const { isAppendStyleNarrative, hasFirstPersonVoice } = require("./narrative");

/**
 * Retry configuration for LLM calls
 * Exponential backoff: delay = baseDelay * 2^attempt (capped at maxDelay)
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
  // Transient errors that warrant retry (timeout, rate limit, network, server errors)
  retryableErrors: [
    "timeout",
    "rate limit",
    "rate_limit",
    "429",
    // More specific 500 patterns to avoid false positives like "user ID 1500"
    "status 500",
    " 500 ",
    "500 internal",
    "502",
    "503",
    "504",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNREFUSED",
    "network",
    "overload", // Matches both "overload" and "overloaded"
    "empty response", // For retrying empty LLM responses
  ],
};

// Note: We intentionally don't use responseSchema for complex JSON outputs.
// Loose schemas (like { type: "object" }) cause Gemini to generate garbage.
// The prompts specify the JSON structure clearly, which works better for
// complex nested outputs like story beats, atoms, primitives, etc.

const JSON_TEMPERATURE = 0.2;

/**
 * Check if an error is transient and worth retrying
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(errorMessage) {
  if (!errorMessage) return false;
  const lowerMsg = errorMessage.toLowerCase();
  return RETRY_CONFIG.retryableErrors.some(pattern =>
    lowerMsg.includes(pattern.toLowerCase())
  );
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Build the reasoning prompt with current state
 *
 * V3: Uses context-only prompt without embedded decision rules.
 * The LLM makes all qualitative decisions holistically.
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @returns {string} Formatted prompt
 */
function buildReasoningPrompt(state, userInput) {
  // Use v3 context-only prompt builder
  return buildContextPrompt(state, userInput);
}

/**
 * Sanitize JSON string to handle common LLM quirks
 * - Removes trailing commas before } or ]
 * - Escapes unescaped newlines and tabs in string values
 * - Handles control characters
 * @param {string} jsonStr - Raw JSON string
 * @returns {string} Sanitized JSON string
 */
function sanitizeJsonString(jsonStr) {
  let sanitized = jsonStr;

  // Remove trailing commas before closing brackets/braces
  sanitized = sanitized.replace(/,(\s*[}\]])/g, "$1");

  // Escape unescaped control characters inside strings
  // Walk through and fix newlines/tabs that appear inside quoted strings
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      // Escape control characters inside strings
      if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Parse the LLM response into structured data
 *
 * Supports both v3 and legacy response formats:
 * - V3: { decision: { action }, updates: { beats }, output: { question } }
 * - Legacy: { action, question, narrative, beats }
 *
 * @param {string} response - Raw LLM response
 * @returns {{success: boolean, data?: Object, error?: string, raw?: string}}
 */
function parseReasoningResponse(response) {
  try {
    // Try to extract JSON from markdown code blocks
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find JSON object in response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "No JSON object found in response",
        raw: response,
      };
    }
    jsonStr = jsonMatch[0];

    // Sanitize common LLM JSON quirks (trailing commas, etc.)
    jsonStr = sanitizeJsonString(jsonStr);

    const data = JSON.parse(jsonStr);

    // Normalize v3 format to legacy format for backward compatibility
    // V3 has: decision.action, output.question, updates.narrative
    // Legacy has: action, question, narrative
    if (data.decision?.action && !data.action) {
      data.action = data.decision.action;
    }
    if (data.output?.question && !data.question) {
      data.question = data.output.question;
    }
    if (data.output?.confirmation && !data.confirmation) {
      data.confirmation = data.output.confirmation;
    }
    if (data.updates?.narrative && !data.narrative) {
      data.narrative = data.updates.narrative;
    }

    // Normalize updates to legacy fields for engine compatibility
    if (data.updates?.beats && !data.beats) {
      data.beats = data.updates.beats;
    }
    if (data.updates?.new_facts && !data.reasoning?.new_facts) {
      data.reasoning = data.reasoning || {};
      data.reasoning.new_facts = data.updates.new_facts;
    }
    if (data.updates?.event && !data.event) {
      data.event = data.updates.event;
    }
    if (data.updates?.atoms && !data.atoms) {
      data.atoms = data.updates.atoms;
    }
    if (data.updates?.primitives && !data.primitives) {
      data.primitives = data.updates.primitives;
    }
    if (data.updates?.motifs && !data.motifs) {
      data.motifs = data.updates.motifs;
    }
    if (data.updates?.dials && !data.dials) {
      data.dials = data.updates.dials;
    }
    if (data.updates?.song_map && !data.song_map) {
      data.song_map = data.updates.song_map;
    }

    // Validate required fields exist (action is required, others depend on action)
    if (!data.action) {
      return {
        success: false,
        error: "Missing required field: action",
        raw: response,
      };
    }

    // Validate action is one of allowed values
    if (!["ASK", "CLARIFY", "CONFIRM", "STOP"].includes(data.action)) {
      return {
        success: false,
        error: `Invalid action: ${data.action}`,
        raw: response,
      };
    }

    // If action is ASK, question is required
    if (data.action === "ASK" && !data.question) {
      return {
        success: false,
        error: "Action is ASK but no question provided",
        raw: response,
      };
    }

    // If action is CLARIFY, question is required
    if (data.action === "CLARIFY" && !data.question) {
      return {
        success: false,
        error: "Action is CLARIFY but no question provided",
        raw: response,
      };
    }

    // If action is CONFIRM, confirmation message is required
    if (data.action === "CONFIRM" && !data.confirmation) {
      return {
        success: false,
        error: "Action is CONFIRM but no confirmation message provided",
        raw: response,
      };
    }

    // Validate and correct strength values (with feedback, not silent)
    // Support both v3 (updates.beats) and legacy (beats) locations
    const beatsToProcess = data.updates?.beats || data.beats;
    if (beatsToProcess && Array.isArray(beatsToProcess)) {
      for (const beat of beatsToProcess) {
        if (typeof beat.strength === "number") {
          if (beat.strength < 0 || beat.strength > 1) {
            // Log warning - don't silently hide LLM errors
            console.warn(`[V2 Reasoner] Beat "${beat.id}" has out-of-range strength: ${beat.strength} (expected 0-1)`);
            // Track original value for debugging/monitoring
            beat._original_strength = beat.strength;
            beat._strength_corrected = true;
            // Clamp to valid range
            beat.strength = Math.max(0, Math.min(1, beat.strength));
          }
        }
      }
    }

    return {
      success: true,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err.message}`,
      raw: response,
    };
  }
}

function parseJsonResponse(response) {
  try {
    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[V2 Reasoner] No JSON object found in response:", response.substring(0, 500));
      return { success: false, error: "No JSON object found", raw: response };
    }
    jsonStr = jsonMatch[0];
    jsonStr = sanitizeJsonString(jsonStr);
    const data = JSON.parse(jsonStr);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: `JSON parse error: ${err.message}`, raw: response };
  }
}

/**
 * Determine if the narrative update needs a rewrite pass.
 * Enforces "rewrite, don't append" behavior.
 *
 * @param {Object} state - Current V2 state
 * @param {Object} data - Parsed reasoning data
 * @returns {boolean}
 */
function needsNarrativeRewrite(state, data) {
  const narrative = data?.updates?.narrative || data?.narrative;
  const narrativeMode = data?.updates?.narrative_mode || data?.narrative_mode;

  if (!narrative) return true;
  if (state?.narrative && isAppendStyleNarrative(state.narrative, narrative)) return true;
  if (state?.narrative && narrativeMode && narrativeMode !== "rewritten") return true;
  return false;
}

/**
 * Build a stricter prompt to force narrative rewrite (no append).
 *
 * @param {Object} state
 * @param {string} userInput
 * @returns {string}
 */
function buildRewritePrompt(state, userInput) {
  return `${buildReasoningPrompt(state, userInput)}\n\nIMPORTANT: Rewrite the full narrative by integrating the new info into earlier sentences. Do not append or simply add a new line at the end. Respond with JSON only.`;
}

function buildSelectionStagePrompt(state, userInput) {
  return buildSelectionPrompt(state, userInput);
}

function buildOutlineStagePrompt(state, userInput, selectionJson) {
  return buildOutlinePrompt(state, userInput, selectionJson);
}

function buildEditorStagePrompt(state, userInput, writerJson, selectionJson, outlineJson) {
  return buildEditorPrompt(state, userInput, writerJson, selectionJson, outlineJson);
}

function buildPovStagePrompt(state, userInput, narrative, songMapJson) {
  return buildPovPrompt(state, userInput, narrative, songMapJson);
}

function buildWriterStagePrompt(state, userInput, selectionJson, outlineJson) {
  const basePrompt = buildReasoningPrompt(state, userInput);
  return `${basePrompt}

## PIPELINE CONTEXT
Selection output (JSON):
${selectionJson || "{}"}

Outline output (JSON):
${outlineJson || "{}"}

## REQUIREMENTS
- Use the selection + outline to drive beats and narrative.
- Return the full JSON schema from the base prompt.
- Include updates.atoms, updates.primitives, updates.motifs, updates.dials, updates.song_map.
- Ensure narrative_mode is "rewritten".
`.trim();
}

function mergePipelineData(parsed, selectionData, outlineData, editorData) {
  if (!parsed || !parsed.data) return parsed;
  const data = parsed.data;

  const ensureUpdates = () => {
    data.updates = data.updates || {};
  };

  const selection = selectionData || {};
  const outline = outlineData || {};
  const editor = editorData || {};

  ensureUpdates();

  if (!data.updates.atoms && selection.atoms) data.updates.atoms = selection.atoms;
  if (!data.updates.primitives && selection.primitives) data.updates.primitives = selection.primitives;
  if (!data.updates.motifs && selection.motifs) data.updates.motifs = selection.motifs;
  if (!data.updates.dials && selection.dials) data.updates.dials = selection.dials;

  if (!data.updates.beats && outline.outline?.beats) data.updates.beats = outline.outline.beats;
  if (!data.updates.song_map && outline.song_map) data.updates.song_map = outline.song_map;

  if (editor.narrative) {
    data.updates.narrative = editor.narrative;
    data.narrative = editor.narrative;
    data.updates.narrative_mode = editor.narrative_mode || "rewritten";
  }
  if (editor.song_map) {
    data.updates.song_map = editor.song_map;
  }

  return parsed;
}

async function runStage({
  stage,
  prompt,
  generateTextFn,
  maxRetries,
  sleepFn,
}) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Note: Don't use responseSchema here - the prompts specify complex nested
      // JSON structures that don't match a simple schema. Using a mismatched schema
      // causes Gemini to generate garbage. Let the prompt guide the structure.
      const result = await generateTextFn({
        prompt,
        taskType: "lyrics",
        temperature: JSON_TEMPERATURE,
        responseMimeType: "application/json",
      });

      if (!result || !result.text) {
        throw new Error(`${stage}: LLM returned empty response`);
      }

      const parsed = parseJsonResponse(result.text);
      if (!parsed.success) {
        return {
          success: false,
          error: `${stage}: ${parsed.error}`,
          raw: parsed.raw,
        };
      }

      return {
        success: true,
        data: parsed.data,
      };
    } catch (err) {
      lastError = err.message;
      if (isRetryableError(err.message) && attempt < maxRetries) {
        const delay = getBackoffDelay(attempt);
        console.warn(`[V2 Reasoner] ${stage} retrying in ${delay}ms...`);
        await sleepFn(delay);
      } else {
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError || `${stage}: unknown error`,
  };
}

async function reasonSingle(state, userInput, options = {}) {
  const generateTextFn = options._generateTextFn ?? generateText;

  if (!options._generateTextFn && !isAvailable()) {
    return {
      success: false,
      error: "LLM not available",
      fallback: true,
    };
  }

  const prompt = buildReasoningPrompt(state, userInput);
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  const sleepFn = options._sleepFn ?? sleep;

  let lastError = null;
  let retryCount = 0;
  const errorHistory = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Note: Don't use responseSchema - the reasoning prompts have complex nested
      // structures that don't map well to simple schemas. Loose schemas cause
      // Gemini to generate garbage. Let the prompt guide the structure.
      const result = await generateTextFn({
        prompt,
        taskType: "lyrics",
        temperature: JSON_TEMPERATURE,
        responseMimeType: "application/json",
      });

      if (!result || !result.text) {
        throw new Error("LLM returned empty response");
      }

      const parsed = parseReasoningResponse(result.text);

      if (!parsed.success) {
        console.error("[V2 Reasoner] Parse error:", parsed.error);
        console.error("[V2 Reasoner] Raw response:", result.text.substring(0, 500));
      }

      if (parsed.success && needsNarrativeRewrite(state, parsed.data)) {
        const rewritePrompt = buildRewritePrompt(state, userInput);
        const rewriteResult = await generateTextFn({
          prompt: rewritePrompt,
          taskType: "lyrics",
          temperature: JSON_TEMPERATURE,
          responseMimeType: "application/json",
        });

        if (!rewriteResult || !rewriteResult.text) {
          throw new Error("LLM returned empty response (rewrite)");
        }

        const rewriteParsed = parseReasoningResponse(rewriteResult.text);
        if (rewriteParsed.success && !needsNarrativeRewrite(state, rewriteParsed.data)) {
          rewriteParsed.retryCount = retryCount;
          if (errorHistory.length > 0) {
            rewriteParsed.errorHistory = errorHistory;
          }
          return rewriteParsed;
        }

        return {
          success: false,
          error: "Narrative rewrite required but not satisfied",
          errorCode: "NARRATIVE_REWRITE_REQUIRED",
          raw: rewriteParsed.raw || rewriteResult.text,
        };
      }

      parsed.retryCount = retryCount;
      if (errorHistory.length > 0) {
        parsed.errorHistory = errorHistory;
      }
      return parsed;

    } catch (err) {
      errorHistory.push({
        attempt: attempt + 1,
        error: err.message,
        retryable: isRetryableError(err.message),
      });
      lastError = err.message;
      console.error(`[V2 Reasoner] LLM error (attempt ${attempt + 1}/${maxRetries + 1}):`, err.message);

      if (isRetryableError(err.message) && attempt < maxRetries) {
        const delay = getBackoffDelay(attempt);
        console.warn(`[V2 Reasoner] Retrying in ${delay}ms...`);
        await sleepFn(delay);
        retryCount++;
      } else {
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    errorHistory,
    retryCount,
  };
}

/**
 * Run unified reasoning on user input with retry logic
 *
 * Implements exponential backoff for transient errors (timeout, rate limit, network).
 * Does NOT retry on parse errors (those indicate LLM response issues).
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @param {Object} options - Options for testing
 * @param {number} options.maxRetries - Override max retries (for testing)
 * @param {Function} options._sleepFn - Override sleep function (for testing)
 * @param {Function} options._generateTextFn - Override generateText (for testing)
 * @returns {Promise<{success: boolean, data?: Object, error?: string, retryCount?: number}>}
 */
async function reason(state, userInput, options = {}) {
  const generateTextFn = options._generateTextFn ?? generateText;

  if (!options._generateTextFn && !isAvailable()) {
    return {
      success: false,
      error: "LLM not available",
      fallback: true,
    };
  }

  // Preserve deterministic legacy semantics for unit tests and injected mocks.
  if (options._generateTextFn) {
    return reasonSingle(state, userInput, options);
  }

  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  const sleepFn = options._sleepFn ?? sleep;

  const selectionPrompt = buildSelectionStagePrompt(state, userInput);
  const selectionResult = await runStage({
    stage: "selection",
    prompt: selectionPrompt,
    generateTextFn,
    maxRetries,
    sleepFn,
  });

  if (!selectionResult.success) {
    console.warn("[V2 Reasoner] Selection stage failed:", selectionResult.error);
    return reasonSingle(state, userInput, options);
  }

  const selectionJson = JSON.stringify(selectionResult.data || {});

  const outlinePrompt = buildOutlineStagePrompt(state, userInput, selectionJson);
  const outlineResult = await runStage({
    stage: "outline",
    prompt: outlinePrompt,
    generateTextFn,
    maxRetries,
    sleepFn,
  });

  if (!outlineResult.success) {
    console.warn("[V2 Reasoner] Outline stage failed:", outlineResult.error);
    return reasonSingle(state, userInput, options);
  }

  const outlineJson = JSON.stringify(outlineResult.data || {});

  const writerPrompt = buildWriterStagePrompt(state, userInput, selectionJson, outlineJson);
  const writerResult = await runStage({
    stage: "writer",
    prompt: writerPrompt,
    generateTextFn,
    maxRetries,
    sleepFn,
  });

  if (!writerResult.success) {
    console.warn("[V2 Reasoner] Writer stage failed:", writerResult.error);
    return reasonSingle(state, userInput, options);
  }

  const writerJson = JSON.stringify(writerResult.data || {});
  const writerParsed = parseReasoningResponse(writerJson);

  if (!writerParsed.success) {
    console.warn("[V2 Reasoner] Writer response invalid:", writerParsed.error);
    return reasonSingle(state, userInput, options);
  }

  const editorPrompt = buildEditorStagePrompt(state, userInput, writerJson, selectionJson, outlineJson);
  const editorResult = await runStage({
    stage: "editor",
    prompt: editorPrompt,
    generateTextFn,
    maxRetries,
    sleepFn,
  });

  const merged = mergePipelineData(
    writerParsed,
    selectionResult.data,
    outlineResult.data,
    editorResult.success ? editorResult.data : null
  );

  if (merged.success) {
    const mergedNarrative = merged.data?.updates?.narrative || merged.data?.narrative;
    if (mergedNarrative && !hasFirstPersonVoice(mergedNarrative)) {
      const povPrompt = buildPovStagePrompt(state, userInput, mergedNarrative, JSON.stringify(merged.data?.updates?.song_map || {}));
      const povResult = await runStage({
        stage: "pov",
        prompt: povPrompt,
        generateTextFn,
        maxRetries,
        sleepFn,
      });

      if (povResult.success && povResult.data?.narrative) {
        merged.data.updates = merged.data.updates || {};
        merged.data.updates.narrative = povResult.data.narrative;
        merged.data.updates.narrative_mode = povResult.data.narrative_mode || "rewritten";
        merged.data.narrative = povResult.data.narrative;
        if (povResult.data.song_map) {
          merged.data.updates.song_map = povResult.data.song_map;
        }
      }
    }
  }

  if (merged.success && needsNarrativeRewrite(state, merged.data)) {
    const rewritePrompt = buildRewritePrompt(state, userInput);
    const rewriteResult = await generateTextFn({
      prompt: rewritePrompt,
      taskType: "lyrics",
      temperature: 0.7,
    });

    if (!rewriteResult || !rewriteResult.text) {
      return merged;
    }

    const rewriteParsed = parseReasoningResponse(rewriteResult.text);
    if (rewriteParsed.success && !needsNarrativeRewrite(state, rewriteParsed.data)) {
      return rewriteParsed;
    }
  }

  return merged;
}

/**
 * Run reasoning with three-tier fallback: Primary → Lightweight → Heuristic
 *
 * Gracefully degrades when higher-tier methods fail:
 * - Tier 1: Primary LLM (Sonnet) - Full reasoning with rich context
 * - Tier 2: Lightweight LLM (Haiku) - Concise prompt, fast response
 * - Tier 3: Smart Heuristics - Done signal detection + contextual questions
 *
 * @param {Object} state - Current V2 state
 * @param {string} userInput - User's new input
 * @param {Object} options - Options for testing/mocking
 * @param {Object} options.mockPrimaryResult - Mock primary LLM result (for testing)
 * @param {Object} options.mockLightweightResult - Mock lightweight result (for testing)
 * @returns {Promise<{success: boolean, data?: Object, tier: string, fallback: boolean}>}
 */
async function reasonWithFallback(state, userInput, options = {}) {
  const { mockPrimaryResult, mockLightweightResult } = options;

  // Tier 1: Primary LLM
  let primaryResult;
  if (mockPrimaryResult !== undefined) {
    // Use mock for testing
    primaryResult = mockPrimaryResult;
  } else {
    primaryResult = await reason(state, userInput);
  }

  if (primaryResult.success) {
    return {
      success: true,
      data: primaryResult.data,
      tier: "primary",
      fallback: false,
    };
  }

  if (primaryResult.errorCode === "NARRATIVE_REWRITE_REQUIRED") {
    return {
      success: false,
      error: primaryResult.error,
      errorCode: primaryResult.errorCode,
      tier: "primary",
      fallback: false,
    };
  }

  console.warn("[V2 Reasoner] Primary LLM failed, trying lightweight fallback");
  console.warn("[V2 Reasoner] Primary error:", primaryResult.error);

  // Tier 2: Lightweight LLM (Haiku)
  let lightweightResult;
  if (mockLightweightResult !== undefined) {
    // Use mock for testing
    lightweightResult = mockLightweightResult;
  } else {
    lightweightResult = await callLightweightModel(state, userInput, options);
  }

  if (lightweightResult.success) {
    // Normalize lightweight response format
    const data = { ...lightweightResult.data };

    // Normalize message → question for ASK/CLARIFY actions
    if ((data.action === "ASK" || data.action === "CLARIFY") && data.message && !data.question) {
      data.question = data.message;
    }

    // Normalize message → confirmation for CONFIRM action
    if (data.action === "CONFIRM" && data.message && !data.confirmation) {
      data.confirmation = data.message;
    }

    return {
      success: true,
      data,
      tier: "lightweight",
      fallback: true,
    };
  }

  console.warn("[V2 Reasoner] Lightweight LLM failed, using heuristic fallback");
  console.warn("[V2 Reasoner] Lightweight error:", lightweightResult.error);

  // Tier 3: Smart Heuristics
  try {
    // Add the user input to conversation for done signal detection
    const stateWithInput = {
      ...state,
      conversation: [
        ...(state.conversation || []),
        { role: "user", content: userInput },
      ],
    };

    const heuristicResponse = generateSmartHeuristicFallback(stateWithInput);

    // Validate heuristic response has required fields
    if (!heuristicResponse || !heuristicResponse.action) {
      console.error("[V2 Reasoner] Heuristic returned invalid response:", heuristicResponse);
      return {
        success: false,
        error: "Heuristic fallback produced invalid response",
        tier: "heuristic",
        fallback: true,
      };
    }

    console.warn("[V2 Reasoner] Heuristic response:", heuristicResponse.action);

    // Normalize heuristic response to expected format
    const data = {
      action: heuristicResponse.action,
      question: heuristicResponse.question,
      confirmation: heuristicResponse.confirmation,
      targetBeat: heuristicResponse.targetBeat,
      reason: heuristicResponse.reason,
    };

    return {
      success: true,
      data,
      tier: "heuristic",
      fallback: true,
      confidence: "low", // Explicit signal that this is heuristic-based
    };
  } catch (err) {
    console.error("[V2 Reasoner] Heuristic fallback threw:", err.message);
    return {
      success: false,
      error: `Heuristic fallback failed: ${err.message}`,
      tier: "heuristic",
      fallback: true,
    };
  }
}

module.exports = {
  buildReasoningPrompt,
  parseReasoningResponse,
  reason,
  reasonWithFallback,
  // Exported for testing
  RETRY_CONFIG,
  isRetryableError,
  getBackoffDelay,
  sleep,
};
