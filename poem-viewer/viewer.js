/**
 * Porizo Poem Viewer
 *
 * Fetches shared poem data and renders it for the recipient.
 * Mirrors the web-player IIFE pattern.
 *
 * Security note: All user content is set via textContent (not innerHTML)
 * to prevent XSS. innerHTML="" is used only to clear containers.
 */
/* global document, window */
(function () {
  "use strict";

  // --- DOM refs ---
  var screens = {
    loading: document.getElementById("loading"),
    error: document.getElementById("error"),
    expired: document.getElementById("expired"),
    pinEntry: document.getElementById("pin-entry"),
    viewer: document.getElementById("viewer"),
  };

  var els = {
    errorMessage: document.getElementById("error-message"),
    errorAction: document.getElementById("error-action"),
    pinInput: document.getElementById("pin-input"),
    pinSubmit: document.getElementById("pin-submit"),
    pinError: document.getElementById("pin-error"),
    pinDownloadLink: document.getElementById("pin-download-link"),
    iosDownloadLink: document.getElementById("ios-download-link"),
    androidDownloadLink: document.getElementById("android-download-link"),
    poemTitle: document.getElementById("poem-title"),
    poemRecipient: document.getElementById("poem-recipient"),
    poemOccasion: document.getElementById("poem-occasion"),
    poemBody: document.getElementById("poem-body"),
    fromText: document.getElementById("from-text"),
  };

  // --- State ---
  var shareId = null;
  var appDownloadUrl = "";

  // --- Helpers ---
  function showScreen(name) {
    Object.values(screens).forEach(function (s) {
      s.classList.remove("active");
    });
    if (screens[name]) screens[name].classList.add("active");
  }

  function showError(msg, action) {
    if (els.errorAction) {
      var label = action && action.label ? action.label : "Get the app";
      var href = action && action.href ? action.href : appDownloadUrl;
      els.errorAction.textContent = label;
      els.errorAction.setAttribute("href", href);
    }
    els.errorMessage.textContent = msg || "Unable to load this poem.";
    showScreen("error");
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function extractShareId() {
    // URL: /poem/:shareId
    var parts = window.location.pathname.split("/");
    var idx = parts.indexOf("poem");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  }

  function getShareDeepLink() {
    if (!shareId) return null;
    return "porizo:///poem/" + encodeURIComponent(shareId);
  }

  function buildDownloadUrl(options) {
    var opts = options || {};
    var params = new URLSearchParams();
    if (opts.platform) {
      params.set("platform", opts.platform);
    }
    if (opts.platform !== "android") {
      params.set("channel", "testflight");
    }
    if (opts.deepLink) {
      params.set("deep_link", opts.deepLink);
    }
    var query = params.toString();
    return query ? "/download?" + query : "/download";
  }

  function updateDownloadLinks() {
    var deepLink = getShareDeepLink();
    var iosUrl = appDownloadUrl || buildDownloadUrl({ deepLink: deepLink });
    var androidUrl = buildDownloadUrl({ platform: "android" });
    if (els.pinDownloadLink) {
      els.pinDownloadLink.setAttribute("href", iosUrl);
    }
    if (els.iosDownloadLink) {
      els.iosDownloadLink.setAttribute("href", iosUrl);
    }
    if (els.androidDownloadLink) {
      els.androidDownloadLink.setAttribute("href", androidUrl);
    }
  }

  // --- API ---
  function fetchShareInfo() {
    return fetch("/poem-share/" + encodeURIComponent(shareId)).then(function (r) {
      if (r.status === 410) return { expired: true };
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function claimWithPin(pin) {
    return fetch("/poem-share/" + encodeURIComponent(shareId) + "/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pin }),
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (data) {
          throw new Error(data.code || "CLAIM_FAILED");
        });
      }
      return r.json();
    });
  }

  // --- Rendering ---
  function renderVerses(verses, container) {
    clearChildren(container);
    verses.forEach(function (line) {
      var p = document.createElement("p");
      p.className = "verse";
      p.textContent = line;
      container.appendChild(p);
    });
  }

  function renderPoem(poem, creatorName) {
    els.poemTitle.textContent = poem.title || "A Poem for You";

    if (poem.recipient_name) {
      els.poemRecipient.textContent = "For " + poem.recipient_name;
    } else {
      els.poemRecipient.textContent = "Written for You";
    }

    if (poem.occasion) {
      els.poemOccasion.textContent = poem.occasion.charAt(0).toUpperCase() + poem.occasion.slice(1);
    }

    els.fromText.textContent = creatorName ? "From " + creatorName : "With love";

    var verses = poem.verses || poem.preview_lines || [];
    renderVerses(verses, els.poemBody);

    showScreen("viewer");
  }

  function renderPreview(data) {
    var poem = data.poem || {};
    els.poemTitle.textContent = poem.title || "A Poem for You";

    if (poem.recipient_name) {
      els.poemRecipient.textContent = "For " + poem.recipient_name;
    } else {
      els.poemRecipient.textContent = "Written for You";
    }

    if (poem.occasion) {
      els.poemOccasion.textContent = poem.occasion.charAt(0).toUpperCase() + poem.occasion.slice(1);
    }

    els.fromText.textContent = poem.creator_name ? "From " + poem.creator_name : "With love";

    // Preview lines (before claim)
    var lines = poem.preview_lines || [];
    renderVerses(lines, els.poemBody);

    if (lines.length > 0) {
      var more = document.createElement("p");
      more.className = "verse verse-more";
      more.textContent = "\u2026"; // ellipsis
      els.poemBody.appendChild(more);
    }

    showScreen("viewer");
  }

  // --- PIN Flow ---
  function setupPinHandlers() {
    els.pinInput.addEventListener("input", function () {
      var val = els.pinInput.value.replace(/\D/g, "");
      els.pinInput.value = val;
      els.pinSubmit.disabled = val.length < 6;
      els.pinError.textContent = "";
    });

    els.pinSubmit.addEventListener("click", function () {
      var pin = els.pinInput.value.trim();
      if (pin.length < 6) return;

      els.pinSubmit.disabled = true;
      els.pinSubmit.textContent = "Verifying...";

      claimWithPin(pin)
        .then(function (data) {
          if (data.poem) {
            renderPoem(data.poem);
          } else {
            showError("Could not load poem after verification.");
          }
        })
        .catch(function (err) {
          els.pinSubmit.disabled = false;
          els.pinSubmit.textContent = "Unlock";
          if (err.message === "INVALID_PIN") {
            els.pinError.textContent = "Incorrect PIN. Please try again.";
          } else if (err.message === "TOO_MANY_ATTEMPTS") {
            els.pinError.textContent = "Too many attempts. Please try later.";
            els.pinSubmit.disabled = true;
          } else {
            els.pinError.textContent = "Verification failed. Please try again.";
          }
        });
    });

    // Enter key submits
    els.pinInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !els.pinSubmit.disabled) {
        els.pinSubmit.click();
      }
    });
  }

  // --- Init ---
  function init() {
    shareId = extractShareId();
    if (!shareId) {
      showError("Invalid poem link.");
      return;
    }

    updateDownloadLinks();

    setupPinHandlers();

    fetchShareInfo()
      .then(function (data) {
        appDownloadUrl = data.app_download_url || buildDownloadUrl({ deepLink: getShareDeepLink() });
        updateDownloadLinks();

        if (data.expired) {
          showScreen("expired");
          return;
        }

        if (data.requires_pin) {
          showScreen("pinEntry");
          els.pinInput.focus();
        } else if (data.can_access && data.poem) {
          renderPreview(data);
        } else {
          showError("This poem is not available.", {
            label: "Get the app",
            href: appDownloadUrl,
          });
        }
      })
      .catch(function (err) {
        console.error("[PoemViewer] Error:", err);
        showError("Could not load poem. Please check the link and try again.", {
          label: "Get the app",
          href: appDownloadUrl,
        });
      });
  }

  init();
})();
