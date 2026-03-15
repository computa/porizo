/**
 * Porizo Web Player
 *
 * Stream-only player for shared songs.
 * Device binding is enforced server-side.
 */

(function() {
  'use strict';

  // State
  let shareId = null;
  let shareData = null;
  let streamUrl = null;
  let deviceId = null;
  let isPlaying = false;
  let appDownloadUrl = '';
  let webStreamToken = null;

  // DOM Elements
  const screens = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    expired: document.getElementById('expired'),
    pinEntry: document.getElementById('pin-entry'),
    player: document.getElementById('player'),
  };

  const elements = {
    errorMessage: document.getElementById('error-message'),
    errorAction: document.getElementById('error-action'),
    pinInput: document.getElementById('pin-input'),
    pinError: document.getElementById('pin-error'),
    pinSubmit: document.getElementById('pin-submit'),
    trackTitle: document.getElementById('track-title'),
    trackRecipient: document.getElementById('track-recipient'),
    audioPlayer: document.getElementById('audio-player'),
    playBtn: document.getElementById('play-btn'),
    playIcon: document.querySelector('.play-icon'),
    pauseIcon: document.querySelector('.pause-icon'),
    progressFill: document.getElementById('progress-fill'),
    currentTime: document.getElementById('current-time'),
    duration: document.getElementById('duration'),
    iosDownloadLink: document.getElementById('ios-download-link'),
    androidDownloadLink: document.getElementById('android-download-link'),
  };

  // Utilities
  function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    if (screens[screenName]) {
      screens[screenName].classList.add('active');
    }
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function getDeviceId() {
    // Get or create a persistent device ID
    let id = localStorage.getItem('porizo_device_id');
    if (!id) {
      id = 'web_' + crypto.randomUUID();
      localStorage.setItem('porizo_device_id', id);
    }
    return id;
  }

  function getApiBaseUrl() {
    // In production, use same origin. For development, can be overridden.
    return window.PORIZO_API_URL || '';
  }

  function getShareDeepLink() {
    if (!shareId) return null;
    return `porizo:///play/${encodeURIComponent(shareId)}`;
  }

  function buildDownloadUrl({ deepLink = null, platform = null } = {}) {
    const params = new URLSearchParams();
    if (platform) {
      params.set('platform', platform);
    }
    if (platform !== 'android') {
      params.set('channel', 'appstore');
    }
    if (deepLink) {
      params.set('deep_link', deepLink);
    }
    const query = params.toString();
    return query ? `/download?${query}` : '/download';
  }

  function updateDownloadLinks() {
    const deepLink = getShareDeepLink();
    const iosUrl = appDownloadUrl || buildDownloadUrl({ deepLink });
    const androidUrl = buildDownloadUrl({ platform: 'android' });
    if (elements.iosDownloadLink) {
      elements.iosDownloadLink.setAttribute('href', iosUrl);
    }
    if (elements.androidDownloadLink) {
      elements.androidDownloadLink.setAttribute('href', androidUrl);
    }
  }

  function updateTrackInfo() {
    const trackInfo = shareData.track || shareData.track_preview;
    if (trackInfo) {
      elements.trackTitle.textContent = trackInfo.title || 'Your Song';
      elements.trackRecipient.textContent = `Made for ${trackInfo.recipient_name || 'You'}`;
    }
  }

  // Lyrics — line-level timing and highlighting
  let lineTimings = [];     // flat array: { text, startTime, endTime, sectionName }
  let activeLineIndex = -1;
  let cachedLineEls = [];
  let cachedLabelEls = [];

  function formatSectionLabel(name) {
    return name.replace(/([a-z])(\d+)/g, '$1 $2').toUpperCase();
  }

  /**
   * Estimate per-line timing when server doesn't provide timestamps.
   * Returns the same enriched format as server alignment.
   */
  function estimateLineTiming(sections, totalDuration) {
    var SECONDS_PER_LINE = 3.2;
    var GAP_BETWEEN_SECTIONS = 4.5;
    var totalLines = 0;
    sections.forEach(function(s) {
      var lines = Array.isArray(s.lines) ? s.lines : [];
      totalLines += lines.length;
    });
    if (totalLines === 0) return [];

    var rawDur = totalLines * SECONDS_PER_LINE + (sections.length - 1) * GAP_BETWEEN_SECTIONS;
    var scale = rawDur > totalDuration * 0.85 ? (totalDuration * 0.85) / rawDur : 1.0;
    var introTime = rawDur > totalDuration * 0.85 ? totalDuration * 0.05 : Math.min(totalDuration * 0.08, 15);

    var elapsed = introTime;
    var result = [];
    sections.forEach(function(section, si) {
      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function(line) {
        var text = typeof line === 'string' ? line : (line.text || '');
        var dur = SECONDS_PER_LINE * scale;
        result.push({ text: text, startTime: elapsed, endTime: elapsed + dur, sectionName: section.name });
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
    sections.forEach(function(section) {
      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function(line) {
        if (typeof line === 'object' && line.startTime !== undefined) {
          result.push({ text: line.text, startTime: line.startTime, endTime: line.endTime, sectionName: section.name });
        } else {
          // Section has timing but lines are plain strings — distribute evenly
          var text = typeof line === 'string' ? line : (line.text || '');
          result.push({ text: text, startTime: null, endTime: null, sectionName: section.name });
        }
      });
    });

    // Fill nulls from section-level timing
    if (result.some(function(l) { return l.startTime == null; }) && sections.some(function(s) { return s.startTime != null; })) {
      sections.forEach(function(section) {
        if (section.startTime == null) return;
        var sLines = result.filter(function(l) { return l.sectionName === section.name && l.startTime == null; });
        if (sLines.length === 0) return;
        var dur = (section.endTime - section.startTime) / sLines.length;
        sLines.forEach(function(l, i) {
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
    const container = document.getElementById('lyrics-container');
    const scroll = document.getElementById('lyrics-scroll');
    if (!container || !scroll || !sections || sections.length === 0) return;

    scroll.textContent = '';
    let lastSectionName = null;
    let lineIdx = 0;

    sections.forEach(function(section) {
      // Section label
      var sectionName = section.name || 'section';
      if (sectionName !== lastSectionName) {
        var label = document.createElement('p');
        label.className = 'lyrics-section-label';
        label.textContent = formatSectionLabel(sectionName);
        label.dataset.sectionName = sectionName;
        scroll.appendChild(label);
        lastSectionName = sectionName;
      }

      var lines = Array.isArray(section.lines) ? section.lines : [];
      lines.forEach(function(line) {
        var text = typeof line === 'string' ? line : (line.text || '');
        var p = document.createElement('p');
        p.className = 'lyric-line';
        p.textContent = text;
        p.dataset.lineIndex = lineIdx;
        // Stagger entrance animation — each line reveals slightly after the previous
        p.style.animationDelay = (0.15 + lineIdx * 0.06) + 's';
        scroll.appendChild(p);
        lineIdx++;
      });
    });

    cachedLineEls = Array.from(scroll.querySelectorAll('.lyric-line'));
    cachedLabelEls = Array.from(scroll.querySelectorAll('.lyrics-section-label'));
    container.style.display = '';
  }

  /**
   * Update active line highlight with proximity glow and smooth center-scroll.
   */
  function updateActiveLine(currentTime) {
    if (lineTimings.length === 0 || cachedLineEls.length === 0) return;

    var newIndex = -1;
    for (var i = 0; i < lineTimings.length; i++) {
      if (currentTime >= lineTimings[i].startTime && currentTime < lineTimings[i].endTime) {
        newIndex = i;
        break;
      }
    }

    if (newIndex === activeLineIndex) return;
    activeLineIndex = newIndex;

    // Update line classes with proximity awareness
    var activeSectionName = newIndex >= 0 ? lineTimings[newIndex].sectionName : null;
    var NEAR_RANGE = 2; // Lines within ±2 of active get .near

    cachedLineEls.forEach(function(el, i) {
      var isActive = i === newIndex;
      var isSung = newIndex >= 0 && i < newIndex;
      var isNear = newIndex >= 0 && !isActive && Math.abs(i - newIndex) <= NEAR_RANGE;

      el.classList.toggle('active', isActive);
      el.classList.toggle('sung', isSung);
      el.classList.toggle('near', isNear);
    });

    // Update section label highlighting
    cachedLabelEls.forEach(function(el) {
      el.classList.toggle('active-section', el.dataset.sectionName === activeSectionName);
    });

    // Smooth scroll active line to center
    if (newIndex >= 0 && cachedLineEls[newIndex]) {
      var scroll = document.getElementById('lyrics-scroll');
      var target = cachedLineEls[newIndex];
      var scrollTop = target.offsetTop - scroll.offsetHeight / 2 + target.offsetHeight / 2;
      scroll.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
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
    const headers = includeHeaders ? {
      'X-Device-Id': deviceId,
      'X-Platform': 'web',
    } : {};

    if (webStreamToken) {
      headers['X-Web-Stream-Token'] = webStreamToken;
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

  // Screen Handlers
  async function initializePlayer() {
    try {
      // Get share ID from URL
      const pathParts = window.location.pathname.split('/');
      shareId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

      if (!shareId || shareId === 'web-player') {
        showError('Invalid share link');
        return;
      }

      updateDownloadLinks();

      // Get device ID
      deviceId = getDeviceId();

      // Fetch share info
      shareData = await fetchShareInfo(shareId);
      appDownloadUrl = shareData.app_download_url || buildDownloadUrl({ deepLink: getShareDeepLink() });
      updateDownloadLinks();

      if (shareData.status === 'expired') {
        showScreen('expired');
        return;
      }

      // If already claimed by this device, stream with device headers
      if (shareData.status === 'claimed' && shareData.can_access) {
        await loadPlayer(true);
        return;
      }

      // For unclaimed shares
      if (shareData.status === 'unbound') {
        if (shareData.requires_pin) {
          updateTrackInfo();
          showScreen('pinEntry');
          elements.pinInput.focus();
          return;
        }
        await loadPlayer(false);
        return;
      }

      // Claimed by another device - app required
      showError(
        'This link has already been claimed on another device. Ask the sender for a new link.',
        {
          label: 'Get the app',
          href: appDownloadUrl
        }
      );

    } catch (error) {
      console.error('Init error:', error);
      if (error.message === 'SHARE_NOT_FOUND') {
        showError('This share link was not found or has been revoked.');
      } else if (error.message === 'SHARE_EXPIRED') {
        showScreen('expired');
      } else {
        showError(error.message);
      }
    }
  }

  function showError(message, action) {
    if (elements.errorAction) {
      const label = action?.label || 'Go Home';
      const href = action?.href || '/';
      elements.errorAction.textContent = label;
      elements.errorAction.setAttribute('href', href);
    }
    elements.errorMessage.textContent = message;
    showScreen('error');
  }

  async function handlePinSubmit() {
    const pin = elements.pinInput.value.trim();
    if (pin.length !== 6) return;

    elements.pinSubmit.disabled = true;
    elements.pinSubmit.textContent = 'Verifying...';
    elements.pinError.textContent = '';

    try {
      const response = await fetch(`${getApiBaseUrl()}/share/${shareId}/web-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        elements.pinSubmit.textContent = 'Unlock';
        if (data.error === 'INVALID_PIN') {
          elements.pinError.textContent = 'Incorrect PIN. Please try again.';
          elements.pinSubmit.disabled = false;
        } else if (data.error === 'TOO_MANY_ATTEMPTS') {
          elements.pinError.textContent = 'Too many attempts. Please try later.';
          elements.pinSubmit.disabled = true;
        } else {
          elements.pinError.textContent = data.message || 'Verification failed. Please try again.';
          elements.pinSubmit.disabled = false;
        }
        return;
      }

      // Success — store token and load player
      webStreamToken = data.web_stream_token;
      await loadPlayer(false);

    } catch (error) {
      console.error('PIN verify error:', error);
      elements.pinSubmit.textContent = 'Unlock';
      elements.pinSubmit.disabled = false;
      elements.pinError.textContent = 'Verification failed. Please try again.';
    }
  }

  async function loadPlayer(claimed = false) {
    showScreen('loading');

    try {
      // Get stream URL (include device headers only for claimed shares)
      const streamData = await getStreamUrl(shareId, claimed);
      streamUrl = streamData.stream_url;
      const streamFormat = streamData.format || 'audio';

      // Append web stream token as query param for <audio> element auth
      if (webStreamToken && streamUrl && streamUrl.includes('/audio')) {
        const sep = streamUrl.includes('?') ? '&' : '?';
        streamUrl = `${streamUrl}${sep}wst=${encodeURIComponent(webStreamToken)}`;
      }

      updateTrackInfo();

      // Render lyrics if available
      if (shareData.lyrics && shareData.lyrics.length > 0) {
        renderLyrics(shareData.lyrics);
      }

      // Set up audio player with format hint
      setupAudioPlayer(streamUrl, streamFormat);
      showScreen('player');

    } catch (error) {
      console.error('Load player error:', error);
      if (error.message === 'TOKEN_ALREADY_BOUND') {
        showError(
          'This link is already claimed on another device.',
          {
            label: 'Get the app',
            href: appDownloadUrl
          }
        );
      } else if (error.message === 'WEB_STREAM_NOT_ALLOWED') {
        showError(
          'Web playback is disabled for this song. Open the Porizo app to claim and listen.',
          {
            label: 'Get the app',
            href: appDownloadUrl
          }
        );
      } else {
        showError('Unable to load the song. Please try again.');
      }
    }
  }

  function setupAudioPlayer(url, format = 'audio') {
    const audio = elements.audioPlayer;

    // Use format hint from server, fallback to extension detection
    const isHls = format === 'hls' || url.endsWith('.m3u8');

    if (isHls) {
      // For HLS streaming, we need HLS.js for non-Safari browsers
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari has native HLS support
        audio.src = url;
      } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
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
    audio.addEventListener('loadedmetadata', () => {
      elements.duration.textContent = formatTime(audio.duration);
      // Build line-level timing: server timestamps or client estimation
      if (shareData.lyrics && shareData.lyrics.length > 0) {
        var hasServerTiming = shareData.lyrics[0].startTime !== undefined ||
          (shareData.lyrics[0].lines && shareData.lyrics[0].lines[0] &&
           typeof shareData.lyrics[0].lines[0] === 'object' && shareData.lyrics[0].lines[0].startTime !== undefined);

        if (hasServerTiming) {
          lineTimings = flattenServerTiming(shareData.lyrics);
        } else {
          lineTimings = estimateLineTiming(shareData.lyrics, audio.duration);
        }
      }
    });

    audio.addEventListener('timeupdate', () => {
      const progress = (audio.currentTime / audio.duration) * 100;
      elements.progressFill.style.width = `${progress}%`;
      elements.currentTime.textContent = formatTime(audio.currentTime);
      updateActiveLine(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      updatePlayButton();
      stopAtmosphere();
      elements.progressFill.style.width = '0%';
      audio.currentTime = 0;
      activeLineIndex = -1;
      cachedLineEls.forEach(el => { el.classList.remove('active'); el.classList.remove('sung'); });
      cachedLabelEls.forEach(el => el.classList.remove('active-section'));
      const lyricsScroll = document.getElementById('lyrics-scroll');
      if (lyricsScroll) lyricsScroll.scrollTop = 0;
    });

    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      showError('Unable to play this audio. Please try again.');
    });

    // Progress bar click to seek
    document.querySelector('.progress-bar').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      audio.currentTime = percent * audio.duration;
    });
  }

  function updatePlayButton() {
    if (isPlaying) {
      elements.playIcon.style.display = 'none';
      elements.pauseIcon.style.display = 'block';
    } else {
      elements.playIcon.style.display = 'block';
      elements.pauseIcon.style.display = 'none';
    }
  }

  // Atmospheric effects — petals and bokeh
  let petalInterval = null;
  let bokehInterval = null;

  var PETAL_COLORS = ['rose', 'blush', 'cream', 'mauve'];

  function spawnPetal() {
    var layer = document.getElementById('petal-layer');
    if (!layer) return;
    var petal = document.createElement('div');
    var color = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
    var size = 10 + Math.random() * 10;
    var startX = Math.random() * 100;
    var sway = -60 + Math.random() * 120;
    var endX = sway + (-30 + Math.random() * 60);
    var spin = 80 + Math.random() * 240;
    var endSpin = spin + 60 + Math.random() * 180;
    var duration = 8 + Math.random() * 7;

    petal.className = 'petal ' + color;
    petal.style.left = startX + '%';
    petal.style.top = '-20px';
    petal.style.width = size + 'px';
    petal.style.height = (size * 0.85) + 'px';
    petal.style.setProperty('--petal-sway', sway + 'px');
    petal.style.setProperty('--petal-end-x', endX + 'px');
    petal.style.setProperty('--petal-spin', spin + 'deg');
    petal.style.setProperty('--petal-end-spin', endSpin + 'deg');
    petal.style.animationDuration = duration + 's';
    petal.style.animationDelay = (Math.random() * 0.5) + 's';

    layer.appendChild(petal);
    setTimeout(function() { if (petal.parentNode) petal.remove(); }, (duration + 1) * 1000);
  }

  function spawnBokeh() {
    var layer = document.getElementById('bokeh-layer');
    if (!layer) return;
    var orb = document.createElement('div');
    orb.className = 'bokeh-orb';
    var size = 4 + Math.random() * 12;
    var x = 5 + Math.random() * 90;
    var y = 10 + Math.random() * 70;
    var duration = 6 + Math.random() * 8;
    var hue = Math.random() > 0.5
      ? 'rgba(220, 140, 120, ' + (0.15 + Math.random() * 0.2) + ')'
      : 'rgba(180, 120, 160, ' + (0.12 + Math.random() * 0.15) + ')';

    orb.style.width = size + 'px';
    orb.style.height = size + 'px';
    orb.style.left = x + '%';
    orb.style.top = y + '%';
    orb.style.background = 'radial-gradient(circle, ' + hue + ', transparent 70%)';
    orb.style.boxShadow = '0 0 ' + (size * 2) + 'px ' + hue;
    orb.style.animationDuration = duration + 's';

    layer.appendChild(orb);
    setTimeout(function() { if (orb.parentNode) orb.remove(); }, duration * 1000);
  }

  function startAtmosphere() {
    if (petalInterval) return;
    // Spawn initial batch
    for (var i = 0; i < 5; i++) setTimeout(spawnPetal, i * 400);
    for (var j = 0; j < 8; j++) setTimeout(spawnBokeh, j * 300);
    // Ongoing spawning
    petalInterval = setInterval(spawnPetal, 1200);
    bokehInterval = setInterval(spawnBokeh, 2000);
  }

  function stopAtmosphere() {
    clearInterval(petalInterval);
    clearInterval(bokehInterval);
    petalInterval = null;
    bokehInterval = null;
  }

  function togglePlay() {
    const audio = elements.audioPlayer;
    if (isPlaying) {
      audio.pause();
      stopAtmosphere();
    } else {
      audio.play().catch(e => {
        console.error('Playback error:', e);
      });
      startAtmosphere();
    }
    isPlaying = !isPlaying;
    updatePlayButton();
  }

  // Event Bindings
  function bindEvents() {
    // PIN input
    elements.pinInput.addEventListener('input', (e) => {
      // Only allow digits
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      elements.pinSubmit.disabled = e.target.value.length !== 6;
      elements.pinError.textContent = '';
    });

    elements.pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && elements.pinInput.value.length === 6) {
        handlePinSubmit();
      }
    });

    elements.pinSubmit.addEventListener('click', handlePinSubmit);

    // Play button
    elements.playBtn.addEventListener('click', togglePlay);

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      if (screens.player.classList.contains('active')) {
        if (e.code === 'Space') {
          e.preventDefault();
          togglePlay();
        }
      }
    });
  }

  // Initialize
  function init() {
    bindEvents();
    initializePlayer();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
