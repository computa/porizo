"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const TEMPLATE_ROOTS = ["marketing/email", "marketing/email-templates"];
const TEXT_EXTENSIONS = new Set([".html", ".md", ".txt"]);

function listTemplateFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".state" || entry.name === "assets") return [];
      return listTemplateFiles(fullPath);
    }
    return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

test("user-facing email templates do not hard-code direct App Store CTAs", () => {
  const offenders = [];
  for (const root of TEMPLATE_ROOTS) {
    for (const file of listTemplateFiles(root)) {
      const body = fs.readFileSync(file, "utf8");
      if (/apps\.apple\.com\/(?:us\/app\/porizo-song-gift-maker|app\/porizo)/.test(body)) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("user-facing email download CTAs include an app-open intent", () => {
  const offenders = [];
  for (const root of TEMPLATE_ROOTS) {
    for (const file of listTemplateFiles(root)) {
      const body = fs.readFileSync(file, "utf8");
      if (/https:\/\/porizo\.co\/download\?(?!intent=)/.test(body)) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
