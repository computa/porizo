const fs = require("fs");
const path = require("path");

// Anchor on the source file's location, not process.cwd(). The repo layout is
// stable; the cwd a process is launched from is not (systemd, dev-mode launches
// from sub-dirs, etc.). Without this anchor, every file would silently 404.
const PUBLIC_ROOT = path.resolve(__dirname, "..", "..", "public");

// `warnOnMissing` exists so a typo in the relative path surfaces at boot
// instead of becoming a silent 404 in production — load failures used to
// be invisible.
function loadPublicFile(relativePath, { encoding = "utf8", warnOnMissing = false } = {}) {
  // path.resolve(PUBLIC_ROOT, '/etc/passwd') returns '/etc/passwd' — the
  // startsWith guard below catches it, but only by coincidence of layout.
  // Reject absolute paths structurally so the guarantee doesn't depend on
  // PUBLIC_ROOT's location relative to anything else on disk.
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    console.warn(`[public-files] rejected non-relative path: ${relativePath}`);
    return null;
  }
  const filePath = path.resolve(PUBLIC_ROOT, relativePath);
  // Path-traversal guard for "../" segments inside an otherwise-relative path.
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(PUBLIC_ROOT + path.sep)) {
    console.warn(`[public-files] rejected path-escape attempt: ${relativePath}`);
    return null;
  }
  try {
    return fs.readFileSync(filePath, encoding);
  } catch (error) {
    if (warnOnMissing) {
      console.warn(`[public-files] missing: ${relativePath} (${error.code || error.message})`);
    }
    return null;
  }
}

module.exports = { loadPublicFile, PUBLIC_ROOT };
