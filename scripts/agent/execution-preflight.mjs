#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function usage() {
  console.log(`Usage: node scripts/agent/execution-preflight.mjs [options]

Options:
  --scope <path>  Declare an owned file or directory (repeatable)
  --strict        Exit 2 when dirty paths exist outside declared scopes
  --json          Emit machine-readable JSON
  --help          Show this help`);
}

export function isOwnedPath(filePath, scopes) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  return scopes.some((scope) => {
    const owned = scope.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    return normalized === owned || normalized.startsWith(`${owned}/`);
  });
}

export function parsePorcelain(output) {
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    paths.push({ status, path: filePath, staged: status[0] !== " " && status[0] !== "?" });
    if (status.includes("R") || status.includes("C")) {
      index += 1;
      if (records[index]) paths.push({ status: "->", path: records[index], staged: status[0] !== " " });
    }
  }
  return paths;
}

export function main(argv = process.argv.slice(2)) {
  const scopes = [];
  let strict = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scope") {
      const value = argv[index + 1];
      if (!value) throw new Error("--scope requires a path");
      scopes.push(value);
      index += 1;
    } else if (argument === "--strict") {
      strict = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--help") {
      usage();
      return 0;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const dirty = parsePorcelain(status);
  const owned = scopes.length === 0 ? [] : dirty.filter((entry) => isOwnedPath(entry.path, scopes));
  const outside = scopes.length === 0 ? dirty : dirty.filter((entry) => !isOwnedPath(entry.path, scopes));
  const stagedOutside = outside.filter((entry) => entry.staged);
  const result = {
    root: path.resolve(root),
    branch: branch || "(detached)",
    scopes,
    dirtyCount: dirty.length,
    owned,
    outside,
    stagedOutside,
    strictPassed: !strict || stagedOutside.length === 0,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Branch: ${result.branch}`);
    console.log(`Repository: ${result.root}`);
    console.log(`Owned scopes: ${scopes.length > 0 ? scopes.join(", ") : "none declared"}`);
    console.log(`Dirty paths: ${dirty.length} (${owned.length} owned, ${outside.length} outside scope)`);
    console.log(`Staged outside scope: ${stagedOutside.length}`);
    if (outside.length > 0) {
      console.log("Outside scope:");
      outside.forEach((entry) => console.log(`  ${entry.status} ${entry.path}`));
    }
  }

  return result.strictPassed ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`agent preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
