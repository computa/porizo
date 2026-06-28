"use strict";

function createModerationSteps({ moderationCheck, parseJson }) {
  return {
    moderation({ track, trackVersion }) {
      if (trackVersion.moderation_status) {
        return { moderation_status: trackVersion.moderation_status };
      }
      const lyrics = parseJson(
        trackVersion.lyrics_json,
        null,
        "moderation_lyrics",
      );
      const moderation = moderationCheck({
        title: track.title,
        recipient_name: track.recipient_name,
        message: track.message,
        lyrics: lyrics ? JSON.stringify(lyrics) : null,
      });
      if (!moderation.allowed) {
        return {
          moderation_status: "blocked",
          moderation_reason: moderation.reason,
          status_override: "blocked",
        };
      }
      return { moderation_status: "passed", moderation_reason: null };
    },
  };
}

module.exports = { createModerationSteps };
