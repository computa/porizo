const http = require("http");
const path = require("path");
const config = require("./config");
const { getDatabase } = require("./database");
const { startJobRunner } = require("./workflows/runner");
const { createStorageProvider } = require("./storage");
const {
  createProviderRuntimeConfig,
  createStorageRuntimeConfig,
} = require("./providers/provider-config");
const { createEventsService } = require("./services/events-service");
const { startAccountCleanupJob } = require("./jobs/account-cleanup");

// IMPORTANT: In development, the server runs the job runner inline by default.
// Running worker.js separately is only needed when INLINE_JOB_RUNNER=false.
if (config.INLINE_JOB_RUNNER) {
  console.error("[Worker] ERROR: INLINE_JOB_RUNNER is enabled (default).");
  console.error("[Worker] The server already runs the job runner inline.");
  console.error("[Worker] Running worker.js separately is unnecessary.");
  console.error("[Worker] Either:");
  console.error("[Worker]   1. Just run the server: node src/server.js");
  console.error("[Worker]   2. Or set INLINE_JOB_RUNNER=false for separate worker process");
  process.exit(1);
}

async function startWorker() {
  const db = await getDatabase({
    migrationsDir: path.join(process.cwd(), "migrations"),
  });

  const { providerConfig } = createProviderRuntimeConfig(config);

  // Create storage provider (S3 in production, local in dev)
  const storage = createStorageProvider(createStorageRuntimeConfig(config));

  const eventsService = createEventsService(db);

  const runner = await startJobRunner({
    db,
    storageDir: config.STORAGE_DIR,
    streamBaseUrl: config.STREAM_BASE_URL,
    intervalMs: 1000,
    providerConfig,
    devMode: config.DEV_MODE,
    storageProvider: storage,
    eventsService,
  });
  const accountCleanupJob = startAccountCleanupJob({
    db,
    storageProvider: storage,
    logger: console,
  });

  // Health check endpoint for Railway
  const healthServer = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      try {
        // Check database connectivity
        const dbHealth = await db.healthCheck(3000);
        const isHealthy = dbHealth.healthy;

        res.writeHead(isHealthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: isHealthy ? "healthy" : "degraded",
            database: dbHealth.healthy,
            dbLatencyMs: dbHealth.latencyMs,
            activeJobs: runner.getActiveJobs(),
            maxConcurrent: runner.getMaxConcurrent(),
            processingJobs: runner.getProcessingJobIds(),
          })
        );
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unhealthy", error: err.message }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const WORKER_PORT = process.env.WORKER_PORT || 3001;
  healthServer.listen(WORKER_PORT, () => {
    console.log(`[Worker] Health endpoint listening on port ${WORKER_PORT}`);
  });

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("[Worker] Shutting down, waiting for active jobs to complete...");
    runner.stop(); // Stop accepting new jobs
    accountCleanupJob.stop();

    // Wait up to 30s for active jobs to complete
    const maxWaitMs = 30000;
    const startTime = Date.now();
    while (runner.getActiveJobs() > 0 && Date.now() - startTime < maxWaitMs) {
      console.log(`[Worker] Waiting for ${runner.getActiveJobs()} active job(s)...`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (runner.getActiveJobs() > 0) {
      console.warn(`[Worker] Forcing shutdown with ${runner.getActiveJobs()} job(s) still running`);
    } else {
      console.log("[Worker] All jobs completed, shutting down cleanly");
    }

    healthServer.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[Worker] Job worker started.");
}

startWorker().catch((err) => {
  console.error("[Worker] Failed to start:", err);
  process.exit(1);
});
