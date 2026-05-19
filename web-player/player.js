/**
 * Porizo Web Player
 *
 * Stream-only player for shared songs.
 * Device binding is enforced server-side.
 */

(function () {
  "use strict";

  // Accessibility: detect reduced motion preference (reactive to mid-session changes)
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let prefersReducedMotion = motionQuery.matches;

  function clearLegacyAtmosphereLayers() {
    var petalLayer = document.getElementById("petal-layer");
    var bokehLayer = document.getElementById("bokeh-layer");
    if (petalLayer) {
      while (petalLayer.firstChild) {
        petalLayer.removeChild(petalLayer.firstChild);
      }
    }
    if (bokehLayer) {
      while (bokehLayer.firstChild) {
        bokehLayer.removeChild(bokehLayer.firstChild);
      }
    }
  }

  function handleReducedMotionChange(e) {
    prefersReducedMotion = e.matches;
    if (e.matches) {
      stopAtmosphere();
      clearLegacyAtmosphereLayers();
    }
    updateArtworkMotionState();
  }

  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", handleReducedMotionChange);
  } else if (motionQuery.addListener) {
    motionQuery.addListener(handleReducedMotionChange);
  }

  // State
  let shareId = null;
  let shareData = null;
  let streamUrl = null;
  let deviceId = null;
  let isPlaying = false;
  let receiverSaveUrl = "";
  let receiverSession = null;
  let playStartedLogged = false;
  let playCompletedLogged = false;
  let postPlayCtaViewed = false;
  let webStreamToken = null;
  let memoryDeviceId = null;
  let audioPlayerEventsBound = false;
  let shareButtonsBound = false;
  let postPlayCtaBound = false;
  let postPlayDismissBound = false;
  let teaserPlayerBound = false;
  let teaserUnlockCtaBound = false;
  let teaserShareBound = false;
  let letterboxEnabled = false;
  let letterboxWaveformBuilt = false;
  let letterboxChaptersBuilt = false;
  let artworkMotionProfile = "soft-breathe";
  let documentHidden = document.hidden;

  let teaserAudio = null;
  let teaserPlaying = false;

  // Teaser DOM elements (cached on first use)
  const teaserEls = {
    title: null,
    artwork: null,
    playBtn: null,
    playIcon: null,
    pauseIcon: null,
    progressFill: null,
    currentTime: null,
    duration: null,
    unlockCta: null,
  };

  function cacheTeaserEls() {
    teaserEls.title = document.getElementById("teaser-title");
    teaserEls.artwork = document.getElementById("teaser-artwork");
    teaserEls.playBtn = document.getElementById("teaser-play-btn");
    teaserEls.playIcon = document.getElementById("teaser-play-icon");
    teaserEls.pauseIcon = document.getElementById("teaser-pause-icon");
    teaserEls.progressFill = document.getElementById("teaser-progress-fill");
    teaserEls.currentTime = document.getElementById("teaser-current-time");
    teaserEls.duration = document.getElementById("teaser-duration");
    teaserEls.unlockCta = document.getElementById("teaser-unlock-cta");
  }

  // DOM Elements
  const screens = {
    loading: document.getElementById("loading"),
    error: document.getElementById("error"),
    expired: document.getElementById("expired"),
    teaser: document.getElementById("teaser"),
    player: document.getElementById("player"),
  };

  const elements = {
    errorMessage: document.getElementById("error-message"),
    errorAction: document.getElementById("error-action"),
    trackTitle: document.getElementById("track-title"),
    trackRecipient: document.getElementById("track-recipient"),
    audioPlayer: document.getElementById("audio-player"),
    playBtn: document.getElementById("play-btn"),
    playIcon: document.querySelector(".play-icon"),
    pauseIcon: document.querySelector(".pause-icon"),
    progressFill: document.getElementById("progress-fill"),
    currentTime: document.getElementById("current-time"),
    duration: document.getElementById("duration"),
    iosDownloadLink: document.getElementById("ios-download-link"),
    player: document.getElementById("player"),
    playerArtworkBackdrop: document.getElementById("player-artwork-backdrop"),
    playerArtworkImage: document.getElementById("player-artwork-image"),
    letterboxTop: document.getElementById("letterbox-top"),
    letterboxSlateOccasion: document.getElementById("letterbox-slate-occasion"),
    letterboxSlateTrack: document.getElementById("letterbox-slate-track"),
    letterboxSlateYear: document.getElementById("letterbox-slate-year"),
    letterboxVoice: document.getElementById("letterbox-voice"),
    letterboxFrameCounter: document.getElementById("letterbox-frame-counter"),
    letterboxBurnIn: document.getElementById("letterbox-burn-in"),
    letterboxSubtitlePrev: document.getElementById("letterbox-subtitle-prev"),
    letterboxSubtitleActive: document.getElementById(
      "letterbox-subtitle-active",
    ),
    letterboxWaveform: document.getElementById("letterbox-waveform"),
    letterboxChapters: document.getElementById("letterbox-chapters"),
    letterboxProgressDot: document.getElementById("letterbox-progress-dot"),
  };

  // Utilities
  function showScreen(screenName) {
    Object.values(screens).forEach((screen) => {
      if (screen) screen.classList.remove("active");
    });
    if (screens[screenName]) {
      screens[screenName].classList.add("active");
    }
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (_e) {
      // Storage can be blocked in private browsing. Nothing to clean up.
    }
  }

  function getDeviceId() {
    // Get or create a persistent device ID
    let id = storageGet("porizo_device_id");
    if (!id) {
      id = memoryDeviceId || "web_" + crypto.randomUUID();
      memoryDeviceId = id;
      storageSet("porizo_device_id", id);
    }
    return id;
  }

  function getApiBaseUrl() {
    // In production, use same origin. For development, can be overridden.
    return window.PORIZO_API_URL || "";
  }

  function getReceiverSessionKey() {
    return shareId ? `porizo_receiver_session_${shareId}` : null;
  }

  function loadStoredReceiverSession() {
    var key = getReceiverSessionKey();
    if (!key) return null;
    try {
      var raw = storageGet(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (
        parsed &&
        /^rs_[a-f0-9]{24}$/.test(parsed.receiver_session_id || "") &&
        /^[a-f0-9]{48}$/.test(parsed.receiver_session_secret || "")
      ) {
        return parsed;
      }
    } catch (_e) {
      storageRemove(key);
    }
    return null;
  }

  function saveReceiverSession(nextSession) {
    var key = getReceiverSessionKey();
    if (!key || !nextSession) return;
    receiverSession = nextSession;
    storageSet(key, JSON.stringify(nextSession));
  }

  function buildShareAttribution(placement) {
    var slot = placement || "app_bar";
    return {
      ref: shareId ? `/play/${shareId}` : "",
      utm_source: "share_player",
      utm_medium: "recipient_loop",
      utm_campaign: "shared_song_recipient",
      utm_content: shareId ? `${slot}_${shareId}` : slot,
    };
  }

  function buildDownloadUrl({
    deepLink = null,
    platform = null,
    placement = "app_bar",
  } = {}) {
    const params = new URLSearchParams();
    if (platform) {
      params.set("platform", platform);
    }
    if (platform !== "android") {
      params.set("channel", "appstore");
    }
    if (deepLink) {
      params.set("deep_link", deepLink);
    }
    var attribution = buildShareAttribution(placement);
    Object.keys(attribution).forEach(function (key) {
      if (attribution[key]) {
        params.set(key, attribution[key]);
      }
    });
    const query = params.toString();
    return query ? `/download?${query}` : "/download";
  }

  function buildReceiverSaveFallbackUrl(placement) {
    return buildDownloadUrl({ placement: placement || "app_bar" });
  }

  function updateDownloadLinks() {
    const iosUrl = receiverSaveUrl || buildReceiverSaveFallbackUrl("app_bar");
    if (elements.iosDownloadLink) {
      elements.iosDownloadLink.setAttribute("href", iosUrl);
    }
  }

  function capitalizeOccasion(value) {
    if (!value || typeof value !== "string") return "";
    // Normalize snake/kebab/underscore separators to spaces, collapse whitespace,
    // then title-case each word so "mothers_day" → "Mothers Day".
    return value
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function getTrackInfo() {
    return shareData && (shareData.track || shareData.track_preview)
      ? shareData.track || shareData.track_preview
      : null;
  }

  function getExperienceHeading(trackInfo) {
    if (!trackInfo) return "Someone made you a song!";
    const recipientName = (trackInfo.recipient_name || "").trim();
    const occasion = capitalizeOccasion((trackInfo.occasion || "").trim());
    if (recipientName && occasion)
      return `${occasion} song for ${recipientName}`;
    if (recipientName) return `A song for ${recipientName}`;
    return trackInfo.title || "Someone made you a song!";
  }

  function getExperienceSubtitle(trackInfo) {
    if (!trackInfo) return "Open the gift and listen.";
    const senderName = (trackInfo.sender_name || "").trim();
    const recipientName = (trackInfo.recipient_name || "").trim();
    if (senderName) return `From ${senderName}`;
    if (recipientName) return `Made for ${recipientName}`;
    return "Open the gift and listen.";
  }

  function getLetterboxOverride() {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("letterbox");
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return null;
  }

  function getArtworkMotionOverride() {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("artwork_motion");
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return null;
  }

  function hashToPercent(value) {
    var input = String(value || "");
    var hash = 2166136261;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % 100;
  }

  function hashToNumber(value, modulo) {
    var input = String(value || "");
    var hash = 2166136261;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const size = Number(modulo);
    return (
      Math.abs(hash >>> 0) % (Number.isFinite(size) && size > 0 ? size : 1000)
    );
  }

  function shouldUseLetterbox() {
    const override = getLetterboxOverride();
    if (override !== null) return override;
    const flags =
      shareData && shareData.feature_flags ? shareData.feature_flags : {};
    if (!flags.web_player_letterbox_enabled) return false;
    const rollout = Number(flags.web_player_letterbox_rollout_percent || 0);
    if (!Number.isFinite(rollout) || rollout <= 0) return false;
    if (rollout >= 100) return true;
    return hashToPercent(shareId) < rollout;
  }

  function normalizeOccasionShort(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const map = {
      mothers_day: "M.DAY",
      mother_day: "M.DAY",
      birthday: "B.DAY",
      anniversary: "A.DAY",
      valentines: "V.DAY",
      valentine: "V.DAY",
      christmas: "XMAS",
      wedding: "WED.",
      friendship: "FRND",
      thank_you: "THX",
    };
    return map[normalized] || "ORIG";
  }

  function normalizeArtworkMotionProfile(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\u2019']/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    // Map keyed by the backend's tracks.occasion slug (see
    // src/services/artwork-vocab.js OCCASIONS list). Every backend occasion
    // is explicitly mapped so a future addition forces a deliberate motion
    // choice instead of silently defaulting. The lock test at
    // test/web-player-motion-helpers.test.js asserts this coverage.
    //
    // Legacy/aliased keys (mother_day, valentines*, memorial, sympathy) are
    // kept for resilience against display labels and historical slugs even
    // though they aren't in the current backend vocab.
    const map = {
      // \u2014 Soft-breathe: warm-but-restrained tribute songs \u2014
      mothers_day: "soft-breathe",
      mother_day: "soft-breathe",
      thank_you: "soft-breathe",
      friendship: "soft-breathe",
      encouragement: "soft-breathe",
      custom: "soft-breathe",
      // \u2014 Warm-pulse: celebratory, lively songs \u2014
      birthday: "warm-pulse",
      celebration: "warm-pulse",
      graduation: "warm-pulse",
      // \u2014 Cinematic-drift: romantic, sweeping songs \u2014
      anniversary: "cinematic-drift",
      wedding: "cinematic-drift",
      i_love_you: "cinematic-drift",
      valentines: "cinematic-drift",
      valentines_day: "cinematic-drift",
      valentine: "cinematic-drift",
      valentine_day: "cinematic-drift",
      // \u2014 Near-still: somber, reflective, recovery \u2014
      bereavement: "near-still",
      apology: "near-still",
      get_well: "near-still",
      advice: "near-still",
      memorial: "near-still",
      sympathy: "near-still",
    };
    return map[normalized] || "soft-breathe";
  }

  function shouldEnableArtworkMotion(state) {
    return Boolean(
      state &&
      state.letterboxEnabled &&
      state.isPlaying &&
      state.hasArtwork &&
      !state.prefersReducedMotion &&
      !state.documentHidden,
    );
  }

  function shouldAllowArtworkMotionByRollout(override) {
    return override === true;
  }

  function formatYear(value) {
    const date = value ? new Date(value) : new Date();
    const year = date.getFullYear();
    return Number.isFinite(year)
      ? String(year)
      : String(new Date().getFullYear());
  }

  function formatTimecode(seconds, includeHour) {
    const fps = 24;
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const totalFrames = Math.floor(safe * fps);
    const frames = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    const mm = String(mins).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    const ff = String(frames).padStart(2, "0");
    if (includeHour) {
      return `${String(hours).padStart(2, "0")}:${mm}:${ss}:${ff}`;
    }
    return `${mm}:${ss}:${ff}`;
  }

  function getDurationSeconds(trackInfo) {
    const audio = elements.audioPlayer;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0)
      return audio.duration;
    const ms = Number(trackInfo && trackInfo.duration_ms);
    if (Number.isFinite(ms) && ms > 0) return ms / 1000;
    const seconds = Number(trackInfo && trackInfo.duration_sec);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  }

  function setLetterboxMeta() {
    const trackInfo = getTrackInfo();
    if (!trackInfo) return;
    const trackId = String(trackInfo.id || shareId || "000");
    const trackSuffix = String(hashToNumber(trackId, 1000)).padStart(3, "0");
    const senderName = (trackInfo.sender_name || "").trim();
    const recipientName = (trackInfo.recipient_name || "").trim();
    const year = formatYear(trackInfo.created_at);
    artworkMotionProfile = normalizeArtworkMotionProfile(trackInfo.occasion);

    if (elements.letterboxSlateOccasion) {
      elements.letterboxSlateOccasion.textContent = normalizeOccasionShort(
        trackInfo.occasion,
      );
    }
    if (elements.letterboxSlateTrack) {
      elements.letterboxSlateTrack.textContent = `TRACK ${trackSuffix}`;
    }
    if (elements.letterboxSlateYear) {
      elements.letterboxSlateYear.textContent = `REL. ${year}`;
    }
    if (elements.letterboxVoice) {
      if (senderName) {
        elements.letterboxVoice.textContent = `In ${senderName}'s voice`;
      } else if (recipientName) {
        elements.letterboxVoice.textContent = `A song for ${recipientName}`;
      } else {
        elements.letterboxVoice.textContent = "An original song";
      }
    }
  }

  function syncDocumentChrome() {
    if (document.documentElement) {
      document.documentElement.style.colorScheme = letterboxEnabled
        ? "dark"
        : "";
    }
  }

  function markLetterboxCurtainOpened() {
    if (!elements.player || prefersReducedMotion) {
      if (elements.player) elements.player.classList.add("letterbox-opened");
      return;
    }
    const key = shareId
      ? `porizo_letterbox_opened_${shareId}`
      : "porizo_letterbox_opened";
    let alreadyOpened = false;
    try {
      alreadyOpened = window.sessionStorage.getItem(key) === "1";
      window.sessionStorage.setItem(key, "1");
    } catch (_e) {
      alreadyOpened = false;
    }
    if (alreadyOpened) {
      elements.player.classList.add("letterbox-opened");
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        elements.player.classList.add("letterbox-opened");
      });
    });
  }

  function buildLetterboxWaveform() {
    if (!elements.letterboxWaveform || letterboxWaveformBuilt) return;
    letterboxWaveformBuilt = true;
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 220 40");
    svg.setAttribute("preserveAspectRatio", "none");
    const baseGroup = document.createElementNS(svgNs, "g");
    baseGroup.setAttribute("class", "wf-base");
    const playedGroup = document.createElementNS(svgNs, "g");
    playedGroup.setAttribute("class", "wf-played");
    const clip = document.createElementNS(svgNs, "clipPath");
    clip.setAttribute("id", "letterbox-waveform-clip");
    const clipRect = document.createElementNS(svgNs, "rect");
    clipRect.setAttribute("id", "letterbox-waveform-clip-rect");
    clipRect.setAttribute("x", "0");
    clipRect.setAttribute("y", "0");
    clipRect.setAttribute("width", "0");
    clipRect.setAttribute("height", "40");
    clip.appendChild(clipRect);
    const defs = document.createElementNS(svgNs, "defs");
    defs.appendChild(clip);
    playedGroup.setAttribute("clip-path", "url(#letterbox-waveform-clip)");

    for (let i = 0; i < 220; i++) {
      const phase = i / 219;
      const verseShape = 0.36 + 0.42 * Math.sin(phase * Math.PI);
      const texture = 0.18 * Math.sin(i * 0.61) + 0.12 * Math.sin(i * 1.73);
      const height = Math.max(4, Math.min(34, 8 + (verseShape + texture) * 24));
      const y = 20 - height / 2;
      const x = i;
      const makeRect = function (className) {
        const rect = document.createElementNS(svgNs, "rect");
        rect.setAttribute("class", className);
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", y.toFixed(2));
        rect.setAttribute("width", "0.55");
        rect.setAttribute("height", height.toFixed(2));
        rect.setAttribute("rx", "0.35");
        return rect;
      };
      baseGroup.appendChild(makeRect("wf-bar"));
      playedGroup.appendChild(makeRect("wf-bar"));
    }
    svg.appendChild(defs);
    svg.appendChild(baseGroup);
    svg.appendChild(playedGroup);
    elements.letterboxWaveform.textContent = "";
    elements.letterboxWaveform.appendChild(svg);
  }

  function getChapterMarkers(trackInfo) {
    const raw =
      (shareData && shareData.chapter_markers) ||
      (trackInfo && trackInfo.chapter_markers) ||
      [];
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (marker) {
        return {
          label: String(marker.label || "Chapter").slice(0, 24),
          tMs: Number(marker.t_ms || marker.tMs || 0),
        };
      })
      .filter(function (marker) {
        return Number.isFinite(marker.tMs) && marker.tMs >= 0;
      })
      .slice(0, 6);
  }

  function buildLetterboxChapters() {
    if (!elements.letterboxChapters || letterboxChaptersBuilt) return;
    const trackInfo = getTrackInfo();
    const durationSeconds = getDurationSeconds(trackInfo);
    const durationMs = Math.max(1000, durationSeconds * 1000);
    const markers = getChapterMarkers(trackInfo);
    elements.letterboxChapters.textContent = "";
    markers.forEach(function (marker) {
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "letterbox-chapter";
      tick.dataset.label = marker.label;
      tick.setAttribute("aria-label", `Jump to ${marker.label}`);
      tick.style.left = `${Math.min(98, Math.max(0, (marker.tMs / durationMs) * 100))}%`;
      tick.addEventListener("click", function (event) {
        event.stopPropagation();
        if (
          elements.audioPlayer &&
          Number.isFinite(elements.audioPlayer.duration)
        ) {
          elements.audioPlayer.currentTime = Math.min(
            elements.audioPlayer.duration - 0.2,
            marker.tMs / 1000,
          );
        }
      });
      elements.letterboxChapters.appendChild(tick);
    });
    letterboxChaptersBuilt = true;
  }

  function updateLetterboxProgress(currentSeconds, durationSeconds) {
    if (!letterboxEnabled) return;
    const safeDuration =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : getDurationSeconds(getTrackInfo());
    const safeCurrent =
      Number.isFinite(currentSeconds) && currentSeconds > 0
        ? currentSeconds
        : 0;
    const pct = Math.min(100, Math.max(0, (safeCurrent / safeDuration) * 100));
    const clipRect = document.getElementById("letterbox-waveform-clip-rect");
    if (clipRect) clipRect.setAttribute("width", String((pct / 100) * 220));
    if (elements.letterboxProgressDot)
      elements.letterboxProgressDot.style.left = `${pct}%`;
    if (elements.letterboxFrameCounter) {
      elements.letterboxFrameCounter.textContent = `${formatTimecode(3600 + safeCurrent, true)}/${formatTimecode(3600 + safeDuration, true)}`;
    }
    if (elements.letterboxBurnIn) {
      elements.letterboxBurnIn.textContent = `TC ${formatTimecode(3600 + safeCurrent, true)}`;
    }
  }

  function updateLetterboxSubtitle(currentIndex) {
    if (!letterboxEnabled || !elements.letterboxSubtitleActive) return;
    const active = currentIndex >= 0 ? lineTimings[currentIndex] : null;
    const previous = currentIndex > 0 ? lineTimings[currentIndex - 1] : null;
    if (elements.letterboxSubtitlePrev) {
      elements.letterboxSubtitlePrev.textContent = previous
        ? previous.text
        : "";
    }
    elements.letterboxSubtitleActive.classList.toggle(
      "is-placeholder",
      !active,
    );
    // Empty subtitle pre-play: the placeholder text was overlapping the
    // recipient watermark composited into the cover artwork. The play
    // button in the bottom bar already signals the affordance.
    elements.letterboxSubtitleActive.textContent = active ? active.text : "";
  }

  function applyLetterboxMode() {
    letterboxEnabled = shouldUseLetterbox();
    if (!elements.player) return;
    elements.player.classList.toggle("letterbox", letterboxEnabled);
    syncDocumentChrome();
    if (!letterboxEnabled) {
      elements.player.classList.remove("letterbox-opened");
      elements.player.classList.remove("letterbox-playing");
      updateArtworkMotionState();
      return;
    }
    setLetterboxMeta();
    buildLetterboxWaveform();
    buildLetterboxChapters();
    updateLetterboxSubtitle(activeLineIndex);
    updateLetterboxProgress(0, getDurationSeconds(getTrackInfo()));
    markLetterboxCurtainOpened();
    updateArtworkMotionState();
  }

  function setPlayerArtworkAvailable(available) {
    if (!elements.player) return;
    elements.player.classList.toggle("has-player-artwork", Boolean(available));
    if (!available) {
      elements.player.style.removeProperty("--player-artwork-url");
    }
    updateArtworkMotionState();
  }

  function updateArtworkMotionState() {
    if (!elements.player) return;

    const override = getArtworkMotionOverride();
    const hasArtwork = elements.player.classList.contains("has-player-artwork");
    const eligible = shouldEnableArtworkMotion({
      letterboxEnabled,
      isPlaying,
      hasArtwork,
      prefersReducedMotion,
      documentHidden,
    });
    const enabled = shouldAllowArtworkMotionByRollout(override) && eligible;

    elements.player.classList.toggle("artwork-motion", enabled);
    elements.player.classList.toggle(
      "artwork-motion-soft-breathe",
      enabled && artworkMotionProfile === "soft-breathe",
    );
    elements.player.classList.toggle(
      "artwork-motion-warm-pulse",
      enabled && artworkMotionProfile === "warm-pulse",
    );
    elements.player.classList.toggle(
      "artwork-motion-cinematic-drift",
      enabled && artworkMotionProfile === "cinematic-drift",
    );
    elements.player.classList.toggle(
      "artwork-motion-near-still",
      enabled && artworkMotionProfile === "near-still",
    );
  }

  function updateTrackInfo() {
    const trackInfo = getTrackInfo();
    if (trackInfo) {
      elements.trackTitle.textContent = getExperienceHeading(trackInfo);
      elements.trackRecipient.textContent = getExperienceSubtitle(trackInfo);
    }
  }

  function getPlayerArtworkUrl(trackInfo) {
    if (!trackInfo) return "";
    if (letterboxEnabled) {
      return (
        trackInfo.artwork_url ||
        trackInfo.cover_image_large_url ||
        trackInfo.cover_image_url ||
        trackInfo.player_artwork_url ||
        trackInfo.cover_image_small_url ||
        ""
      );
    }
    return (
      trackInfo.player_artwork_url ||
      trackInfo.artwork_url ||
      trackInfo.cover_image_large_url ||
      trackInfo.cover_image_url ||
      trackInfo.cover_image_small_url ||
      ""
    );
  }

  function applyPlayerArtwork() {
    const trackInfo = getTrackInfo();
    const artworkUrl = getPlayerArtworkUrl(trackInfo);
    if (!elements.player || !elements.playerArtworkImage || !artworkUrl) {
      setPlayerArtworkAvailable(false);
      return;
    }

    elements.player.style.setProperty(
      "--player-artwork-url",
      `url(${JSON.stringify(artworkUrl)})`,
    );
    elements.playerArtworkImage.onload = function () {
      setPlayerArtworkAvailable(true);
    };
    elements.playerArtworkImage.onerror = function () {
      elements.playerArtworkImage.removeAttribute("src");
      setPlayerArtworkAvailable(false);
    };
    if (elements.playerArtworkImage.getAttribute("src") !== artworkUrl) {
      elements.playerArtworkImage.src = artworkUrl;
    } else {
      setPlayerArtworkAvailable(
        elements.playerArtworkImage.complete &&
          elements.playerArtworkImage.naturalWidth > 0,
      );
    }
  }

  // Lyrics — line-level timing and highlighting
  let lineTimings = []; // flat array: { text, startTime, endTime, sectionName }
  let activeLineIndex = -1;
  let cachedLineEls = [];
  let cachedLabelEls = [];

  function formatSectionLabel(name) {
    return name.replace(/([a-z])(\d+)/g, "$1 $2").toUpperCase();
  }

  /**
   * Estimate per-line timing when server doesn't provide timestamps.
   * Returns the same enriched format as server alignment.
   */
  function estimateLineTiming(sections, totalDuration) {
    var SECONDS_PER_LINE = 3.2;
    var GAP_BETWEEN_SECTIONS = 4.5;
    var totalLines = 0;
    sections.forEach(function (s) {
      var lines = Array.isArray(s.lines) ? s.lines : [];
      totalLines += lines.length;
    });
    if (totalLines === 0) return [];

    var rawDur =
      totalLines * SECONDS_PER_LINE +
      (sections.length - 1) * GAP_BETWEEN_SECTIONS;
    var scale =
      rawDur > totalDuration * 0.85 ? (totalDuration * 0.85) / rawDur : 1.0;
    var introTime =
      rawDur > totalDuration * 0.85
        ? totalDuration * 0.05
        : Math.min(totalDuration * 0.08, 15);

    var elapsed = introTime;
    var result = [];
    sections.forEach(function (section, si) {
      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function (line) {
        var text = typeof line === "string" ? line : line.text || "";
        var dur = SECONDS_PER_LINE * scale;
        result.push({
          text: text,
          startTime: elapsed,
          endTime: elapsed + dur,
          sectionName: section.name,
        });
        elapsed += dur;
      });
      if (si < sections.length - 1) elapsed += GAP_BETWEEN_SECTIONS * scale;
    });
    return result;
  }

  /**
   * Flatten server-enriched sections (with per-line timing) into lineTimings array.
   */
  function flattenServerTiming(sections) {
    var result = [];
    sections.forEach(function (section) {
      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function (line) {
        if (typeof line === "object" && line.startTime !== undefined) {
          result.push({
            text: line.text,
            startTime: line.startTime,
            endTime: line.endTime,
            sectionName: section.name,
          });
        } else {
          // Section has timing but lines are plain strings — distribute evenly
          var text = typeof line === "string" ? line : line.text || "";
          result.push({
            text: text,
            startTime: null,
            endTime: null,
            sectionName: section.name,
          });
        }
      });
    });

    // Fill nulls from section-level timing
    if (
      result.some(function (l) {
        return l.startTime == null;
      }) &&
      sections.some(function (s) {
        return s.startTime != null;
      })
    ) {
      sections.forEach(function (section) {
        if (section.startTime == null) return;
        var sLines = result.filter(function (l) {
          return l.sectionName === section.name && l.startTime == null;
        });
        if (sLines.length === 0) return;
        var dur = (section.endTime - section.startTime) / sLines.length;
        sLines.forEach(function (l, i) {
          l.startTime = section.startTime + i * dur;
          l.endTime = section.startTime + (i + 1) * dur;
        });
      });
    }

    return result;
  }

  /**
   * Render lyrics as individual line elements for immersive display.
   */
  function renderLyrics(sections) {
    const container = document.getElementById("lyrics-container");
    const scroll = document.getElementById("lyrics-scroll");
    if (!container || !scroll || !sections || sections.length === 0) return;

    scroll.textContent = "";
    let lastSectionName = null;
    let lineIdx = 0;

    sections.forEach(function (section) {
      // Section label
      var sectionName = section.name || "section";
      if (sectionName !== lastSectionName) {
        var label = document.createElement("p");
        label.className = "lyrics-section-label";
        label.textContent = formatSectionLabel(sectionName);
        label.dataset.sectionName = sectionName;
        scroll.appendChild(label);
        lastSectionName = sectionName;
      }

      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function (line) {
        var text = typeof line === "string" ? line : line.text || "";
        var p = document.createElement("p");
        p.className = "lyric-line";
        p.textContent = text;
        p.dataset.lineIndex = lineIdx;
        // Stagger entrance animation — each line reveals slightly after the previous
        if (!prefersReducedMotion) {
          p.style.animationDelay = 0.15 + lineIdx * 0.06 + "s";
        }
        scroll.appendChild(p);
        lineIdx++;
      });
    });

    cachedLineEls = Array.from(scroll.querySelectorAll(".lyric-line"));
    cachedLabelEls = Array.from(
      scroll.querySelectorAll(".lyrics-section-label"),
    );
    container.style.display = "";
  }

  /**
   * Update active line highlight with proximity glow and smooth center-scroll.
   */
  function updateActiveLine(currentTime) {
    if (lineTimings.length === 0 || cachedLineEls.length === 0) return;

    var newIndex = -1;
    for (var i = 0; i < lineTimings.length; i++) {
      if (
        currentTime >= lineTimings[i].startTime &&
        currentTime < lineTimings[i].endTime
      ) {
        newIndex = i;
        break;
      }
    }

    if (newIndex === activeLineIndex) return;
    activeLineIndex = newIndex;
    updateLetterboxSubtitle(newIndex);

    // Update line classes with proximity awareness
    var activeSectionName =
      newIndex >= 0 ? lineTimings[newIndex].sectionName : null;
    var NEAR_RANGE = 2; // Lines within ±2 of active get .near

    cachedLineEls.forEach(function (el, i) {
      var isActive = i === newIndex;
      var isSung = newIndex >= 0 && i < newIndex;
      var isNear =
        newIndex >= 0 && !isActive && Math.abs(i - newIndex) <= NEAR_RANGE;

      el.classList.toggle("active", isActive);
      el.classList.toggle("sung", isSung);
      el.classList.toggle("near", isNear);
    });

    // Update section label highlighting
    cachedLabelEls.forEach(function (el) {
      el.classList.toggle(
        "active-section",
        el.dataset.sectionName === activeSectionName,
      );
    });

    // Smooth scroll active line to center
    if (newIndex >= 0 && cachedLineEls[newIndex]) {
      var scroll = document.getElementById("lyrics-scroll");
      var target = cachedLineEls[newIndex];
      var scrollTop =
        target.offsetTop - scroll.offsetHeight / 2 + target.offsetHeight / 2;
      scroll.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
    }
  }

  // API Calls
  async function fetchShareInfo(shareId) {
    const response = await fetch(`${getApiBaseUrl()}/share/${shareId}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function getStreamUrl(shareId, includeHeaders = true) {
    const headers = includeHeaders
      ? {
          "X-Device-Id": deviceId,
          "X-Platform": "web",
        }
      : {};

    if (webStreamToken) {
      headers["X-Web-Stream-Token"] = webStreamToken;
    }

    const response = await fetch(`${getApiBaseUrl()}/share/${shareId}/stream`, {
      headers,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function recordReceiverEvent(eventName, metadata, options = {}) {
    if (!shareId) return null;
    var payload = {
      event_name: eventName,
      metadata: metadata || {},
    };
    if (
      receiverSession &&
      receiverSession.receiver_session_id &&
      receiverSession.receiver_session_secret
    ) {
      payload.receiver_session_id = receiverSession.receiver_session_id;
      payload.receiver_session_secret = receiverSession.receiver_session_secret;
    }

    const response = await fetch(
      `${getApiBaseUrl()}/share/${encodeURIComponent(shareId)}/receiver-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: Boolean(options.keepalive),
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.receiver_session_id && data.receiver_session_secret) {
      saveReceiverSession({
        receiver_session_id: data.receiver_session_id,
        receiver_session_secret: data.receiver_session_secret,
      });
    }
    if (data.receiver_save_url) {
      receiverSaveUrl = data.receiver_save_url;
      updateDownloadLinks();
    }
    return data;
  }

  async function safeRecordReceiverEvent(eventName, metadata, options = {}) {
    try {
      return await recordReceiverEvent(eventName, metadata, options);
    } catch (error) {
      console.warn("[Receiver] event failed:", eventName, error);
      return null;
    }
  }

  function handleReceiverSaveClick(event, placement) {
    var link = event.currentTarget;
    if (!link || !link.href) return;

    event.preventDefault();
    var targetHref = link.href;
    var navigated = false;

    function navigate(nextUrl) {
      if (navigated) return;
      navigated = true;
      window.location.href = nextUrl || targetHref;
    }

    recordReceiverEvent(
      "receiver_save_cta_clicked",
      { placement: placement || "app_bar" },
      { keepalive: true },
    )
      .then(function (data) {
        if (data && data.receiver_save_url) {
          targetHref = data.receiver_save_url;
        }
        navigate(targetHref);
      })
      .catch(function () {
        navigate(targetHref);
      });

    setTimeout(
      function () {
        navigate(targetHref);
      },
      receiverSaveUrl ? 350 : 1500,
    );
  }

  // Screen Handlers
  async function initializePlayer() {
    try {
      // Get share ID from URL
      const pathParts = window.location.pathname.split("/");
      shareId =
        pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

      if (!shareId || shareId === "web-player") {
        showError("Invalid share link");
        return;
      }

      updateDownloadLinks();

      // Get device ID
      deviceId = getDeviceId();

      // Fetch share info
      shareData = await fetchShareInfo(shareId);
      receiverSession = loadStoredReceiverSession();
      await safeRecordReceiverEvent("receiver_link_opened", {
        placement: "page_load",
      });
      updateDownloadLinks();

      if (shareData.status === "expired") {
        showScreen("expired");
        return;
      }

      // Claimed shares can still offer public browser playback while
      // app ownership remains device-bound.
      if (shareData.status === "claimed") {
        if (shareData.can_access) {
          await loadPlayer(true);
          return;
        }
        if (shareData.web_stream_url) {
          await loadPlayer(false);
          return;
        }
      }

      // For unclaimed shares
      if (shareData.status === "unbound") {
        if (!shareData.web_stream_url && shareData.teaser_url) {
          await loadTeaser();
          return;
        }
        await loadPlayer(false);
        return;
      }
      // Claimed by another device with no public browser listening surface
      showError(
        "This link has already been claimed on another device. Ask the sender for a new link.",
        {
          label: "Get the app",
          href: receiverSaveUrl || buildReceiverSaveFallbackUrl("app_bar"),
        },
      );
    } catch (error) {
      console.error("Init error:", error);
      if (error.message === "SHARE_NOT_FOUND") {
        showError("This share link was not found or has been revoked.");
      } else if (error.message === "SHARE_EXPIRED") {
        showScreen("expired");
      } else {
        showError(error.message);
      }
    }
  }

  function showError(message, action) {
    if (elements.errorAction) {
      const label = action?.label || "Go Home";
      const href = action?.href || "/";
      elements.errorAction.textContent = label;
      elements.errorAction.setAttribute("href", href);
    }
    elements.errorMessage.textContent = message;
    showScreen("error");
  }

  async function loadPlayer(claimed = false) {
    showScreen("loading");

    try {
      // Get stream URL (include device headers only for claimed shares)
      const streamData = await getStreamUrl(shareId, claimed);
      streamUrl = streamData.stream_url;
      const streamFormat = streamData.format || "audio";

      // Append web stream token as query param for <audio> element auth
      if (webStreamToken && streamUrl && streamUrl.includes("/audio")) {
        const sep = streamUrl.includes("?") ? "&" : "?";
        streamUrl = `${streamUrl}${sep}wst=${encodeURIComponent(webStreamToken)}`;
      }

      updateTrackInfo();
      applyLetterboxMode();
      applyPlayerArtwork();

      // Render lyrics if available
      if (shareData.lyrics && shareData.lyrics.length > 0) {
        renderLyrics(shareData.lyrics);
        updateLetterboxSubtitle(-1);
      }

      // Set up audio player with format hint
      setupAudioPlayer(streamUrl, streamFormat);
      setupShareButtons();
      setupPostPlayCta();
      hidePostPlayCta();
      showScreen("player");
    } catch (error) {
      console.error("Load player error:", error);
      if (error.message === "TOKEN_ALREADY_BOUND") {
        showError("This link is already claimed on another device.", {
          label: "Get the app",
          href: receiverSaveUrl || buildReceiverSaveFallbackUrl("app_bar"),
        });
      } else if (error.message === "WEB_STREAM_NOT_ALLOWED") {
        showError(
          "Web playback is disabled for this song. Open the Porizo app to claim and listen.",
          {
            label: "Get the app",
            href: receiverSaveUrl || buildReceiverSaveFallbackUrl("app_bar"),
          },
        );
      } else if (error.message === "RATE_LIMITED") {
        showError(
          "Too many plays right now. Please try again in a few minutes.",
        );
      } else {
        showError("Unable to load the song. Please try again.");
      }
    }
  }

  function setupAudioPlayer(url, format = "audio") {
    const audio = elements.audioPlayer;

    // Use format hint from server, fallback to extension detection
    const isHls = format === "hls" || url.endsWith(".m3u8");

    if (isHls) {
      // For HLS streaming, we need HLS.js for non-Safari browsers
      if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari has native HLS support
        audio.src = url;
      } else if (typeof Hls !== "undefined" && Hls.isSupported()) {
        // Use HLS.js
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else {
        // Fallback: try direct URL anyway
        audio.src = url;
      }
    } else {
      // Direct audio file (format: "audio")
      audio.src = url;
    }

    audio.load();

    // Event listeners
    // Start/stop atmospheric effects directly from audio events
    if (audioPlayerEventsBound) return;
    audioPlayerEventsBound = true;

    audio.addEventListener("playing", () => {
      setMainPlaybackState(true);
      hidePostPlayCta();
      if (!letterboxEnabled) startAtmosphere();
      if (!playStartedLogged) {
        playStartedLogged = true;
        safeRecordReceiverEvent("receiver_play_started", {
          placement: "player",
        });
      }
    });

    audio.addEventListener("pause", () => {
      setMainPlaybackState(false);
      stopAtmosphere();
    });

    audio.addEventListener("loadedmetadata", () => {
      elements.duration.textContent = formatTime(audio.duration);
      buildLetterboxChapters();
      updateLetterboxProgress(audio.currentTime, audio.duration);
      // Build line-level timing: server timestamps or client estimation
      if (shareData.lyrics && shareData.lyrics.length > 0) {
        var hasServerTiming =
          shareData.lyrics[0].startTime !== undefined ||
          (shareData.lyrics[0].lines &&
            shareData.lyrics[0].lines[0] &&
            typeof shareData.lyrics[0].lines[0] === "object" &&
            shareData.lyrics[0].lines[0].startTime !== undefined);

        if (hasServerTiming) {
          lineTimings = flattenServerTiming(shareData.lyrics);
        } else {
          lineTimings = estimateLineTiming(shareData.lyrics, audio.duration);
        }
      }
    });

    audio.addEventListener("timeupdate", () => {
      if (!audio.paused && !flowerInterval) startAtmosphere();
      if (audio.paused && flowerInterval) stopAtmosphere();
      const progress = (audio.currentTime / audio.duration) * 100;
      elements.progressFill.style.width = `${progress}%`;
      elements.currentTime.textContent = formatTime(audio.currentTime);
      updateActiveLine(audio.currentTime);
      updateLetterboxProgress(audio.currentTime, audio.duration);
    });

    audio.addEventListener("ended", () => {
      setMainPlaybackState(false);
      stopAtmosphere();
      elements.progressFill.style.width = "0%";
      updateLetterboxProgress(0, audio.duration);
      audio.currentTime = 0;
      activeLineIndex = -1;
      updateLetterboxSubtitle(-1);
      cachedLineEls.forEach((el) => {
        el.classList.remove("active");
        el.classList.remove("sung");
      });
      cachedLabelEls.forEach((el) => el.classList.remove("active-section"));
      const lyricsScroll = document.getElementById("lyrics-scroll");
      if (lyricsScroll) lyricsScroll.scrollTop = 0;
      showPostPlayCta();
      if (!playCompletedLogged) {
        playCompletedLogged = true;
        safeRecordReceiverEvent("receiver_play_completed", {
          placement: "player",
        });
      }
    });

    audio.addEventListener("error", (e) => {
      console.error("Audio error:", e);
      setMainPlaybackState(false);
      stopAtmosphere();
      showError("Unable to play this audio. Please try again.");
    });

    // Progress bar click to seek
    document.querySelector(".progress-bar").addEventListener("click", (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      audio.currentTime = percent * audio.duration;
    });
  }

  function updatePlayButton() {
    if (isPlaying) {
      elements.playIcon.style.display = "none";
      elements.pauseIcon.style.display = "block";
      if (elements.playBtn)
        elements.playBtn.setAttribute("aria-label", "Pause");
    } else {
      elements.playIcon.style.display = "block";
      elements.pauseIcon.style.display = "none";
      if (elements.playBtn) elements.playBtn.setAttribute("aria-label", "Play");
    }
    if (elements.player) {
      elements.player.classList.toggle(
        "letterbox-playing",
        letterboxEnabled && isPlaying,
      );
    }
    updateArtworkMotionState();
  }

  // Atmospheric effects — flowers and bokeh
  let flowerInterval = null;
  let bokehInterval = null;

  var FLOWERS = [
    "\u{1F339}",
    "\u{1F338}",
    "\u{1F33A}",
    "\u{1F337}",
    "\u{1F4AE}",
    "\u{1FAB7}",
    "\u{1F33C}",
    "\u{1FABB}",
  ];

  function spawnFlower() {
    if (prefersReducedMotion) return;
    var layer = document.getElementById("petal-layer");
    if (!layer) return;
    var el = document.createElement("div");
    var flower = FLOWERS[Math.floor(Math.random() * FLOWERS.length)];
    var size = 18 + Math.random() * 16; // 18-34px
    var startX = Math.random() * 94 + 3;
    var sway = -50 + Math.random() * 100;
    var drift = -30 + Math.random() * 60;
    var spin = 30 + Math.random() * 120;
    var duration = 10 + Math.random() * 8;

    el.className = "flower";
    el.textContent = flower;
    el.style.left = startX + "%";
    el.style.top = "-30px";
    el.style.setProperty("--flower-size", size + "px");
    el.style.setProperty("--fl-sway", sway + "px");
    el.style.setProperty("--fl-drift", drift + "px");
    el.style.setProperty("--fl-spin", spin + "deg");
    el.style.animationDuration = duration + "s";
    el.style.animationDelay = Math.random() * 0.8 + "s";

    layer.appendChild(el);
    setTimeout(
      function () {
        if (el.parentNode) el.remove();
      },
      (duration + 2) * 1000,
    );
  }

  function spawnBokeh() {
    if (prefersReducedMotion) return;
    var layer = document.getElementById("bokeh-layer");
    if (!layer) return;
    var orb = document.createElement("div");
    orb.className = "bokeh-orb";
    // Mix of small warm pinpoints and large soft glows
    var isLarge = Math.random() > 0.5;
    var size = isLarge ? 30 + Math.random() * 60 : 6 + Math.random() * 14;
    var x = 5 + Math.random() * 90;
    var y = 5 + Math.random() * 75;
    var duration = 5 + Math.random() * 7;
    var alpha = isLarge
      ? 0.06 + Math.random() * 0.08
      : 0.2 + Math.random() * 0.25;
    var colors = [
      [212, 165, 116], // warm gold
      [200, 155, 100], // amber
      [230, 190, 140], // light gold
      [180, 140, 90], // deep gold
    ];
    var c = colors[Math.floor(Math.random() * colors.length)];
    var rgba = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ")";

    orb.style.width = size + "px";
    orb.style.height = size + "px";
    orb.style.left = x + "%";
    orb.style.top = y + "%";
    orb.style.background =
      "radial-gradient(circle, " + rgba + ", transparent 65%)";
    orb.style.boxShadow = "0 0 " + size * 1.5 + "px " + rgba;
    orb.style.filter = isLarge ? "blur(8px)" : "blur(1px)";
    orb.style.animationDuration = duration + "s";

    layer.appendChild(orb);
    setTimeout(function () {
      if (orb.parentNode) orb.remove();
    }, duration * 1000);
  }

  function startAtmosphere() {
    if (letterboxEnabled || prefersReducedMotion) return;
    if (flowerInterval) return;
    function safeSpawnFlower() {
      try {
        spawnFlower();
      } catch (e) {
        console.warn("[Atmos] flower error:", e);
      }
    }
    function safeSpawnBokeh() {
      try {
        spawnBokeh();
      } catch (e) {
        console.warn("[Atmos] bokeh error:", e);
      }
    }
    for (var i = 0; i < 8; i++) setTimeout(safeSpawnFlower, i * 300);
    for (var j = 0; j < 12; j++) setTimeout(safeSpawnBokeh, j * 200);
    flowerInterval = setInterval(safeSpawnFlower, 800);
    bokehInterval = setInterval(safeSpawnBokeh, 1200);
  }

  function stopAtmosphere() {
    clearInterval(flowerInterval);
    clearInterval(bokehInterval);
    flowerInterval = null;
    bokehInterval = null;
  }

  function setMainPlaybackState(nextIsPlaying) {
    isPlaying = Boolean(nextIsPlaying);
    updatePlayButton();
  }

  function togglePlay() {
    const audio = elements.audioPlayer;
    if (!audio) return;

    if (!audio.paused && !audio.ended) {
      audio.pause();
      return;
    }

    audio.play().catch((e) => {
      console.error("Playback error:", e);
      setMainPlaybackState(false);
      stopAtmosphere();
    });
  }

  // Share actions
  function getShareUrl() {
    return window.location.origin + "/play/" + encodeURIComponent(shareId);
  }

  function getShareText() {
    var trackInfo = getTrackInfo();
    var recipientName = trackInfo
      ? (trackInfo.recipient_name || "").trim()
      : "";
    var senderName = trackInfo ? (trackInfo.sender_name || "").trim() : "";
    var occasion = trackInfo ? (trackInfo.occasion || "").trim() : "";
    if (senderName && recipientName && occasion) {
      return (
        senderName +
        " made a " +
        occasion +
        " song for " +
        recipientName +
        ". Listen here."
      );
    }
    if (senderName && recipientName) {
      return (
        senderName + " made this song for " + recipientName + ". Listen here."
      );
    }
    if (recipientName && occasion) {
      return "A " + occasion + " song for " + recipientName + ". Listen here.";
    }
    if (recipientName) {
      return "A song for " + recipientName + ". Listen here.";
    }
    return "Someone made you a song. Listen here.";
  }

  function showToast(message, toastId) {
    var toast = document.getElementById(toastId || "toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(function () {
      toast.classList.remove("visible");
    }, 2500);
  }

  function shouldUseNativeMobileShare() {
    return (
      letterboxEnabled &&
      window.matchMedia("(max-width: 768px)").matches &&
      typeof navigator.share === "function"
    );
  }

  async function shareViaNativeSheet() {
    const trackInfo = getTrackInfo();
    const shareUrl = getShareUrl();
    const shareText = getShareText();
    await navigator.share({
      title: trackInfo ? getExperienceHeading(trackInfo) : "Porizo song",
      text: shareText,
      url: shareUrl,
    });
  }

  function setupShareButtons() {
    var shareUrl = getShareUrl();
    var shareText = getShareText();
    var copyBtn = document.getElementById("btn-copy-link");
    if (copyBtn) {
      copyBtn.classList.toggle(
        "letterbox-native-share",
        shouldUseNativeMobileShare(),
      );
      var label = copyBtn.querySelector("span");
      if (label)
        label.textContent = shouldUseNativeMobileShare()
          ? "Share"
          : "Copy Link";
      copyBtn.setAttribute(
        "aria-label",
        shouldUseNativeMobileShare() ? "Share song" : "Copy link",
      );
    }

    if (shareButtonsBound) {
      var existingWaBtn = document.getElementById("btn-share-whatsapp");
      if (existingWaBtn) {
        existingWaBtn.href =
          "https://wa.me/?text=" +
          encodeURIComponent(shareText + " " + shareUrl);
      }
      var existingTwBtn = document.getElementById("btn-share-twitter");
      if (existingTwBtn) {
        existingTwBtn.href =
          "https://twitter.com/intent/tweet?text=" +
          encodeURIComponent(shareText) +
          "&url=" +
          encodeURIComponent(shareUrl);
      }
      return;
    }
    shareButtonsBound = true;

    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (shouldUseNativeMobileShare()) {
          shareViaNativeSheet()
            .then(function () {
              showToast("Share sheet opened");
            })
            .catch(function (error) {
              if (!error || error.name !== "AbortError") {
                showToast("Could not open share sheet");
              }
            });
          return;
        }
        navigator.clipboard
          .writeText(shareUrl)
          .then(function () {
            showToast("Link copied!");
          })
          .catch(function () {
            showToast("Could not copy link");
          });
      });
    }

    var waBtn = document.getElementById("btn-share-whatsapp");
    if (waBtn) {
      waBtn.href =
        "https://wa.me/?text=" + encodeURIComponent(shareText + " " + shareUrl);
    }

    var twBtn = document.getElementById("btn-share-twitter");
    if (twBtn) {
      twBtn.href =
        "https://twitter.com/intent/tweet?text=" +
        encodeURIComponent(shareText) +
        "&url=" +
        encodeURIComponent(shareUrl);
    }

    var dlBtn = document.getElementById("btn-download-audiogram");
    if (dlBtn && shareData && shareData.dl_token) {
      dlBtn.addEventListener("click", function () {
        var dlUrl =
          getApiBaseUrl() +
          "/share/" +
          encodeURIComponent(shareId) +
          "/download.mp4?dl_token=" +
          encodeURIComponent(shareData.dl_token);
        var a = document.createElement("a");
        a.href = dlUrl;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast("Downloading audiogram...");
      });
    } else if (dlBtn) {
      dlBtn.style.display = "none";
    }
  }

  // Post-play CTA
  function showPostPlayCta() {
    var cta = document.getElementById("post-play-cta");
    if (!cta) return;
    cta.classList.add("visible");
    cta.setAttribute("aria-hidden", "false");
    if (!postPlayCtaViewed) {
      postPlayCtaViewed = true;
      safeRecordReceiverEvent("receiver_save_cta_viewed", {
        placement: "post_play",
      }).then(function (data) {
        if (data && data.receiver_save_url) {
          var ctaLink = document.getElementById("cta-download-link");
          if (ctaLink) ctaLink.href = data.receiver_save_url;
        }
      });
    }
  }

  function hidePostPlayCta() {
    var cta = document.getElementById("post-play-cta");
    if (!cta) return;
    cta.classList.remove("visible");
    cta.setAttribute("aria-hidden", "true");
  }

  function setupPostPlayCta() {
    hidePostPlayCta();
    var ctaLink = document.getElementById("cta-download-link");
    if (ctaLink) {
      ctaLink.href =
        receiverSaveUrl || buildReceiverSaveFallbackUrl("post_play");
      if (!postPlayCtaBound) {
        postPlayCtaBound = true;
        ctaLink.addEventListener("click", function (event) {
          handleReceiverSaveClick(event, "post_play");
        });
      }
    }
    var dismissBtn = document.getElementById("cta-dismiss");
    if (dismissBtn && !postPlayDismissBound) {
      postPlayDismissBound = true;
      dismissBtn.addEventListener("click", function () {
        hidePostPlayCta();
      });
    }
  }

  // ============ Teaser Flow ============

  async function loadTeaser() {
    cacheTeaserEls();
    var trackInfo = getTrackInfo();

    if (trackInfo) {
      if (teaserEls.title)
        teaserEls.title.textContent = getExperienceHeading(trackInfo);
      if (trackInfo.cover_image_url && teaserEls.artwork) {
        var img = document.createElement("img");
        img.src = trackInfo.cover_image_url;
        img.alt = "Cover art";
        img.className = "teaser-artwork-img";
        img.onerror = function () {
          img.style.display = "none";
        };
        teaserEls.artwork.textContent = "";
        teaserEls.artwork.appendChild(img);
      }
    }

    setupTeaserPlayer(shareData.teaser_url);
    setupTeaserUnlockCta();
    setupTeaserShareButton();
    showScreen("teaser");
  }

  var TEASER_MAX_SECONDS = 30; // Cap teaser playback — show unlock CTA after this

  function setupTeaserPlayer(url) {
    teaserAudio = document.getElementById("teaser-audio");
    if (!teaserAudio) return;
    teaserAudio.preload = "none";
    teaserAudio.src = url;

    if (teaserPlayerBound) return;
    teaserPlayerBound = true;

    var teaserDuration = TEASER_MAX_SECONDS; // Updated on loadedmetadata if shorter

    function updateTeaserPlayBtn() {
      if (teaserEls.playIcon)
        teaserEls.playIcon.style.display = teaserPlaying ? "none" : "block";
      if (teaserEls.pauseIcon)
        teaserEls.pauseIcon.style.display = teaserPlaying ? "block" : "none";
      if (teaserEls.playBtn)
        teaserEls.playBtn.setAttribute(
          "aria-label",
          teaserPlaying ? "Pause preview" : "Play preview",
        );
    }

    function endTeaser() {
      teaserAudio.pause();
      teaserPlaying = false;
      updateTeaserPlayBtn();
      if (teaserEls.progressFill) teaserEls.progressFill.style.width = "100%";
      teaserAudio.currentTime = 0;
      if (teaserEls.unlockCta) teaserEls.unlockCta.classList.add("visible");
    }

    teaserAudio.addEventListener("loadedmetadata", function () {
      // Use the shorter of actual duration or the cap
      teaserDuration = Math.min(teaserAudio.duration, TEASER_MAX_SECONDS);
      if (teaserEls.duration)
        teaserEls.duration.textContent = formatTime(teaserDuration);
    });

    teaserAudio.addEventListener("timeupdate", function () {
      // Stop at cap
      if (teaserAudio.currentTime >= teaserDuration) {
        endTeaser();
        return;
      }
      var pct = (teaserAudio.currentTime / teaserDuration) * 100;
      if (teaserEls.progressFill)
        teaserEls.progressFill.style.width = Math.min(pct, 100) + "%";
      if (teaserEls.currentTime)
        teaserEls.currentTime.textContent = formatTime(teaserAudio.currentTime);
    });

    teaserAudio.addEventListener("ended", function () {
      endTeaser();
    });

    teaserAudio.addEventListener("error", function () {
      showError("Unable to play the preview. Please try again.");
    });

    if (teaserEls.playBtn) {
      teaserEls.playBtn.addEventListener("click", function () {
        if (teaserEls.unlockCta)
          teaserEls.unlockCta.classList.remove("visible");

        if (teaserPlaying) {
          teaserAudio.pause();
          teaserPlaying = false;
          updateTeaserPlayBtn();
        } else {
          teaserAudio
            .play()
            .then(function () {
              teaserPlaying = true;
              updateTeaserPlayBtn();
            })
            .catch(function (e) {
              console.error("Teaser playback error:", e);
            });
        }
      });
    }

    // Progress bar seeking (capped to teaser duration)
    var progressBar = document.querySelector(".teaser-progress-bar");
    if (progressBar) {
      progressBar.addEventListener("click", function (e) {
        var rect = e.currentTarget.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        teaserAudio.currentTime = Math.min(
          pct * teaserDuration,
          teaserDuration - 0.1,
        );
      });
    }
  }

  function setupTeaserUnlockCta() {
    if (teaserUnlockCtaBound) return;
    teaserUnlockCtaBound = true;

    var unlockBtn = document.getElementById("teaser-unlock-btn");
    if (unlockBtn) {
      unlockBtn.addEventListener("click", function (event) {
        if (teaserAudio) {
          teaserAudio.pause();
          teaserPlaying = false;
        }
        handleReceiverSaveClick(
          {
            currentTarget: {
              href:
                receiverSaveUrl ||
                buildReceiverSaveFallbackUrl("teaser_unlock"),
            },
            preventDefault: function () {
              event.preventDefault();
            },
          },
          "teaser_unlock",
        );
      });
    }

    var replayBtn = document.getElementById("teaser-replay-btn");
    if (replayBtn) {
      replayBtn.addEventListener("click", function () {
        if (teaserEls.unlockCta)
          teaserEls.unlockCta.classList.remove("visible");
        if (teaserAudio) {
          teaserAudio.currentTime = 0;
          teaserAudio.play().catch(function () {});
          teaserPlaying = true;
          if (teaserEls.playIcon) teaserEls.playIcon.style.display = "none";
          if (teaserEls.pauseIcon) teaserEls.pauseIcon.style.display = "block";
          if (teaserEls.playBtn)
            teaserEls.playBtn.setAttribute("aria-label", "Pause preview");
        }
      });
    }

    var appLink = document.getElementById("teaser-app-link");
    if (appLink) {
      appLink.href =
        receiverSaveUrl || buildReceiverSaveFallbackUrl("teaser_unlock");
      appLink.addEventListener("click", function (event) {
        handleReceiverSaveClick(event, "teaser_unlock");
      });
    }
  }

  function setupTeaserShareButton() {
    if (teaserShareBound) return;
    teaserShareBound = true;

    var copyBtn = document.getElementById("teaser-copy-link");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var url =
          window.location.origin + "/play/" + encodeURIComponent(shareId);
        navigator.clipboard
          .writeText(url)
          .then(function () {
            showToast("Link copied!", "teaser-toast");
          })
          .catch(function () {});
      });
    }
  }

  function bindVisibilityEvents() {
    document.addEventListener("visibilitychange", function () {
      documentHidden = document.hidden;
      updateArtworkMotionState();
    });
  }

  // Event Bindings
  function bindEvents() {
    // Play button
    elements.playBtn.addEventListener("click", togglePlay);

    if (elements.iosDownloadLink) {
      elements.iosDownloadLink.addEventListener("click", function (event) {
        handleReceiverSaveClick(event, "app_bar");
      });
    }

    // Keyboard controls
    document.addEventListener("keydown", (e) => {
      if (screens.player.classList.contains("active")) {
        if (e.code === "Space") {
          e.preventDefault();
          togglePlay();
        } else if (e.code === "ArrowRight" && elements.audioPlayer) {
          elements.audioPlayer.currentTime = Math.min(
            elements.audioPlayer.duration || elements.audioPlayer.currentTime,
            elements.audioPlayer.currentTime + 5,
          );
        } else if (e.code === "ArrowLeft" && elements.audioPlayer) {
          elements.audioPlayer.currentTime = Math.max(
            0,
            elements.audioPlayer.currentTime - 5,
          );
        } else if (e.code === "Escape") {
          hidePostPlayCta();
        }
      }
    });
  }

  // Initialize
  function init() {
    bindEvents();
    bindVisibilityEvents();
    initializePlayer();
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
