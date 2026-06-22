(function () {
  var audio = new Audio();
  var playBtn = document.getElementById("play-btn");
  var playIcon = document.getElementById("play-icon");
  var pauseIcon = document.getElementById("pause-icon");
  var progressFill = document.getElementById("progress-fill");
  var progressBar = document.getElementById("progress-bar");
  var currentTimeEl = document.getElementById("current-time");
  var durationEl = document.getElementById("duration");

  var shareId = document.body.dataset.shareId;
  if (!shareId) return;
  var mediaUrl = document.body.dataset.mediaUrl;

  audio.src = mediaUrl || "/share/" + shareId + "/share.mp4";
  audio.preload = "metadata";

  function formatTime(s) {
    if (!isFinite(s)) return "0:00";
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function setPlaying(playing) {
    playIcon.style.display = playing ? "none" : "block";
    pauseIcon.style.display = playing ? "block" : "none";
  }

  playBtn.addEventListener("click", function () {
    if (audio.paused) {
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", function () {
    setPlaying(true);
  });
  audio.addEventListener("pause", function () {
    setPlaying(false);
  });
  audio.addEventListener("ended", function () {
    setPlaying(false);
  });

  audio.addEventListener("loadedmetadata", function () {
    durationEl.textContent = formatTime(audio.duration);
    playBtn.disabled = false;
  });

  audio.addEventListener("error", function () {
    // Surface load failure instead of leaving the play button stuck disabled
    // with no feedback (e.g. expired/missing media or a network error).
    durationEl.textContent = "Unavailable";
    setPlaying(false);
    playBtn.disabled = true;
    playBtn.setAttribute("aria-label", "Audio unavailable");
  });

  audio.addEventListener("timeupdate", function () {
    if (!audio.duration) return;
    var pct = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = pct + "%";
    currentTimeEl.textContent = formatTime(audio.currentTime);
  });

  progressBar.addEventListener("click", function (e) {
    if (!audio.duration) return;
    var rect = progressBar.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });
})();
