/**
 * Shared lazy-loader for the sharp image library.
 *
 * Returns the sharp module if installed, or null with a warning.
 * @param {string} [label="SharpLoader"] - Label for the console warning
 */
function requireSharp(label = "SharpLoader") {
  try {
    return require("sharp");
  } catch {
    console.warn(`[${label}] sharp not installed, skipping image generation`);
    return null;
  }
}

module.exports = { requireSharp };
