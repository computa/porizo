#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const requiredMarkers = new Map([
  ["AGENTS.md", ["## Execution And Release Efficiency", "porizo-execution-loop", "agent:watch"]],
  ["docs/agent-execution-policy.md", ["## Validation Ladder", "## Parallel Agents", "## Git And Release Discipline"]],
  [".agents/skills/porizo-execution-loop/SKILL.md", ["name: porizo-execution-loop", "## 3. Execute With Watchdogs"]],
  [".github/workflows/agent-execution-policy.yml", ["npm run agent:policy-check"]],
]);

const failures = [];
for (const [file, markers] of requiredMarkers) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
    continue;
  }
  for (const marker of markers) {
    if (!contents.includes(marker)) failures.push(`${file}: missing ${JSON.stringify(marker)}`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["agent:preflight", "agent:watch", "agent:policy-check"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json: missing script ${script}`);
}

for (const script of [
  "scripts/agent/execution-preflight.mjs",
  "scripts/agent/run-with-watchdog.mjs",
  "scripts/agent/verify-execution-policy.mjs",
]) {
  try {
    execFileSync(process.execPath, ["--check", script], { stdio: "pipe" });
  } catch (error) {
    failures.push(`${script}: syntax check failed\n${error.stderr?.toString() ?? error.message}`);
  }
}

try {
  execFileSync(process.execPath, ["--test", "scripts/agent/execution-tools.test.mjs"], {
    stdio: "pipe",
  });
} catch (error) {
  failures.push(
    `scripts/agent/execution-tools.test.mjs: tests failed\n${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? error.message}`,
  );
}

if (failures.length > 0) {
  console.error("Execution policy verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Execution policy verification passed.");
}
