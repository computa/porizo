---
title: "Infrastructure Upgrade: Multi-Worker Scaling for 50-100 Concurrent Users"
type: refactor
date: 2026-02-05
priority: high
status: planning
reviewed: 2026-02-05
---

# Infrastructure Upgrade: Multi-Worker Scaling

## Review Synthesis (Feb 5, 2026)

**Agents consulted:** deepen-plan (infrastructure patterns, best practices, PostgreSQL scaling) + plan_review (DHH Rails review, data integrity, architecture strategy, security sentinel)

### Critical Feedback: Over-Engineering Risk

The DHH-style review raised a valid concern: **this plan may be over-architected for 50-100 users**.

> "Delete the plan. Ship the product. Scale when you have real scaling problems."

The current single-threaded runner with 10 DB connections can handle ~40 renders/hour. For 50-100 users who aren't all rendering simultaneously, this may be sufficient.

### Decision Required: Choose Implementation Scope

| Option | Changes | Effort | Capacity |
|--------|---------|--------|----------|
| **A: Full Plan** | Multi-worker + service separation + Railway config | 13 tasks | 240-360 renders/hr |
| **B: Minimal** | Remove SQLite + increase pool to 15 | 4 tasks | ~60 renders/hr |
| **C: Hybrid** | Remove SQLite + concurrent tick loop (no service separation) | 7 tasks | ~120 renders/hr |

**Decision (Feb 5):** User selected **Option A: Full Plan** - implement complete multi-worker architecture for maximum capacity headroom.

### Data Integrity Issues Identified

1. **Recovery race condition:** Stale job recovery could reclaim jobs still processing
   - Fix: Add `locked_at + grace_period > NOW()` check before recovery

2. **Missing ownership verification:** Job writes don't verify worker still owns the job
   - Fix: Add `WHERE locked_by = $workerId` to status updates

### PostgreSQL Best Practices Applied

- Use `FOR UPDATE SKIP LOCKED` instead of mutex for efficient job claiming
- Connection pool sizing: 2-3× expected concurrent queries
- Add `statement_timeout` to prevent long-running queries

---

## Overview

Upgrade Porizo from single-threaded job processing to a multi-worker architecture capable of supporting **50-100 concurrent users**. This involves removing SQLite, enabling concurrent job processing, and separating API and Worker services for independent scaling on Railway.

## Problem Statement

**Current State:**
- Single-threaded job runner processes ONE render at a time
- SQLite (sql.js) prevents running multiple worker processes (causes database desync)
- PostgreSQL connection pool limited to 10 connections
- ~40 renders/hour maximum throughput

**Target State:**
- 6-9 concurrent renders (3 jobs/worker × 2-3 workers)
- 240-360 renders/hour throughput
- Independent API and Worker scaling on Railway
- PostgreSQL-only for production simplicity

## Technical Approach

### Architecture Diagram

```
┌────────────────────┐     ┌────────────────────┐
│   API Service      │     │  Worker Service    │
│  INLINE_JOB_RUNNER │     │  ┌──────────────┐  │
│     = false        │     │  │ Worker 1     │  │
│                    │     │  │ (3 jobs max) │  │
│  Handles:          │     │  └──────────────┘  │
│  - HTTP requests   │     │  ┌──────────────┐  │
│  - Auth/billing    │     │  │ Worker 2     │  │
│  - Rate limiting   │     │  │ (3 jobs max) │  │
└─────────┬──────────┘     └─────────┬──────────┘
          │                          │
          ▼                          ▼
┌─────────────────────────────────────────────────┐
│         PostgreSQL (20-30 connections)          │
│         Shared DATABASE_URL                     │
└─────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────┐
│         S3/R2 Object Storage                    │
│         Shared audio files                      │
└─────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Prerequisites Verification ✅
- [x] Confirm PostgreSQL is production database (Railway provides DATABASE_URL)
- [ ] Verify S3/R2 storage is configured for production
- [ ] Run async/await audit to identify gaps

#### Phase 2: SQLite Removal (Code Cleanup)
- [ ] Delete `src/db.js` (legacy SQLite initialization)
- [ ] Delete `src/database/sqlite.js` (SQLite adapter)
- [ ] Update `src/database/index.js` to PostgreSQL-only
- [ ] Remove `sql.js` from package.json dependencies
- [ ] Fix DLQ placeholder format in `src/workflows/dlq.js`

#### Phase 3: Multi-Worker Support
- [ ] Remove single-job mutex in `src/workflows/runner.js:1176`
- [ ] Add `MAX_CONCURRENT_JOBS` configuration (default: 3)
- [ ] Update `src/worker.js` to use `getDatabase()`
- [ ] Add health endpoint to worker for Railway monitoring
- [ ] Increase connection pool to 20 (configurable via env var)

#### Phase 4: Railway Deployment
- [ ] Create `Dockerfile.worker` for worker service
- [ ] Update Railway configuration for API service
- [ ] Create new Railway service for workers
- [ ] Configure shared DATABASE_URL and S3 credentials
- [ ] Document rollback procedure

#### Phase 5: Verification & Monitoring
- [ ] Load test with 50 concurrent users
- [ ] Monitor connection pool metrics
- [ ] Verify job distribution across workers
- [ ] Set up alerts for DLQ growth

---

## Detailed Task Breakdown

### Task 1: Async/Await Audit (Prerequisite)
**Assignee:** Agent (research)
**Priority:** P0 - Blocking
**Estimate:** 30 min

Run existing audit script and verify PostgreSQL compatibility:
```bash
node scripts/pg-await-audit.js
rg -n "db\.prepare\(" src --type js | head -50
```

**Acceptance Criteria:**
- [ ] All missing `await` calls identified
- [ ] Critical paths verified: `/auth/me`, job runner, admin routes

---

### Task 2: Delete SQLite Files
**Assignee:** Agent (implementation)
**Priority:** P0
**Estimate:** 15 min

**Files to DELETE:**
- `src/db.js` - Legacy SQLite initialization
- `src/database/sqlite.js` - SQLite adapter

**Verification:**
```bash
# Should find NO references after deletion
rg "initDb|createSqliteAdapter|sql\.js" src --type js
```

---

### Task 3: Update Database Index (PostgreSQL-Only)
**Assignee:** Agent (implementation)
**Priority:** P0
**Estimate:** 20 min

**File:** `src/database/index.js`

```javascript
// BEFORE: Lines 32-55
async function getDatabase(config = {}) {
  const provider = config.provider || process.env.DB_PROVIDER || 'postgres';
  if (provider === 'postgres') {
    // PostgreSQL code...
  }
  // SQLite fallback - TO BE REMOVED
  const { createSqliteAdapter } = require('./sqlite.js');
  return createSqliteAdapter({...});
}

// AFTER: PostgreSQL only
const path = require('path');

async function getDatabase(config = {}) {
  const { createPool, runMigrations } = require('./postgres.js');
  const db = createPool(config.postgres || {});

  if (config.migrationsDir) {
    const pgMigrationsDir = path.join(config.migrationsDir, 'pg');
    await runMigrations(db, pgMigrationsDir);
  }

  return db;
}

module.exports = { getDatabase };
```

**Acceptance Criteria:**
- [ ] No SQLite imports remain
- [ ] `getDatabase()` returns PostgreSQL pool
- [ ] Migrations run from `pg/` subdirectory

---

### Task 4: Fix DLQ Placeholder Format
**Assignee:** Agent (implementation)
**Priority:** P1
**Estimate:** 15 min

**File:** `src/workflows/dlq.js`

**Problem:** Uses `?` placeholders which don't convert to PostgreSQL's `$1` format.

**Search Pattern:**
```bash
rg "\?" src/workflows/dlq.js
```

**Fix:** Convert all `?` to `$1, $2, ...` format or use parameterized query builder.

---

### Task 5: Update Worker to Use getDatabase()
**Assignee:** Agent (implementation)
**Priority:** P0
**Estimate:** 20 min

**File:** `src/worker.js`

```javascript
// BEFORE: Lines 3, 22-25
const { initDb } = require("./db");  // SQLite
const db = await initDb({
  dbPath: config.DB_PATH,
  migrationsDir: path.join(process.cwd(), "migrations"),
});

// AFTER: PostgreSQL via abstraction
const { getDatabase } = require("./database");
const db = await getDatabase({
  migrationsDir: path.join(process.cwd(), "migrations"),
});
```

**Additional Changes:**
- Remove SQLite-specific `db.save()` interval (lines 87-88)
- Add health check endpoint for Railway

---

### Task 6: Add Worker Health Endpoint
**Assignee:** Agent (implementation)
**Priority:** P1
**Estimate:** 30 min

**File:** `src/worker.js`

Add HTTP server for health checks (Railway requirement):

```javascript
const http = require('http');

// After job runner starts
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      workerId: runnerId,
      activeJobs: activeJobs
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const WORKER_PORT = process.env.WORKER_PORT || 3001;
healthServer.listen(WORKER_PORT, () => {
  console.log(`[Worker] Health endpoint listening on port ${WORKER_PORT}`);
});
```

---

### Task 7: Remove Job Runner Mutex (Enable Concurrency)
**Assignee:** Agent (implementation)
**Priority:** P0
**Estimate:** 45 min

**File:** `src/workflows/runner.js` (lines 1176-1184)

```javascript
// BEFORE: Single job mutex
let isProcessing = false;

const tick = async () => {
  if (isProcessing) { return; }
  isProcessing = true;
  try {
    const jobs = await selectJobs.all(now);
    for (const job of jobs) {
      // Process ONE job sequentially
    }
  } finally {
    isProcessing = false;
  }
};

// AFTER: Concurrent job processing
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
let activeJobs = 0;
const processingJobs = new Set();

const tick = async () => {
  const now = new Date().toISOString();
  const availableSlots = MAX_CONCURRENT - activeJobs;
  if (availableSlots <= 0) return;

  const jobs = await selectJobs.all(now);
  const jobsToProcess = jobs
    .filter(j => !processingJobs.has(j.id))
    .slice(0, availableSlots);

  for (const job of jobsToProcess) {
    processingJobs.add(job.id);
    activeJobs++;

    // Process job in background (don't await)
    processJob(job)
      .catch(err => console.error(`[JobRunner] Job ${job.id} error:`, err))
      .finally(() => {
        activeJobs--;
        processingJobs.delete(job.id);
      });
  }
};

// Extract job processing to separate function
async function processJob(job) {
  // ... existing job processing logic from tick()
}
```

**Acceptance Criteria:**
- [ ] Multiple jobs can process simultaneously
- [ ] `MAX_CONCURRENT_JOBS` env var respected
- [ ] Job claiming still uses atomic UPDATE (race-condition safe)
- [ ] Proper error handling for individual job failures

---

### Task 8: Increase Connection Pool Size
**Assignee:** Agent (implementation)
**Priority:** P1
**Estimate:** 10 min

**File:** `src/database/postgres.js` (line 39)

```javascript
// BEFORE
max: config.maxConnections || 10,

// AFTER
max: config.maxConnections || parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
```

**File:** `src/config.js`

```javascript
// Add new config
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);

module.exports = {
  // ... existing exports
  DB_MAX_CONNECTIONS,
  MAX_CONCURRENT_JOBS,
};
```

---

### Task 9: Remove sql.js Dependency
**Assignee:** Agent (implementation)
**Priority:** P2
**Estimate:** 5 min

**File:** `package.json`

```bash
npm uninstall sql.js
```

Verify no remaining imports:
```bash
rg "sql\.js|sql-js|initSqlJs" . --type js
```

---

### Task 10: Create Worker Dockerfile
**Assignee:** Agent (implementation)
**Priority:** P1
**Estimate:** 20 min

**File:** `Dockerfile.worker`

```dockerfile
FROM node:20-slim

# Install FFmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.WORKER_PORT || 3001) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Worker process
CMD ["node", "src/worker.js"]
```

---

### Task 11: Update API Service Configuration
**Assignee:** Agent (implementation)
**Priority:** P1
**Estimate:** 10 min

**Railway API Service Environment:**
```env
INLINE_JOB_RUNNER=false
DB_MAX_CONNECTIONS=15
# ... existing env vars
```

**Dockerfile** (existing, no changes needed - already runs server.js)

---

### Task 12: Railway Worker Service Setup
**Assignee:** Human (manual)
**Priority:** P1
**Estimate:** 30 min

**Steps:**
1. Create new Railway service from same GitHub repo
2. Set build command: `npm ci --only=production`
3. Set start command: `node src/worker.js`
4. Configure Dockerfile path: `Dockerfile.worker`
5. Copy environment variables from API service:
   - `DATABASE_URL` (same as API)
   - `STORAGE_PROVIDER=s3`
   - `S3_*` credentials (same as API)
   - `MAX_CONCURRENT_JOBS=3`
   - `DB_MAX_CONNECTIONS=10`
   - All provider API keys (`SUNO_*`, `ELEVENLABS_*`, `REPLICATE_*`, etc.)
6. Set up health check endpoint monitoring

---

### Task 13: Load Testing
**Assignee:** Human (manual)
**Priority:** P2
**Estimate:** 2 hours

**Test Plan:**
1. Deploy API + 1 Worker to Railway staging
2. Submit 10 concurrent render requests
3. Verify jobs distributed across workers
4. Monitor:
   - Connection pool usage (`db.getStats()`)
   - Job queue depth
   - Worker memory/CPU
   - Render completion times
5. Scale to 50 concurrent users
6. Document findings

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Storage access failures | High | Critical | Verify S3/R2 config before worker separation |
| DLQ breaking on PostgreSQL | High | Medium | Fix placeholder format first |
| Connection pool exhaustion | Medium | High | Start with 20 connections, monitor |
| Jobs abandoned mid-deploy | Medium | Medium | Stale job recovery handles this (5 min timeout) |
| Memory pressure from concurrent FFmpeg | Low | High | Limit MAX_CONCURRENT_JOBS=3 |

---

## Rollback Procedure

If issues arise after deployment:

1. **Immediate:** Set `INLINE_JOB_RUNNER=true` on API service, disable worker service
2. **Database:** No schema changes, rollback is configuration-only
3. **Code:** Revert to previous commit if code issues found

---

## Success Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Concurrent renders | 1 | 6-9 | Admin dashboard job count |
| Renders per hour | ~40 | ~240 | Job completion rate |
| API response time (p95) | <200ms | <200ms | Railway metrics |
| Connection pool utilization | ~50% | <80% | `db.getStats()` |

---

## References

### Internal
- `src/workflows/runner.js:1176-1184` - Current mutex implementation
- `src/database/postgres.js:32-48` - Connection pool configuration
- `src/worker.js` - Standalone worker process
- `docs/plans/2026-01-24-pg-await-audit.md` - PostgreSQL async/await audit

### External
- [Railway Service Networking](https://docs.railway.app/guides/private-networking)
- [Node.js pg Pool Configuration](https://node-postgres.com/apis/pool)

---

## Task Assignment Summary

| Task | Assignee | Priority | Status |
|------|----------|----------|--------|
| 1. Async/Await Audit | Agent | P0 | ⏳ Pending |
| 2. Delete SQLite Files | Agent | P0 | ⏳ Pending |
| 3. Update Database Index | Agent | P0 | ⏳ Pending |
| 4. Fix DLQ Placeholders | Agent | P1 | ⏳ Pending |
| 5. Update Worker Database | Agent | P0 | ⏳ Pending |
| 6. Worker Health Endpoint | Agent | P1 | ⏳ Pending |
| 7. Remove Job Mutex | Agent | P0 | ⏳ Pending |
| 8. Increase Pool Size | Agent | P1 | ⏳ Pending |
| 9. Remove sql.js Dep | Agent | P2 | ⏳ Pending |
| 10. Worker Dockerfile | Agent | P1 | ⏳ Pending |
| 11. API Service Config | Agent | P1 | ⏳ Pending |
| 12. Railway Worker Setup | Human | P1 | ⏳ Pending |
| 13. Load Testing | Human | P2 | ⏳ Pending |
