"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { validateBackendTask, validatePatternExtraction, validateTrajectoryExample, assertValid } = require("./contracts");
const { extractRepositoryPatterns, buildTrajectoryExample } = require("./repo-patterns");

const MAX_FILE_READ_BYTES = 200000;
const MAX_EXTERNAL_OUTPUT_BYTES = 500000;
const DEFAULT_EXTERNAL_TIMEOUT_MS = 120000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function normalizeExistingPath(candidatePath, repoRoot) {
  if (typeof candidatePath !== "string") return null;
  const trimmed = candidatePath.trim();
  if (!trimmed) return null;

  const absolutePath = path.resolve(repoRoot, trimmed);
  const normalizedRoot = path.resolve(repoRoot);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  if (!fs.statSync(absolutePath).isFile()) {
    return null;
  }
  return absolutePath;
}

function readTargetFiles(targetFiles, repoRoot) {
  const files = [];
  const missingTargets = [];
  const knownRisks = [];

  for (const targetFile of targetFiles) {
    const absolutePath = normalizeExistingPath(targetFile, repoRoot);
    if (!absolutePath) {
      missingTargets.push(targetFile);
      knownRisks.push(`Missing or invalid target file: ${targetFile}`);
      continue;
    }

    const size = fs.statSync(absolutePath).size;
    if (size > MAX_FILE_READ_BYTES) {
      knownRisks.push(`Skipped large file (> ${MAX_FILE_READ_BYTES} bytes): ${targetFile}`);
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    files.push({ path: targetFile, content });
  }

  return { files, missingTargets, knownRisks };
}

function suggestTestFiles(targetFiles, repoRoot) {
  const candidates = new Set();

  for (const targetFile of targetFiles) {
    if (typeof targetFile !== "string") continue;
    if (!targetFile.startsWith("src/") || !targetFile.endsWith(".js")) continue;

    const rel = targetFile.slice("src/".length).replace(/\.js$/, ".test.js");
    candidates.add(path.join("test", rel).replaceAll("\\", "/"));
  }

  return [...candidates].filter((candidate) =>
    fs.existsSync(path.resolve(repoRoot, candidate))
  );
}

function buildDefaultReconstructionSteps(task, loadedFiles) {
  const firstFile = loadedFiles[0]?.path || task.target_files[0] || "src/routes/story.js";
  return [
    { id: "1", instruction: `Implement ${task.milestone} in ${firstFile}` },
    { id: "2", instruction: "Add or update tests covering new behavior" },
    { id: "3", instruction: "Run lint and full test suite, then report results" },
  ];
}

function ensurePatternExtractionHasMinimumShape(extractedPatterns, backendTask) {
  if (!Array.isArray(extractedPatterns.patterns) || extractedPatterns.patterns.length === 0) {
    extractedPatterns.patterns = [
      {
        type: "execution_plan",
        pattern: `milestone:${backendTask.milestone}`,
        evidence: backendTask.target_files.length ? backendTask.target_files : ["<none>"],
      },
    ];
  }
  return extractedPatterns;
}

function buildLocalExecution({
  task,
  objective,
  plan = {},
  repository = "porizo",
  reconstructionSteps = null,
  repoRoot = process.cwd(),
  executionId = crypto.randomUUID(),
}) {
  const backendTask = assertValid("backend_task", validateBackendTask(task || {}));
  const { files, missingTargets, knownRisks } = readTargetFiles(backendTask.target_files, repoRoot);

  const extractedPatterns = ensurePatternExtractionHasMinimumShape(
    extractRepositoryPatterns({ repository, files }),
    backendTask
  );
  const patternExtraction = assertValid(
    "pattern_extraction",
    validatePatternExtraction(extractedPatterns)
  );

  const steps = Array.isArray(reconstructionSteps) && reconstructionSteps.length > 0
    ? reconstructionSteps
    : buildDefaultReconstructionSteps(backendTask, files);

  const trajectoryRaw = buildTrajectoryExample({
    objective: typeof objective === "string" && objective.trim()
      ? objective
      : `Execute ${backendTask.milestone}`,
    plan,
    patternExtraction,
    reconstructionSteps: steps,
  });
  const trajectoryExample = assertValid("trajectory_example", validateTrajectoryExample(trajectoryRaw));
  const testsAdded = suggestTestFiles(backendTask.target_files, repoRoot);

  if (testsAdded.length === 0) {
    knownRisks.push("No existing mapped tests found for target files; tests may need to be created.");
  }

  const status = files.length > 0 ? "implemented" : "blocked_missing_targets";

  return {
    execution_id: executionId,
    run_at: new Date().toISOString(),
    milestone: backendTask.milestone,
    files_changed: backendTask.target_files,
    tests_added: testsAdded,
    known_risks: knownRisks,
    status,
    files_scanned: files.map((file) => file.path),
    missing_targets: missingTargets,
    pattern_extraction: patternExtraction,
    trajectory_example: trajectoryExample,
    runtime: {
      mode: "local",
    },
  };
}

function parseExternalCommand(commandJson) {
  if (!isNonEmptyString(commandJson)) {
    throw new Error("ORCHESTRATION_EXTERNAL_COMMAND_JSON is required when runtime mode is external.");
  }

  let parsed;
  try {
    parsed = JSON.parse(commandJson);
  } catch {
    throw new Error("ORCHESTRATION_EXTERNAL_COMMAND_JSON must be a valid JSON array of command tokens.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("ORCHESTRATION_EXTERNAL_COMMAND_JSON must be a non-empty JSON array.");
  }

  const command = parsed.map((token) => (typeof token === "string" ? token.trim() : ""));
  if (command.some((token) => token.length === 0)) {
    throw new Error("ORCHESTRATION_EXTERNAL_COMMAND_JSON tokens must be non-empty strings.");
  }
  return command;
}

function runExternalProcess({ command, input, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`External executor timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_EXTERNAL_OUTPUT_BYTES && !settled) {
        settled = true;
        clearTimeout(timeout);
        proc.kill("SIGKILL");
        reject(new Error(`External executor stdout exceeded ${MAX_EXTERNAL_OUTPUT_BYTES} bytes.`));
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_EXTERNAL_OUTPUT_BYTES && !settled) {
        settled = true;
        clearTimeout(timeout);
        proc.kill("SIGKILL");
        reject(new Error(`External executor stderr exceeded ${MAX_EXTERNAL_OUTPUT_BYTES} bytes.`));
      }
    });

    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`External executor failed to start: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `External executor exited with code ${code}. ${stderr.trim() || "No stderr output."}`
          )
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

function normalizeExternalOutput({ raw, baseline }) {
  if (!isObject(raw)) {
    throw new Error("External executor output must be a JSON object.");
  }

  const knownRisks = [
    ...normalizeStringArray(baseline.known_risks),
    ...normalizeStringArray(raw.known_risks),
  ];

  let patternExtraction = baseline.pattern_extraction;
  if (isObject(raw.pattern_extraction)) {
    const validated = validatePatternExtraction(raw.pattern_extraction);
    if (validated.valid) {
      patternExtraction = validated.value;
    } else {
      knownRisks.push(`External pattern_extraction invalid: ${validated.errors.join(" ")}`);
    }
  }

  let trajectoryExample = baseline.trajectory_example;
  if (isObject(raw.trajectory_example)) {
    const validated = validateTrajectoryExample(raw.trajectory_example);
    if (validated.valid) {
      trajectoryExample = validated.value;
    } else {
      knownRisks.push(`External trajectory_example invalid: ${validated.errors.join(" ")}`);
    }
  }

  return {
    execution_id: isNonEmptyString(raw.execution_id)
      ? raw.execution_id.trim()
      : baseline.execution_id,
    run_at: isNonEmptyString(raw.run_at) ? raw.run_at.trim() : baseline.run_at,
    milestone: baseline.milestone,
    files_changed: normalizeStringArray(raw.files_changed).length > 0
      ? normalizeStringArray(raw.files_changed)
      : baseline.files_changed,
    tests_added: normalizeStringArray(raw.tests_added),
    known_risks: knownRisks,
    status: isNonEmptyString(raw.status) ? raw.status.trim() : baseline.status,
    files_scanned: normalizeStringArray(raw.files_scanned).length > 0
      ? normalizeStringArray(raw.files_scanned)
      : baseline.files_scanned,
    missing_targets: normalizeStringArray(raw.missing_targets).length > 0
      ? normalizeStringArray(raw.missing_targets)
      : baseline.missing_targets,
    pattern_extraction: patternExtraction,
    trajectory_example: trajectoryExample,
    runtime: baseline.runtime,
  };
}

async function executeWithExternalRuntime({
  task,
  objective,
  plan,
  repository,
  reconstructionSteps,
  repoRoot,
  executionId,
  runtime,
}) {
  const baseline = buildLocalExecution({
    task,
    objective,
    plan,
    repository,
    reconstructionSteps,
    repoRoot,
    executionId,
  });
  const command = parseExternalCommand(runtime.commandJson);
  const timeoutMs = Number.isInteger(runtime.timeoutMs) && runtime.timeoutMs > 0
    ? runtime.timeoutMs
    : DEFAULT_EXTERNAL_TIMEOUT_MS;

  const start = Date.now();
  const processResult = await runExternalProcess({
    command,
    cwd: repoRoot,
    timeoutMs,
    input: {
      task: {
        milestone: baseline.milestone,
        design_refs: task.design_refs,
        target_files: task.target_files,
      },
      objective,
      plan: plan || {},
      repository,
      reconstruction_steps: reconstructionSteps || [],
      repo_root: repoRoot,
      baseline,
    },
  });

  const outputText = processResult.stdout.trim();
  if (!outputText) {
    throw new Error("External executor returned empty stdout.");
  }

  let parsedOutput;
  try {
    parsedOutput = JSON.parse(outputText);
  } catch {
    throw new Error("External executor stdout is not valid JSON.");
  }

  const normalized = normalizeExternalOutput({ raw: parsedOutput, baseline });
  normalized.runtime = {
    mode: "external",
    command,
    exit_code: processResult.code,
    duration_ms: Date.now() - start,
    stderr_excerpt: processResult.stderr
      ? processResult.stderr.trim().slice(0, 2000)
      : "",
  };
  return normalized;
}

async function executeBackendTask({
  task,
  objective,
  plan = {},
  repository = "porizo",
  reconstructionSteps = null,
  repoRoot = process.cwd(),
  executionId = crypto.randomUUID(),
  runtime = { mode: "local" },
}) {
  const mode = isNonEmptyString(runtime?.mode)
    ? runtime.mode.trim().toLowerCase()
    : "local";

  if (mode === "external") {
    try {
      return await executeWithExternalRuntime({
        task,
        objective,
        plan,
        repository,
        reconstructionSteps,
        repoRoot,
        executionId,
        runtime: {
          commandJson: runtime.commandJson,
          timeoutMs: runtime.timeoutMs,
        },
      });
    } catch (error) {
      const wrapped = new Error(error.message);
      wrapped.code = error.code || "EXTERNAL_EXECUTOR_FAILED";
      throw wrapped;
    }
  }

  return buildLocalExecution({
    task,
    objective,
    plan,
    repository,
    reconstructionSteps,
    repoRoot,
    executionId,
  });
}

module.exports = {
  executeBackendTask,
  _internal: {
    readTargetFiles,
    suggestTestFiles,
    buildLocalExecution,
    parseExternalCommand,
    runExternalProcess,
    normalizeExternalOutput,
  },
};
