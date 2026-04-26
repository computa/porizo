// Single source of truth for the MCP server identity.
//
// The static card at public/.well-known/mcp/server-card.json defines the
// schema, transport, and capabilities. The version field is intentionally
// derived from package.json at boot — keeping it static would mean two
// places to bump every release, with the MCP `initialize` handshake silently
// disagreeing with the discovery card whenever someone forgot one of them.
//
// This module owns the merge so both the GET /.well-known/mcp/server-card.json
// route (well-known.js) and the live MCP server (mcp.js) read identical
// bytes/values.

const { loadPublicFile } = require("./public-files");
const { version: PKG_VERSION } = require("../../package.json");

const DEFAULT_SERVER_INFO = { name: "porizo", version: PKG_VERSION };

function buildCard() {
  const raw = loadPublicFile(".well-known/mcp/server-card.json", { warnOnMissing: true });
  if (!raw) {
    return {
      serverInfo: DEFAULT_SERVER_INFO,
      cardJson: null,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const merged = {
      ...parsed,
      serverInfo: {
        ...DEFAULT_SERVER_INFO,
        ...(parsed.serverInfo || {}),
        // package.json wins — release pipeline owns the version of record.
        version: PKG_VERSION,
      },
    };
    return {
      serverInfo: merged.serverInfo,
      cardJson: JSON.stringify(merged, null, 2),
    };
  } catch (err) {
    console.warn(
      `[mcp-card] server-card.json is malformed; using package.json version (${err.message})`,
    );
    return {
      serverInfo: DEFAULT_SERVER_INFO,
      cardJson: null,
    };
  }
}

const CARD = buildCard();

module.exports = {
  serverInfo: CARD.serverInfo,
  cardJson: CARD.cardJson,
};
