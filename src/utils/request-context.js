"use strict";

/**
 * True when a request originates from the Porizo native app rather than a
 * browser. Used to gate share audio so browsers are pushed into the app while
 * in-app requests keep working. Presence-based and browser-spoofable by design:
 * it is a routing signal, NOT a security boundary. The security boundary is that
 * the gated routes are preview-only at the source — they can only ever yield the
 * short preview, never the full master.
 */
function isAppContext(request) {
  const headers = (request && request.headers) || {};
  const ua = headers["user-agent"] || "";
  // App Clips are acquisition surfaces, not claimed-device playback clients.
  // They must remain behind the install-and-claim wall even though they send
  // ephemeral device metadata for receiver-session attribution.
  if (ua.startsWith("PorizoAppClip/")) return false;
  if (headers["x-device-token"]) return true;
  if (headers["x-device-id"] && headers["x-platform"]) return true;
  return ua.startsWith("PorizoApp/");
}

module.exports = { isAppContext };
