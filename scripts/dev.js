const { spawn } = require("child_process");

/**
 * Development server launcher.
 *
 * IMPORTANT: sql.js loads the database into memory per-process.
 * Running separate server and worker processes causes desync because
 * each has its own in-memory copy of the database.
 *
 * Solution: Always use inline job runner (single process) for development.
 * The worker.js file is only needed for production with PostgreSQL or
 * other shared-state databases.
 */

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

// Use inline job runner (INLINE_JOB_RUNNER defaults to true in config.js)
// This ensures the server and job runner share the same in-memory database
const api = spawnProcess("api", "node", ["src/server.js"]);

const shutdown = () => {
  api.kill("SIGINT");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
