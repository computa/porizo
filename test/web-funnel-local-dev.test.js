const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8"));
}

test("local dev builds the web funnel in preview mode without weakening production builds", () => {
  const rootPackage = readJson("package.json");
  const funnelPackage = readJson("web-funnel/package.json");

  assert.equal(rootPackage.scripts["web-funnel:build"], "npm --prefix web-funnel run build");
  assert.equal(
    rootPackage.scripts["web-funnel:build:preview"],
    "npm --prefix web-funnel run build:preview",
  );
  assert.equal(rootPackage.scripts.predev, "npm run web-funnel:build:preview");
  assert.equal(
    funnelPackage.scripts["build:preview"],
    "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json && vite build --mode preview && node scripts/check-bundle.mjs",
  );
});
