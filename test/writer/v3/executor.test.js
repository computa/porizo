const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { executeBackendTask } = require("../../../src/writer/v3/orchestration");

function createTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-v3-exec-"));
  fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
  fs.mkdirSync(path.join(root, "test", "routes"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "src", "routes", "story.js"),
    "app.post('/story/start', async () => {});\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "test", "routes", "story.test.js"),
    "const { describe } = require('node:test');\n",
    "utf8"
  );

  return root;
}

describe("V3 Orchestration Backend Task Executor", () => {
  it("returns implemented execution for valid existing target files", async () => {
    const repoRoot = createTempRepo();

    const result = await executeBackendTask({
      task: {
        milestone: "M2",
        design_refs: ["specv3#9.2"],
        target_files: ["src/routes/story.js"],
      },
      objective: "Implement story orchestration route",
      repository: "porizo",
      repoRoot,
    });

    assert.strictEqual(result.status, "implemented");
    assert.ok(result.execution_id);
    assert.ok(result.pattern_extraction.patterns.length >= 1);
    assert.ok(Array.isArray(result.tests_added));
  });

  it("returns blocked_missing_targets for missing files", async () => {
    const repoRoot = createTempRepo();

    const result = await executeBackendTask({
      task: {
        milestone: "M3",
        design_refs: ["specv3#9.2"],
        target_files: ["src/does-not-exist.js"],
      },
      objective: "Implement missing file task",
      repository: "porizo",
      repoRoot,
    });

    assert.strictEqual(result.status, "blocked_missing_targets");
    assert.strictEqual(result.missing_targets.length, 1);
    assert.ok(result.known_risks.some((risk) => risk.includes("Missing or invalid target file")));
  });

  it("uses external runtime when configured", async () => {
    const repoRoot = createTempRepo();
    const scriptPath = path.join(repoRoot, "external-executor.js");
    fs.writeFileSync(
      scriptPath,
      `
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    execution_id: payload.baseline.execution_id,
    run_at: payload.baseline.run_at,
    status: "implemented_external",
    files_changed: payload.task.target_files,
    tests_added: ["test/routes/story.test.js"],
    known_risks: ["external_runtime_used"]
  }));
});
`,
      "utf8"
    );

    const result = await executeBackendTask({
      task: {
        milestone: "M4",
        design_refs: ["specv3#9.2"],
        target_files: ["src/routes/story.js"],
      },
      objective: "External runtime execution",
      repository: "porizo",
      repoRoot,
      runtime: {
        mode: "external",
        commandJson: JSON.stringify(["node", scriptPath]),
        timeoutMs: 5000,
      },
    });

    assert.strictEqual(result.status, "implemented_external");
    assert.strictEqual(result.runtime.mode, "external");
    assert.ok(result.known_risks.includes("external_runtime_used"));
  });
});
