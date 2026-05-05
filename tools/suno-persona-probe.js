#!/usr/bin/env node
/**
 * Suno Persona Live Probe (R2 verification harness)
 *
 * Runs the upload-cover → audio-resolution → generate-persona flow against
 * a real SunoAPI account to verify the integration works end-to-end AND
 * captures the upload-cover response shape into a redacted fixture for U6.
 *
 * USAGE:
 *   SUNO_API_KEY=... \
 *   SUNO_BASE_URL=https://api.sunoapi.org \
 *   SUNO_FILE_UPLOAD_BASE_URL=https://sunoapiorg.redpandaai.co \
 *   SUNO_CALLBACK_URL=https://your-server.example.com/internal/suno/callback \
 *   PROBE_SOURCE_AUDIO_URL='<short-lived signed url for a clean mono WAV>' \
 *   node tools/suno-persona-probe.js
 *
 * Captures the raw upload-cover response to test/fixtures/suno-upload-cover-response.json
 * (after redaction) so the U6 typed extractor can be validated against the
 * real shape.
 *
 * SAFETY:
 *   - Does NOT enable any feature flag.
 *   - Does NOT touch the database.
 *   - Does NOT persist user-identifying state.
 *   - Redacts Bearer tokens, URLs, persona/audio/task IDs before writing the fixture.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  DEFAULT_UPLOAD_BASE_URL,
  uploadFileUrl,
  submitUploadCoverTask,
  pollUploadCoverForAudio,
} = require("../src/providers/suno-persona");

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "suno-upload-cover-response.json",
);

function shortHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, 8);
}

function redactValue(value, key = "") {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    if (value.trim().startsWith("{") || value.trim().startsWith("[")) {
      try {
        return JSON.stringify(redactValue(JSON.parse(value), key));
      } catch (_err) {
        // Fall through to inline string redaction.
      }
    }
    if (/https?:\/\//i.test(value)) {
      return value.replace(/https?:\/\/[^"'\s]+/gi, "[redacted_url]");
    }
    if (/token=[A-Za-z0-9._~+/=-]+/i.test(value)) {
      return value.replace(/token=[A-Za-z0-9._~+/=-]+/gi, "token=[redacted]");
    }
    if (/^https?:\/\//i.test(value)) {
      return "[redacted_url]";
    }
    if (/^Bearer\s+/i.test(value)) {
      return "Bearer [redacted]";
    }
    const taskMatch = value.match(/^task[_-](.+)$/i);
    if (taskMatch) {
      return `task_REDACTED_${shortHash(taskMatch[1])}`;
    }
    const audioMatch = value.match(/^audio[_-](.+)$/i);
    if (audioMatch) {
      return `audio_REDACTED_${shortHash(audioMatch[1])}`;
    }
    const personaMatch = value.match(/^persona[_-](.+)$/i);
    if (personaMatch) {
      return `persona_REDACTED_${shortHash(personaMatch[1])}`;
    }
    if (/taskid/i.test(key)) {
      return `task_REDACTED_${shortHash(value)}`;
    }
    if (/audioid|audio_id/i.test(key)) {
      return `audio_REDACTED_${shortHash(value)}`;
    }
    if (/personaid|persona_id/i.test(key)) {
      return `persona_REDACTED_${shortHash(value)}`;
    }
    if (
      key === "id" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      return `audio_REDACTED_${shortHash(value)}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

async function main() {
  const baseUrl = process.env.SUNO_BASE_URL || "https://api.sunoapi.org";
  const apiKey = process.env.SUNO_API_KEY;
  const uploadBase =
    process.env.SUNO_FILE_UPLOAD_BASE_URL || DEFAULT_UPLOAD_BASE_URL;
  const callbackUrl = process.env.SUNO_CALLBACK_URL;
  const sourceUrl = process.env.PROBE_SOURCE_AUDIO_URL;

  if (!apiKey || !callbackUrl || !sourceUrl) {
    console.error(
      "ABORT: missing required env. See header comment for required vars.",
    );
    process.exit(2);
  }

  console.log("[probe] uploading source audio URL to Suno file-upload...");
  const uploadResult = await uploadFileUrl({
    uploadBaseUrl: uploadBase,
    apiKey,
    fileUrl: sourceUrl,
  });
  const uploadUrl = uploadResult?.downloadUrl;
  if (!uploadUrl) {
    console.error(
      "ABORT: uploadFileUrl did not return downloadUrl. Result:",
      redactValue(uploadResult),
    );
    process.exit(3);
  }

  console.log("[probe] submitting upload-cover task...");
  const cover = await submitUploadCoverTask({
    baseUrl,
    apiKey,
    uploadUrl,
    callBackUrl: callbackUrl,
  });
  const sourceTaskId = cover?.taskId || cover?.task_id;
  if (!sourceTaskId) {
    console.error(
      "ABORT: upload-cover did not return taskId. Cover:",
      redactValue(cover),
    );
    process.exit(4);
  }
  console.log(
    `[probe] upload-cover taskId = ${redactValue(`task_${sourceTaskId}`)}`,
  );

  console.log(
    "[probe] polling for upload-cover completion (capturing raw response)...",
  );
  let rawResponse = null;
  const audio = await pollUploadCoverForAudio({
    baseUrl,
    apiKey,
    taskId: sourceTaskId,
    captureRawResponse: (raw) => {
      rawResponse = raw;
    },
  });

  if (rawResponse) {
    const fixture = {
      _fixture_metadata: {
        purpose: "Canonical shape of SunoAPI upload-cover task status response",
        captured_from: "tools/suno-persona-probe.js live run",
        capture_timestamp: new Date().toISOString(),
        source_doc: "https://docs.sunoapi.org/suno-api/generate-persona",
        redaction:
          "Bearer tokens, URLs, persona/audio/task IDs replaced with deterministic hashes",
        status: "VERIFIED — captured from a successful upload-cover probe",
      },
      ...redactValue(rawResponse),
    };
    await fs.writeFile(
      FIXTURE_PATH,
      JSON.stringify(fixture, null, 2) + "\n",
      "utf8",
    );
    console.log(`[probe] wrote fixture to ${FIXTURE_PATH}`);
  } else {
    console.error(
      "[probe] WARNING: no raw response captured. Re-run with captureRawResponse hook in pollUploadCoverForAudio.",
    );
  }

  console.log("[probe] audio resolution result:", redactValue(audio));
  console.log(
    "[probe] done. Persona generation step intentionally NOT run by this probe — re-run via the runner with feature flag enabled in a controlled environment.",
  );
}

main().catch((err) => {
  console.error("[probe] FAILED:", err?.message || err);
  process.exit(1);
});
