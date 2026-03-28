/**
 * Porizo Web Player
 *
 * Stream-only player for shared songs.
 * Device binding is enforced server-side.
 */

(function() {
  'use strict';

  // Accessibility: detect reduced motion preference (reactive to mid-session changes)
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let prefersReducedMotion = motionQuery.matches;
  motionQuery.addEventListener('change', function(e) {
    prefersReducedMotion = e.matches;
    if (e.matches) {
      stopAtmosphere();
      var petalLayer = document.getElementById('petal-layer');
      var bokehLayer = document.getElementById('bokeh-layer');
      if (petalLayer) { while (petalLayer.firstChild) petalLayer.removeChild(petalLayer.firstChild); }
      if (bokehLayer) { while (bokehLayer.firstChild) bokehLayer.removeChild(bokehLayer.firstChild); }
    }
  });

  // State
  let shareId = null;
  let shareData = null;
  let streamUrl = null;
  let deviceId = null;
  let isPlaying = false;
  let appDownloadUrl = '';
  let webStreamToken = null;

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
    teaserEls.title = document.getElementById('teaser-title');
    teaserEls.artwork = document.getElementById('teaser-artwork');
    teaserEls.playBtn = document.getElementById('teaser-play-btn');
    teaserEls.playIcon = document.getElementById('teaser-play-icon');
    teaserEls.pauseIcon = document.getElementById('teaser-pause-icon');
    teaserEls.progressFill = document.getElementById('teaser-progress-fill');
    teaserEls.currentTime = document.getElementById('teaser-current-time');
    teaserEls.duration = document.getElementById('teaser-duration');
    teaserEls.unlockCta = document.getElementById('teaser-unlock-cta');
  }

  // DOM Elements
  const screens = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    expired: document.getElementById('expired'),
    pinEntry: document.getElementById('pin-entry'),
    teaser: document.getElementById('teaser'),
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
        if (!prefersReducedMotion) {
          p.style.animationDelay = (0.15 + lineIdx * 0.06) + 's';
        }
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
          // Check sessionStorage for a previously verified PIN token
          const cachedToken = sessionStorage.getItem(`porizo_wst_${shareId}`);
          if (cachedToken) {
            webStreamToken = cachedToken;
            await loadPlayer(false);
            return;
          }
          if (shareData.teaser_url) {
            await loadTeaser();
            return;
          }
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
      try { sessionStorage.setItem(`porizo_wst_${shareId}`, webStreamToken); } catch(e) { /* private browsing */ }
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
      setupShareButtons();
      setupPostPlayCta();
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
    // Start/stop atmospheric effects directly from audio events
    audio.addEventListener('play', () => { startAtmosphere(); });
    audio.addEventListener('pause', () => { stopAtmosphere(); });

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
      if (!audio.paused && !flowerInterval) startAtmosphere();
      if (audio.paused && flowerInterval) stopAtmosphere();
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
      showPostPlayCta();
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
      if (elements.playBtn) elements.playBtn.setAttribute('aria-label', 'Pause');
    } else {
      elements.playIcon.style.display = 'block';
      elements.pauseIcon.style.display = 'none';
      if (elements.playBtn) elements.playBtn.setAttribute('aria-label', 'Play');
    }
  }

  // Atmospheric effects — flowers and bokeh
  let flowerInterval = null;
  let bokehInterval = null;

  var FLOWERS = ['\u{1F339}', '\u{1F338}', '\u{1F33A}', '\u{1F337}', '\u{1F4AE}', '\u{1FAB7}', '\u{1F33C}', '\u{1FABB}'];

  function spawnFlower() {
    if (prefersReducedMotion) return;
    var layer = document.getElementById('petal-layer');
    if (!layer) return;
    var el = document.createElement('div');
    var flower = FLOWERS[Math.floor(Math.random() * FLOWERS.length)];
    var size = 18 + Math.random() * 16; // 18-34px
    var startX = Math.random() * 94 + 3;
    var sway = -50 + Math.random() * 100;
    var drift = -30 + Math.random() * 60;
    var spin = 30 + Math.random() * 120;
    var duration = 10 + Math.random() * 8;

    el.className = 'flower';
    el.textContent = flower;
    el.style.left = startX + '%';
    el.style.top = '-30px';
    el.style.setProperty('--flower-size', size + 'px');
    el.style.setProperty('--fl-sway', sway + 'px');
    el.style.setProperty('--fl-drift', drift + 'px');
    el.style.setProperty('--fl-spin', spin + 'deg');
    el.style.animationDuration = duration + 's';
    el.style.animationDelay = (Math.random() * 0.8) + 's';

    layer.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, (duration + 2) * 1000);
  }

  function spawnBokeh() {
    if (prefersReducedMotion) return;
    var layer = document.getElementById('bokeh-layer');
    if (!layer) return;
    var orb = document.createElement('div');
    orb.className = 'bokeh-orb';
    // Mix of small warm pinpoints and large soft glows
    var isLarge = Math.random() > 0.5;
    var size = isLarge ? (30 + Math.random() * 60) : (6 + Math.random() * 14);
    var x = 5 + Math.random() * 90;
    var y = 5 + Math.random() * 75;
    var duration = 5 + Math.random() * 7;
    var alpha = isLarge ? (0.06 + Math.random() * 0.08) : (0.2 + Math.random() * 0.25);
    var colors = [
      [212, 165, 116],  // warm gold
      [200, 155, 100],  // amber
      [230, 190, 140],  // light gold
      [180, 140, 90],   // deep gold
    ];
    var c = colors[Math.floor(Math.random() * colors.length)];
    var rgba = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';

    orb.style.width = size + 'px';
    orb.style.height = size + 'px';
    orb.style.left = x + '%';
    orb.style.top = y + '%';
    orb.style.background = 'radial-gradient(circle, ' + rgba + ', transparent 65%)';
    orb.style.boxShadow = '0 0 ' + (size * 1.5) + 'px ' + rgba;
    orb.style.filter = isLarge ? 'blur(8px)' : 'blur(1px)';
    orb.style.animationDuration = duration + 's';

    layer.appendChild(orb);
    setTimeout(function() { if (orb.parentNode) orb.remove(); }, duration * 1000);
  }

  function startAtmosphere() {
    if (flowerInterval) return;
    function safeSpawnFlower() { try { spawnFlower(); } catch(e) { console.warn('[Atmos] flower error:', e); } }
    function safeSpawnBokeh() { try { spawnBokeh(); } catch(e) { console.warn('[Atmos] bokeh error:', e); } }
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

  // Share actions
  function getShareUrl() {
    return window.location.origin + '/play/' + encodeURIComponent(shareId);
  }

  function getShareText() {
    var trackInfo = shareData && (shareData.track || shareData.track_preview);
    var name = trackInfo ? trackInfo.recipient_name : '';
    return name
      ? 'Listen to this song made for ' + name + ' on Porizo'
      : 'Listen to this personalized song on Porizo';
  }

  function showToast(message, toastId) {
    var toast = document.getElementById(toastId || 'toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(function() { toast.classList.remove('visible'); }, 2500);
  }

  function setupShareButtons() {
    var shareUrl = getShareUrl();
    var shareText = getShareText();

    var copyBtn = document.getElementById('btn-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard.writeText(shareUrl).then(function() {
          showToast('Link copied!');
        }).catch(function() {
          showToast('Could not copy link');
        });
      });
    }

    var waBtn = document.getElementById('btn-share-whatsapp');
    if (waBtn) {
      waBtn.href = 'https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + shareUrl);
    }

    var twBtn = document.getElementById('btn-share-twitter');
    if (twBtn) {
      twBtn.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl);
    }

    var dlBtn = document.getElementById('btn-download-audiogram');
    if (dlBtn && shareData && shareData.dl_token) {
      dlBtn.addEventListener('click', function() {
        var dlUrl = getApiBaseUrl() + '/share/' + encodeURIComponent(shareId) + '/download.mp4?dl_token=' + encodeURIComponent(shareData.dl_token);
        var a = document.createElement('a');
        a.href = dlUrl;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('Downloading audiogram...');
      });
    } else if (dlBtn) {
      dlBtn.style.display = 'none';
    }
  }

  // Post-play CTA
  function showPostPlayCta() {
    var cta = document.getElementById('post-play-cta');
    if (cta) cta.classList.add('visible');
  }

  function hidePostPlayCta() {
    var cta = document.getElementById('post-play-cta');
    if (cta) cta.classList.remove('visible');
  }

  function setupPostPlayCta() {
    var ctaLink = document.getElementById('cta-download-link');
    if (ctaLink) {
      ctaLink.href = '/download?utm_source=webplayer&utm_medium=share&utm_campaign=post-play';
    }
    var dismissBtn = document.getElementById('cta-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function() {
        hidePostPlayCta();
      });
    }
  }

  // ============ Teaser Flow ============

  async function loadTeaser() {
    cacheTeaserEls();
    var trackInfo = shareData.track || shareData.track_preview;

    if (trackInfo) {
      if (teaserEls.title) teaserEls.title.textContent = trackInfo.recipient_name
        ? 'A song for ' + trackInfo.recipient_name
        : 'Someone made you a song!';
      if (trackInfo.cover_image_url && teaserEls.artwork) {
        var img = document.createElement('img');
        img.src = trackInfo.cover_image_url;
        img.alt = 'Cover art';
        img.className = 'teaser-artwork-img';
        img.onerror = function() { img.style.display = 'none'; };
        teaserEls.artwork.textContent = '';
        teaserEls.artwork.appendChild(img);
      }
    }

    setupTeaserPlayer(shareData.teaser_url);
    setupTeaserUnlockCta();
    setupTeaserShareButton();
    showScreen('teaser');
  }

  var TEASER_MAX_SECONDS = 30; // Cap teaser playback — show unlock CTA after this

  function setupTeaserPlayer(url) {
    teaserAudio = document.getElementById('teaser-audio');
    if (!teaserAudio) return;
    teaserAudio.preload = 'none';
    teaserAudio.src = url;

    var teaserDuration = TEASER_MAX_SECONDS; // Updated on loadedmetadata if shorter

    function updateTeaserPlayBtn() {
      if (teaserEls.playIcon) teaserEls.playIcon.style.display = teaserPlaying ? 'none' : 'block';
      if (teaserEls.pauseIcon) teaserEls.pauseIcon.style.display = teaserPlaying ? 'block' : 'none';
      if (teaserEls.playBtn) teaserEls.playBtn.setAttribute('aria-label', teaserPlaying ? 'Pause preview' : 'Play preview');
    }

    function endTeaser() {
      teaserAudio.pause();
      teaserPlaying = false;
      updateTeaserPlayBtn();
      if (teaserEls.progressFill) teaserEls.progressFill.style.width = '100%';
      teaserAudio.currentTime = 0;
      if (teaserEls.unlockCta) teaserEls.unlockCta.classList.add('visible');
    }

    teaserAudio.addEventListener('loadedmetadata', function() {
      // Use the shorter of actual duration or the cap
      teaserDuration = Math.min(teaserAudio.duration, TEASER_MAX_SECONDS);
      if (teaserEls.duration) teaserEls.duration.textContent = formatTime(teaserDuration);
    });

    teaserAudio.addEventListener('timeupdate', function() {
      // Stop at cap
      if (teaserAudio.currentTime >= teaserDuration) {
        endTeaser();
        return;
      }
      var pct = (teaserAudio.currentTime / teaserDuration) * 100;
      if (teaserEls.progressFill) teaserEls.progressFill.style.width = Math.min(pct, 100) + '%';
      if (teaserEls.currentTime) teaserEls.currentTime.textContent = formatTime(teaserAudio.currentTime);
    });

    teaserAudio.addEventListener('ended', function() {
      endTeaser();
    });

    teaserAudio.addEventListener('error', function() {
      showError('Unable to play the preview. Please try again.');
    });

    if (teaserEls.playBtn) {
      teaserEls.playBtn.addEventListener('click', function() {
        if (teaserEls.unlockCta) teaserEls.unlockCta.classList.remove('visible');

        if (teaserPlaying) {
          teaserAudio.pause();
          teaserPlaying = false;
          updateTeaserPlayBtn();
        } else {
          teaserAudio.play().then(function() {
            teaserPlaying = true;
            updateTeaserPlayBtn();
          }).catch(function(e) {
            console.error('Teaser playback error:', e);
          });
        }
      });
    }

    // Progress bar seeking (capped to teaser duration)
    var progressBar = document.querySelector('.teaser-progress-bar');
    if (progressBar) {
      progressBar.addEventListener('click', function(e) {
        var rect = e.currentTarget.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        teaserAudio.currentTime = Math.min(pct * teaserDuration, teaserDuration - 0.1);
      });
    }
  }

  function setupTeaserUnlockCta() {
    var unlockBtn = document.getElementById('teaser-unlock-btn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', function() {
        if (teaserAudio) { teaserAudio.pause(); teaserPlaying = false; }
        updateTrackInfo();
        showScreen('pinEntry');
        elements.pinInput.focus();
      });
    }

    var replayBtn = document.getElementById('teaser-replay-btn');
    if (replayBtn) {
      replayBtn.addEventListener('click', function() {
        if (teaserEls.unlockCta) teaserEls.unlockCta.classList.remove('visible');
        if (teaserAudio) {
          teaserAudio.currentTime = 0;
          teaserAudio.play().catch(function() {});
          teaserPlaying = true;
          if (teaserEls.playIcon) teaserEls.playIcon.style.display = 'none';
          if (teaserEls.pauseIcon) teaserEls.pauseIcon.style.display = 'block';
          if (teaserEls.playBtn) teaserEls.playBtn.setAttribute('aria-label', 'Pause preview');
        }
      });
    }

    var appLink = document.getElementById('teaser-app-link');
    if (appLink) {
      appLink.href = appDownloadUrl || '/download?utm_source=webplayer&utm_medium=teaser&utm_campaign=social';
    }
  }

  function setupTeaserShareButton() {
    var copyBtn = document.getElementById('teaser-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var url = window.location.origin + '/play/' + encodeURIComponent(shareId);
        navigator.clipboard.writeText(url).then(function() {
          showToast('Link copied!', 'teaser-toast');
        }).catch(function() {});
      });
    }
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
