import assert from "node:assert/strict";
import test from "node:test";

import {
  isOwnedPath,
  parsePorcelain,
} from "./execution-preflight.mjs";
import { parseArguments } from "./run-with-watchdog.mjs";

test("scope ownership accepts exact and nested paths without prefix collisions", () => {
  const scopes = ["src/auth", "package.json"];
  assert.equal(isOwnedPath("src/auth", scopes), true);
  assert.equal(isOwnedPath("src/auth/session.js", scopes), true);
  assert.equal(isOwnedPath("./package.json", scopes), true);
  assert.equal(isOwnedPath("src/authentication.js", scopes), false);
  assert.equal(isOwnedPath("package.json.bak", scopes), false);
});

test("porcelain parser preserves status and both sides of a rename", () => {
  assert.deepEqual(
    parsePorcelain(" M src/auth.js\0?? docs/new.md\0R  new-name.md\0old-name.md\0"),
    [
      { status: " M", path: "src/auth.js", staged: false },
      { status: "??", path: "docs/new.md", staged: false },
      { status: "R ", path: "new-name.md", staged: true },
      { status: "->", path: "old-name.md", staged: true },
    ],
  );
});

test("watchdog arguments derive a hard limit from the estimate", () => {
  const parsed = parseArguments([
    "--estimate-minutes", "4",
    "--silent-seconds", "30",
    "--", "node", "script.js",
  ]);
  assert.equal(parsed.estimateMinutes, 4);
  assert.equal(parsed.silentSeconds, 30);
  assert.equal(parsed.hardSeconds, 480);
  assert.deepEqual(parsed.command, ["node", "script.js"]);
});

test("watchdog requires a command separator and command", () => {
  assert.throws(() => parseArguments(["--estimate-minutes", "4"]), /command is required/i);
});
