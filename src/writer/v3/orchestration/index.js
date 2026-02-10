"use strict";

const {
  validatePlanningOutput,
  validateBackendTask,
  validateDebugReport,
  validatePatternExtraction,
  validateTrajectoryExample,
  assertValid,
} = require("./contracts");
const { runHttpChecks } = require("./http-debugger");
const { extractRepositoryPatterns, buildTrajectoryExample } = require("./repo-patterns");
const { executeBackendTask } = require("./executor");

function buildPlanningEnvelope(input) {
  const payload = {
    task_id: input?.task_id || "story-v3-phase-2",
    repo: input?.repo || "porizo",
    objective: input?.objective || "Implement story-v3 phase 2 orchestration",
    constraints: input?.constraints || {
      preserve_v2_resilience: true,
      backward_compatible_api: true,
    },
  };
  return payload;
}

function buildBackendTaskEnvelope(input) {
  const candidate = {
    milestone: input?.milestone,
    design_refs: input?.design_refs || [],
    target_files: input?.target_files || [],
  };
  return assertValid("backend_task", validateBackendTask(candidate));
}

async function runDebugFeedbackLoop({
  baseUrl,
  checks,
  maxAttempts = 3,
  runChecks = runHttpChecks,
  onAttempt,
}) {
  if (maxAttempts < 1) {
    throw new Error("[V3 Orchestration] maxAttempts must be >= 1.");
  }

  const reports = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rawReport = await runChecks({ baseUrl, checks });
    const report = assertValid("debug_report", validateDebugReport(rawReport));
    reports.push(report);

    if (typeof onAttempt === "function") {
      await onAttempt({ attempt, report });
    }

    if (report.passed) {
      return {
        passed: true,
        attempts: attempt,
        reports,
        final_report: report,
      };
    }
  }

  return {
    passed: false,
    attempts: maxAttempts,
    reports,
    final_report: reports[reports.length - 1],
  };
}

function extractPatternEnvelope({ repository, files }) {
  const raw = extractRepositoryPatterns({ repository, files });
  return assertValid("pattern_extraction", validatePatternExtraction(raw));
}

function buildTrajectoryEnvelope({ objective, plan, patternExtraction, reconstructionSteps }) {
  const raw = buildTrajectoryExample({
    objective,
    plan,
    patternExtraction,
    reconstructionSteps,
  });
  return assertValid("trajectory_example", validateTrajectoryExample(raw));
}

function normalizePlanningOutput(payload) {
  return assertValid("planning_output", validatePlanningOutput(payload));
}

module.exports = {
  buildPlanningEnvelope,
  buildBackendTaskEnvelope,
  normalizePlanningOutput,
  runDebugFeedbackLoop,
  extractPatternEnvelope,
  buildTrajectoryEnvelope,
  executeBackendTask,
  // raw exports
  contracts: {
    validatePlanningOutput,
    validateBackendTask,
    validateDebugReport,
    validatePatternExtraction,
    validateTrajectoryExample,
  },
};
