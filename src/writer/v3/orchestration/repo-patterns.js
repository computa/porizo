"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function extractRoutePatterns(path, content) {
  const patterns = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    patterns.push({
      type: "http_route",
      pattern: `${match[1].toUpperCase()} ${match[2]}`,
      evidence: [`${path}:${match.index + 1}`],
    });
  }
  return patterns;
}

function extractDataPatterns(path, content) {
  const patterns = [];
  if (/db\.prepare\(/.test(content)) {
    patterns.push({
      type: "data_access",
      pattern: "db.prepare(...).run/get/all",
      evidence: [path],
    });
  }
  if (/db\.query\(/.test(content)) {
    patterns.push({
      type: "data_access",
      pattern: "db.query(...)",
      evidence: [path],
    });
  }
  return patterns;
}

function extractTestPatterns(path, content) {
  const patterns = [];
  if (/node:test/.test(content) || /\bdescribe\(/.test(content)) {
    patterns.push({
      type: "test_style",
      pattern: "node:test + assert",
      evidence: [path],
    });
  }
  return patterns;
}

function extractRepositoryPatterns({ repository = "", files = [] }) {
  if (!Array.isArray(files)) {
    throw new Error("[V3 Orchestration] files must be an array.");
  }

  const patterns = [];
  for (const file of files) {
    if (!isObject(file)) continue;
    const path = typeof file.path === "string" ? file.path : "";
    const content = typeof file.content === "string" ? file.content : "";
    if (!path || !content) continue;

    patterns.push(...extractRoutePatterns(path, content));
    patterns.push(...extractDataPatterns(path, content));
    patterns.push(...extractTestPatterns(path, content));
  }

  return {
    repository: repository || "unknown",
    patterns: uniqueBy(patterns, (item) => `${item.type}|${item.pattern}`),
  };
}

function buildTrajectoryExample({ objective, plan, patternExtraction, reconstructionSteps }) {
  const safeObjective = typeof objective === "string" ? objective.trim() : "";
  if (!safeObjective) {
    throw new Error("[V3 Orchestration] objective is required for trajectory example.");
  }

  const steps = Array.isArray(reconstructionSteps)
    ? reconstructionSteps
      .filter((step) => isObject(step) && typeof step.id === "string" && typeof step.instruction === "string")
      .map((step) => ({ id: step.id.trim(), instruction: step.instruction.trim() }))
      .filter((step) => step.id && step.instruction)
    : [];

  if (steps.length === 0) {
    throw new Error("[V3 Orchestration] reconstructionSteps must contain at least one valid step.");
  }

  return {
    objective: safeObjective,
    plan: isObject(plan) ? plan : {},
    extracted_patterns: isObject(patternExtraction) ? patternExtraction : { repository: "unknown", patterns: [] },
    steps,
    metadata: {
      generated_at: new Date().toISOString(),
      generator: "story-v3-trajectory-agent",
    },
  };
}

module.exports = {
  extractRepositoryPatterns,
  buildTrajectoryExample,
};
