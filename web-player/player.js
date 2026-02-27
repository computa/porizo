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
    });

    audio.addEventListener('timeupdate', () => {
      const progress = (audio.currentTime / audio.duration) * 100;
      elements.progressFill.style.width = `${progress}%`;
      elements.currentTime.textContent = formatTime(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      updatePlayButton();
      elements.progressFill.style.width = '0%';
      audio.currentTime = 0;
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

  function togglePlay() {
    const audio = elements.audioPlayer;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(e => {
        console.error('Playback error:', e);
      });
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
