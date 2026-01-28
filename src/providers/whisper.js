/**
 * OpenAI Whisper Speech-to-Text Provider
 *
 * Uses OpenAI's Whisper API for audio transcription.
 * Supports: m4a, mp3, wav, webm, mp4, mpeg, mpga, oga, ogg, flac
 */

/**
 * Transcribe audio using OpenAI's Whisper API
 *
 * @param {Buffer} audioBuffer - Audio data to transcribe
 * @param {Object} options - Transcription options
 * @param {string} [options.language] - ISO-639-1 language code (e.g., 'en', 'es'). Auto-detected if not provided
 * @param {string} [options.prompt] - Optional context hint to improve transcription accuracy
 * @param {string} [options.filename] - Filename with extension for format detection (default: 'audio.m4a')
 * @param {string} [options.apiKey] - OpenAI API key (falls back to OPENAI_API_KEY env var)
 * @param {number} [options.timeoutMs] - Request timeout in milliseconds (default: 60000)
 * @returns {Promise<{text: string, language: string, duration: number|null}>}
 */
async function transcribeAudio(audioBuffer, options = {}) {
  const {
    language,
    prompt,
    filename = "audio.m4a",
    apiKey = process.env.OPENAI_API_KEY,
    timeoutMs = 60000,
  } = options;

  // Input validation
  if (!apiKey) {
    throw new Error("E401_WHISPER_ERROR: OPENAI_API_KEY is required");
  }
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("E401_WHISPER_ERROR: Audio buffer is required");
  }
  if (!(audioBuffer instanceof Buffer)) {
    throw new Error("E401_WHISPER_ERROR: audioBuffer must be a Buffer");
  }

  // Validate file extension for supported formats
  const ext = filename.split(".").pop()?.toLowerCase();
  const supportedFormats = ["m4a", "mp3", "wav", "webm", "mp4", "mpeg", "mpga", "oga", "ogg", "flac"];
  if (ext && !supportedFormats.includes(ext)) {
    console.warn(`[Whisper] Unsupported format '${ext}', proceeding anyway`);
  }

  console.log(`[Whisper] Transcribing audio: ${audioBuffer.length} bytes, format: ${ext || "unknown"}`);

  // Build multipart form data using native FormData (Node.js 18+)
  const form = new FormData();

  // Create a Blob from the Buffer for the file field
  const blob = new Blob([audioBuffer], { type: getMimeType(ext) });
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json"); // Get duration and detected language

  if (language) {
    form.append("language", language);
  }
  if (prompt) {
    form.append("prompt", prompt);
  }

  // Make API request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // Note: Don't set Content-Type - fetch sets it automatically with boundary for FormData
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("E401_WHISPER_ERROR: Request timeout");
    }
    const message = err?.message || "network_error";
    console.error(`[Whisper] Network error: ${message}`);
    throw new Error(`E401_WHISPER_ERROR: Network error - ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle API errors
  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }

    const errorMessage = typeof errorBody === "object" ? errorBody.error?.message : errorBody;
    console.error(`[Whisper] API error ${response.status}: ${errorMessage}`);

    // Map common errors to structured codes
    if (response.status === 401) {
      throw new Error("E401_WHISPER_ERROR: Invalid API key");
    }
    if (response.status === 429) {
      throw new Error("E401_WHISPER_ERROR: Rate limit exceeded");
    }
    if (response.status === 400) {
      throw new Error(`E401_WHISPER_ERROR: Bad request - ${errorMessage}`);
    }
    throw new Error(`E401_WHISPER_ERROR: API error ${response.status} - ${errorMessage}`);
  }

  // Parse successful response
  let result;
  try {
    result = await response.json();
  } catch {
    console.error("[Whisper] Failed to parse API response");
    throw new Error("E401_WHISPER_ERROR: Invalid response from API");
  }

  // Extract transcription data
  const text = result.text?.trim() || "";
  const detectedLanguage = result.language || language || "en";
  const duration = result.duration ?? null;

  console.log(`[Whisper] Transcription complete: ${text.length} chars, language: ${detectedLanguage}, duration: ${duration}s`);

  return {
    text,
    language: detectedLanguage,
    duration,
  };
}

/**
 * Get MIME type for audio format
 * @param {string} ext - File extension
 * @returns {string} MIME type
 */
function getMimeType(ext) {
  const mimeTypes = {
    m4a: "audio/m4a",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    webm: "audio/webm",
    mp4: "audio/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return mimeTypes[ext] || "audio/mpeg";
}

module.exports = {
  transcribeAudio,
};
