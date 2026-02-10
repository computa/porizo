"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isNonEmptyString)
    .map((item) => item.trim());
}

function validatePlanningOutput(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return { valid: false, errors: ["Planning output must be an object."] };
  }

  if (!isObject(payload.architecture)) {
    errors.push("planning.architecture must be an object.");
  }

  const architecture = isObject(payload.architecture) ? payload.architecture : {};
  const newModules = normalizeStringArray(architecture.new_modules);
  const modifiedModules = normalizeStringArray(architecture.modified_modules);
  const apiChanges = normalizeStringArray(architecture.api_changes);

  if (newModules.length === 0 && modifiedModules.length === 0) {
    errors.push("planning.architecture must include at least one new or modified module.");
  }

  if (!Array.isArray(payload.milestones) || payload.milestones.length === 0) {
    errors.push("planning.milestones must contain at least one milestone.");
  }

  const milestones = Array.isArray(payload.milestones)
    ? payload.milestones
      .filter(isObject)
      .map((milestone) => ({
        id: isNonEmptyString(milestone.id) ? milestone.id.trim() : "",
        name: isNonEmptyString(milestone.name) ? milestone.name.trim() : "",
      }))
      .filter((milestone) => milestone.id && milestone.name)
    : [];

  if (Array.isArray(payload.milestones) && milestones.length !== payload.milestones.length) {
    errors.push("planning.milestones entries must include non-empty id and name.");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      architecture: {
        new_modules: newModules,
        modified_modules: modifiedModules,
        api_changes: apiChanges,
      },
      milestones,
    },
  };
}

function validateBackendTask(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { valid: false, errors: ["Backend task must be an object."] };
  }

  const milestone = isNonEmptyString(payload.milestone) ? payload.milestone.trim() : "";
  const designRefs = normalizeStringArray(payload.design_refs);
  const targetFiles = normalizeStringArray(payload.target_files);

  if (!milestone) errors.push("backend_task.milestone is required.");
  if (designRefs.length === 0) errors.push("backend_task.design_refs must include at least one ref.");
  if (targetFiles.length === 0) errors.push("backend_task.target_files must include at least one file.");

  return {
    valid: errors.length === 0,
    errors,
    value: {
      milestone,
      design_refs: designRefs,
      target_files: targetFiles,
    },
  };
}

function validateDebugReport(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { valid: false, errors: ["Debug report must be an object."] };
  }

  if (!Array.isArray(payload.checks)) {
    errors.push("debug_report.checks must be an array.");
  }

  const checks = Array.isArray(payload.checks)
    ? payload.checks
      .filter(isObject)
      .map((check) => ({
        name: isNonEmptyString(check.name) ? check.name.trim() : "",
        passed: check.passed === true,
        expected_status: typeof check.expected_status === "number" ? check.expected_status : null,
        actual_status: typeof check.actual_status === "number" ? check.actual_status : null,
        error: isNonEmptyString(check.error) ? check.error.trim() : null,
      }))
    : [];

  if (Array.isArray(payload.checks) && checks.length !== payload.checks.length) {
    errors.push("debug_report.checks entries must be objects.");
  }

  const normalized = {
    run_id: isNonEmptyString(payload.run_id) ? payload.run_id.trim() : "",
    passed: payload.passed === true,
    checks,
    failures: checks.filter((check) => !check.passed),
  };

  if (!normalized.run_id) errors.push("debug_report.run_id is required.");

  return { valid: errors.length === 0, errors, value: normalized };
}

function validatePatternExtraction(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { valid: false, errors: ["Pattern extraction payload must be an object."] };
  }

  const repository = isNonEmptyString(payload.repository) ? payload.repository.trim() : "";
  if (!repository) errors.push("pattern_extraction.repository is required.");

  const patterns = Array.isArray(payload.patterns)
    ? payload.patterns
      .filter(isObject)
      .map((pattern) => ({
        type: isNonEmptyString(pattern.type) ? pattern.type.trim() : "",
        pattern: isNonEmptyString(pattern.pattern) ? pattern.pattern.trim() : "",
        evidence: normalizeStringArray(pattern.evidence),
      }))
      .filter((pattern) => pattern.type && pattern.pattern)
    : [];

  if (patterns.length === 0) {
    errors.push("pattern_extraction.patterns must include at least one pattern.");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: { repository, patterns },
  };
}

function validateTrajectoryExample(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { valid: false, errors: ["Trajectory example payload must be an object."] };
  }

  const objective = isNonEmptyString(payload.objective) ? payload.objective.trim() : "";
  if (!objective) errors.push("trajectory_example.objective is required.");

  const steps = Array.isArray(payload.steps)
    ? payload.steps
      .filter(isObject)
      .map((step) => ({
        id: isNonEmptyString(step.id) ? step.id.trim() : "",
        instruction: isNonEmptyString(step.instruction) ? step.instruction.trim() : "",
      }))
      .filter((step) => step.id && step.instruction)
    : [];

  if (steps.length === 0) {
    errors.push("trajectory_example.steps must include at least one step.");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: {
      objective,
      plan: isObject(payload.plan) ? payload.plan : {},
      extracted_patterns: isObject(payload.extracted_patterns) ? payload.extracted_patterns : { repository: "unknown", patterns: [] },
      steps,
      metadata: isObject(payload.metadata) ? payload.metadata : {},
    },
  };
}

function assertValid(name, result) {
  if (result.valid) return result.value;
  const details = result.errors.join(" ");
  throw new Error(`[V3 Orchestration] Invalid ${name}: ${details}`);
}

module.exports = {
  validatePlanningOutput,
  validateBackendTask,
  validateDebugReport,
  validatePatternExtraction,
  validateTrajectoryExample,
  assertValid,
};
