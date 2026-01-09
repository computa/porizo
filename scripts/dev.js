const { spawn } = require("child_process");

function spawnProcess(label, command, args, env = process.env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env,
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[dev] ${label} exited with code ${code}`);
    }
  });
  return child;
}

const serverEnv = { ...process.env, INLINE_JOB_RUNNER: "false" };
const api = spawnProcess("api", "node", ["src/server.js"], serverEnv);
const worker = spawnProcess("worker", "node", ["src/worker.js"]);

const shutdown = () => {
  api.kill("SIGINT");
  worker.kill("SIGINT");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
