/* eslint-env browser */
"use strict";

// =============================================================================
// State
// =============================================================================
const state = {
  userId: "debug_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  trackId: null,
  versionNum: null,
  sessionId: null,
  chunks: [],
  mediaRecorder: null,
  audioChunks: [],
  jobId: null,
};

// Display user ID
document.getElementById("userId").textContent = state.userId;

// =============================================================================
// API Helpers
// =============================================================================
async function api(method, path, body) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": state.userId,
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || data.error || `API Error: ${res.status}`);
  }
  return data;
}

async function uploadChunk(sessionId, chunkId, wavBlob) {
  const formData = new FormData();
  // IMPORTANT: Text fields must come BEFORE the file for @fastify/multipart
  formData.append("session_id", sessionId);
  formData.append("chunk_id", chunkId);
  formData.append("audio", wavBlob, `${chunkId}.wav`);

  const res = await fetch("/debug/upload-chunk", {
    method: "POST",
    headers: {
      "x-user-id": state.userId,
    },
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Upload failed");
  }
  return res.json();
}

// =============================================================================
// Audio Recording
// =============================================================================
async function startRecording(onComplete) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 44100,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    state.audioChunks = [];

    // Use webm for recording (browser native)
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    state.mediaRecorder = new MediaRecorder(stream, { mimeType });

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.onstop = async () => {
      // Stop all tracks
      stream.getTracks().forEach((t) => t.stop());

      // Convert webm to wav
      const webmBlob = new Blob(state.audioChunks, { type: mimeType });
      try {
        const wavBlob = await convertToWav(webmBlob);
        onComplete(wavBlob, null);
      } catch (err) {
        onComplete(null, err);
      }
    };

    state.mediaRecorder.start(100); // Collect data every 100ms
    return true;
  } catch (err) {
    throw new Error(`Microphone access denied: ${err.message}`);
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
  }
}

async function convertToWav(webmBlob) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 44100,
  });

  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Convert to mono WAV
  const numChannels = 1;
  const sampleRate = 44100;
  const bitsPerSample = 16;

  // Resample if needed
  let samples;
  if (audioBuffer.sampleRate !== sampleRate) {
    // Simple resampling - use first channel
    const ratio = audioBuffer.sampleRate / sampleRate;
    const newLength = Math.floor(audioBuffer.length / ratio);
    samples = new Float32Array(newLength);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < newLength; i++) {
      samples[i] = channelData[Math.floor(i * ratio)];
    }
  } else {
    samples = audioBuffer.getChannelData(0);
  }

  const numSamples = samples.length;
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Audio data
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(sample * 0x7fff), true);
    offset += 2;
  }

  await audioContext.close();
  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// =============================================================================
// UI Helpers
// =============================================================================
function setStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = "status " + type;
}

function enableSection(sectionId) {
  document.getElementById(sectionId).classList.remove("disabled");
}

function markComplete(sectionId) {
  const section = document.getElementById(sectionId);
  section.classList.add("complete");
}

function updateDisplay(id, value) {
  document.getElementById(id).textContent = value || "-";
}

// =============================================================================
// Section 1: Voice Enrollment (NOW FIRST)
// =============================================================================
async function startEnrollmentSession() {
  try {
    setStatus("enrollmentStatus", "Starting enrollment session...", "info");
    const session = await api("POST", "/voice/enrollment/start", {
      consent_accepted: true,
      consent_version: "debug_v1",
    });

    state.sessionId = session.session_id;
    state.chunks = [];
    updateDisplay("sessionIdDisplay", state.sessionId.slice(0, 8) + "...");
    setStatus(
      "enrollmentStatus",
      "Session started. Record both prompts.",
      "info"
    );
  } catch (err) {
    setStatus("enrollmentStatus", err.message, "error");
  }
}

function setupRecordButton(btnId, audioId, chunkId, promptType) {
  const btn = document.getElementById(btnId);
  const audio = document.getElementById(audioId);
  let isRecording = false;

  btn.onclick = async () => {
    if (!state.sessionId) {
      setStatus("enrollmentStatus", "No enrollment session active", "error");
      return;
    }

    if (!isRecording) {
      // Start recording
      try {
        btn.textContent = "Stop Recording";
        btn.classList.add("recording");
        isRecording = true;

        await startRecording(async (wavBlob, err) => {
          btn.textContent = "Start Recording";
          btn.classList.remove("recording");
          isRecording = false;

          if (err) {
            setStatus("enrollmentStatus", "Recording error: " + err.message, "error");
            return;
          }

          // Preview audio
          const url = URL.createObjectURL(wavBlob);
          audio.src = url;
          audio.classList.remove("hidden");

          // Upload chunk
          try {
            setStatus("enrollmentStatus", "Uploading " + promptType + " chunk...", "info");
            const result = await uploadChunk(state.sessionId, chunkId, wavBlob);

            state.chunks.push({
              chunkId,
              duration: result.duration_sec,
              type: promptType,
            });
            updateChunkList();
            checkEnrollmentReady();

            setStatus(
              "enrollmentStatus",
              promptType + " chunk uploaded (" + result.duration_sec.toFixed(1) + "s)",
              "success"
            );
          } catch (uploadErr) {
            setStatus("enrollmentStatus", "Upload failed: " + uploadErr.message, "error");
          }
        });
      } catch (err) {
        btn.textContent = "Start Recording";
        btn.classList.remove("recording");
        isRecording = false;
        setStatus("enrollmentStatus", err.message, "error");
      }
    } else {
      // Stop recording
      stopRecording();
    }
  };
}

function updateChunkList() {
  const list = document.getElementById("chunkList");
  // Clear existing children safely
  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }
  // Build list using DOM methods (safe, no innerHTML)
  state.chunks.forEach((c) => {
    const div = document.createElement("div");
    div.className = "chunk";
    div.textContent = c.type + ": " + (c.duration ? c.duration.toFixed(1) + "s" : "?");
    list.appendChild(div);
  });
}

function checkEnrollmentReady() {
  const totalDuration = state.chunks.reduce(
    (sum, c) => sum + (c.duration || 0),
    0
  );
  const hasSpoken = state.chunks.some((c) => c.chunkId === "chunk_spoken");
  const hasSung = state.chunks.some((c) => c.chunkId === "chunk_sung");

  const btn = document.getElementById("btnCompleteEnrollment");
  btn.disabled = !(hasSpoken && hasSung && totalDuration >= 10);

  if (btn.disabled && state.chunks.length > 0) {
    if (!hasSpoken || !hasSung) {
      setStatus("enrollmentStatus", "Record both prompts to continue", "info");
    } else if (totalDuration < 10) {
      setStatus(
        "enrollmentStatus",
        "Need " + (10 - totalDuration).toFixed(1) + "s more audio (minimum 10s)",
        "info"
      );
    }
  }
}

async function completeEnrollment() {
  const btn = document.getElementById("btnCompleteEnrollment");
  btn.disabled = true;

  try {
    setStatus("enrollmentStatus", "Processing voice enrollment...", "info");
    const result = await api("POST", "/voice/enrollment/complete", {
      session_id: state.sessionId,
    });

    const qualityScore = result.quality_score || "N/A";
    setStatus(
      "enrollmentStatus",
      "Voice profile created! Quality score: " + qualityScore,
      "success"
    );

    markComplete("section-enrollment");
    // NOW enable Song Details (Section 2)
    enableSection("section-song");
  } catch (err) {
    setStatus("enrollmentStatus", err.message, "error");
    btn.disabled = false;
  }
}

// =============================================================================
// Section 2: Song Details → Generate Lyrics
// =============================================================================
async function generateLyrics() {
  const btn = document.getElementById("btnGenerateLyrics");
  btn.disabled = true;

  try {
    // Step 1: Create track (now safe - voice profile exists)
    setStatus("songStatus", "Creating track...", "info");
    const voiceMode = document.getElementById("voiceMode").value;
    const track = await api("POST", "/tracks", {
      title: "Song for " + document.getElementById("recipientName").value,
      occasion: document.getElementById("occasion").value,
      recipient_name: document.getElementById("recipientName").value,
      style: document.getElementById("style").value,
      duration_target: 60,
      voice_mode: voiceMode,
      message: document.getElementById("message").value,
    });
    console.log(`[Debug] Created track with voice_mode: ${voiceMode}`);
    state.trackId = track.track_id;
    updateDisplay("trackIdDisplay", state.trackId.slice(0, 8) + "...");

    // Step 2: Create version
    setStatus("songStatus", "Creating version...", "info");
    const version = await api("POST", `/tracks/${state.trackId}/versions`, {
      params: {},
      render_type: "preview",
    });
    state.versionNum = version.version_num;

    // Step 3: Generate lyrics
    setStatus("songStatus", "Generating lyrics with AI...", "info");
    const lyricsResult = await api(
      "POST",
      `/tracks/${state.trackId}/versions/${state.versionNum}/lyrics/generate`,
      {} // Empty body required for JSON content-type
    );

    // Display lyrics
    document.getElementById("lyricsDisplay").textContent = JSON.stringify(
      lyricsResult.lyrics,
      null,
      2
    );

    setStatus("songStatus", "Lyrics generated successfully!", "success");
    markComplete("section-song");
    enableSection("section-lyrics");
    document.getElementById("btnApproveLyrics").disabled = false;
  } catch (err) {
    setStatus("songStatus", err.message, "error");
    btn.disabled = false;
  }
}

// =============================================================================
// Section 3: Approve Lyrics
// =============================================================================
async function approveLyrics() {
  const btn = document.getElementById("btnApproveLyrics");
  btn.disabled = true;

  try {
    setStatus("lyricsStatus", "Approving lyrics...", "info");
    await api(
      "POST",
      `/tracks/${state.trackId}/versions/${state.versionNum}/lyrics/approve`,
      {} // Empty body required for JSON content-type
    );

    setStatus("lyricsStatus", "Lyrics approved!", "success");
    markComplete("section-lyrics");
    // NOW enable Render Preview (Section 4)
    enableSection("section-render");
    document.getElementById("btnRenderPreview").disabled = false;
  } catch (err) {
    setStatus("lyricsStatus", err.message, "error");
    btn.disabled = false;
  }
}

// =============================================================================
// Section 4: Render Preview
// =============================================================================
const RENDER_STEPS = [
  "moderation",
  "lyrics",
  "music_plan",
  "instrumental",
  "guide_vocal",
  "voice_convert",
  "mix",
  "watermark",
  "ready",
];

async function renderPreview() {
  const btn = document.getElementById("btnRenderPreview");
  btn.disabled = true;

  try {
    setStatus("renderStatus", "Starting preview render...", "info");
    document.getElementById("progressContainer").classList.remove("hidden");

    const result = await api(
      "POST",
      `/tracks/${state.trackId}/versions/${state.versionNum}/render_preview`,
      {} // Empty body required for JSON content-type
    );
    state.jobId = result.job_id;

    // Start polling
    pollJobStatus();
  } catch (err) {
    setStatus("renderStatus", err.message, "error");
    btn.disabled = false;
  }
}

function updateStepsDisplay(currentStepIndex) {
  const container = document.getElementById("stepsDisplay");
  // Clear existing children safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  RENDER_STEPS.forEach((step, i) => {
    const span = document.createElement("span");
    if (i < currentStepIndex) {
      span.style.color = "#4caf50";
      span.textContent = "\u2713 " + step; // checkmark
    } else if (i === currentStepIndex) {
      span.className = "current";
      span.textContent = "\u25B6 " + step; // play symbol
    } else {
      span.style.color = "#999";
      span.textContent = "\u25CB " + step; // circle
    }
    container.appendChild(span);

    // Add arrow separator except for last item
    if (i < RENDER_STEPS.length - 1) {
      const arrow = document.createTextNode(" \u2192 ");
      container.appendChild(arrow);
    }
  });
}

async function pollJobStatus() {
  const poll = async () => {
    try {
      const job = await api("GET", `/jobs/${state.jobId}`);

      // Update progress
      const stepIndex = RENDER_STEPS.indexOf(job.step);
      const progress = Math.round(
        ((Math.max(0, stepIndex) + 1) / RENDER_STEPS.length) * 100
      );
      document.getElementById("progressBar").style.width = progress + "%";

      // Update step display using safe DOM methods
      updateStepsDisplay(stepIndex);

      if (job.status === "completed") {
        setStatus("renderStatus", "Preview render complete!", "success");

        // Try to get the preview URL
        try {
          const track = await api("GET", `/tracks/${state.trackId}`);
          const version = track.versions?.find(
            (v) => v.version_num === state.versionNum
          );
          if (version?.preview_url) {
            const audio = document.getElementById("audioPreview");
            // Fetch audio with auth header and create blob URL
            // (HTML audio elements can't send custom headers)
            try {
              const audioResponse = await fetch(version.preview_url, {
                headers: { "x-user-id": state.userId },
              });
              if (audioResponse.ok) {
                const audioBlob = await audioResponse.blob();
                audio.src = URL.createObjectURL(audioBlob);
                audio.classList.remove("hidden");
              } else {
                console.log("Audio fetch failed:", audioResponse.status);
              }
            } catch (audioErr) {
              console.log("Could not load audio:", audioErr);
            }
          }
        } catch (e) {
          // Preview URL might not be available in local dev
          console.log("Could not fetch preview URL:", e);
        }

        markComplete("section-render");
      } else if (job.status === "failed") {
        setStatus(
          "renderStatus",
          "Render failed: " + (job.error_message || job.error_code || "Unknown error"),
          "error"
        );
      } else if (job.status === "blocked") {
        setStatus("renderStatus", "Render blocked (moderation issue)", "error");
      } else {
        // Keep polling
        setTimeout(poll, 1500);
      }
    } catch (err) {
      setStatus("renderStatus", "Polling error: " + err.message, "error");
    }
  };

  poll();
}

// =============================================================================
// Initialize
// =============================================================================
document.getElementById("btnGenerateLyrics").onclick = generateLyrics;
document.getElementById("btnApproveLyrics").onclick = approveLyrics;
document.getElementById("btnCompleteEnrollment").onclick = completeEnrollment;
document.getElementById("btnRenderPreview").onclick = renderPreview;

setupRecordButton("btnRecordSpoken", "audioSpoken", "chunk_spoken", "Spoken");
setupRecordButton("btnRecordSung", "audioSung", "chunk_sung", "Sung");

// Auto-start enrollment session on page load (Section 1 is now first)
startEnrollmentSession();

console.log("Porizo Debug Page initialized. User ID:", state.userId);
