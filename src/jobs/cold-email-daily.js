/**
 * cold-email-daily job
 *
 * Polls every N minutes. For each active campaign in cold_email_campaigns,
 * decides whether to fire (one batch per UTC day after fire_after_utc_hour).
 * Submits a paced batch to Resend, updates state in Postgres.
 *
 * Ports marketing/email/cold-daily-send.py (Python + launchd) into the
 * backend so it no longer depends on the user's laptop being on at 09:00.
 */

const svc = require("../services/cold-email-service");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function startColdEmailJob({
  db,
  apiKey = process.env.RESEND_API_KEY,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl,
  now = () => new Date(),
  log = (msg) => console.log(msg),
} = {}) {
  if (!db) throw new Error("startColdEmailJob: db is required");
  if (!apiKey) {
    log("[cold-email] disabled: RESEND_API_KEY not set");
    return { stop: () => {}, runNow: async () => ({ skipped: true }) };
  }

  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) return { skipped: true, reason: "already running" };
    isRunning = true;
    const results = [];
    try {
      const campaigns = await svc.listActiveCampaigns(db);
      for (const campaign of campaigns) {
        try {
          const r = await svc.processCampaign(db, campaign, {
            apiKey,
            now: now(),
            fetchImpl,
            log,
          });
          results.push({ campaignId: campaign.id, ...r });
        } catch (err) {
          log(`[cold-email:${campaign.id}] error: ${err.message}`);
          results.push({
            campaignId: campaign.id,
            fired: false,
            error: err.message,
          });
        }
      }
      return { campaigns: results };
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(() => {
    runOnce().catch((err) =>
      log(`[cold-email] unhandled error: ${err.message}`),
    );
  }, intervalMs);
  if (timer.unref) timer.unref();

  // Fire once at boot so a freshly-deployed instance picks up a missed slot.
  setImmediate(() => {
    runOnce().catch((err) => log(`[cold-email] boot error: ${err.message}`));
  });

  return {
    stop: () => clearInterval(timer),
    runNow: runOnce,
  };
}

module.exports = { startColdEmailJob };
