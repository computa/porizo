"use strict";
const nodePath = require("node:path");

const SHARE_TEASER_MAX_SECONDS = 15;

/**
 * Pick the local audio source for the social-unfurl share video.
 * Teaser-only: the preview is the ONLY allowed source — the full master is
 * never embedded in a publicly-served unfurl video.
 */
function resolveShareVideoAudio({
  versionDir,
  fs = require("node:fs"),
  path = nodePath,
}) {
  const preview = path.join(versionDir, "preview.m4a");
  if (fs.existsSync(preview)) {
    return {
      audioPath: preview,
      maxSeconds: SHARE_TEASER_MAX_SECONDS,
      sourceKind: "preview",
    };
  }
  return {
    audioPath: null,
    maxSeconds: SHARE_TEASER_MAX_SECONDS,
    sourceKind: "none",
  };
}

module.exports = { resolveShareVideoAudio, SHARE_TEASER_MAX_SECONDS };
