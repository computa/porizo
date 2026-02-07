# Railway Deployment Configuration

## Overview

Porizo deploys to Railway with two service types:
1. **API Service** - Handles HTTP requests, auth, billing
2. **Worker Service(s)** - Processes background jobs (renders, enrollments)

Both services share the same PostgreSQL database and S3/R2 storage.

## Architecture

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

## API Service Configuration

### Build Settings

- **Build Command:** `npm ci --only=production`
- **Start Command:** `node src/server.js` (handled by Dockerfile)
- **Dockerfile:** `Dockerfile` (default)

### Required Environment Variables

```env
# Database
DATABASE_URL=<Railway PostgreSQL connection string>

# Database connection pool
DB_MAX_CONNECTIONS=15

# Job processing (MUST be false for multi-worker architecture)
INLINE_JOB_RUNNER=false

# Storage
STORAGE_PROVIDER=s3
S3_BUCKET=<your-bucket>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_BASE_URL=<optional-custom-domain>

# API Keys (for delegating work to workers)
# ... copy all provider keys from local .env
```

### Notes

- **No Dockerfile changes needed** - The existing `Dockerfile` already runs `src/server.js`
- Set `INLINE_JOB_RUNNER=false` to disable the built-in job runner (workers will handle jobs)
- Lower connection pool (`DB_MAX_CONNECTIONS=15`) since API is stateless

## Worker Service Configuration

### Build Settings

- **Build Command:** `npm ci --only=production`
- **Start Command:** `node src/worker.js`
- **Dockerfile:** `Dockerfile.worker`

### Required Environment Variables

```env
# Database (SAME as API service)
DATABASE_URL=<copy from API service>

# Database connection pool
DB_MAX_CONNECTIONS=10

# Worker configuration
MAX_CONCURRENT_JOBS=3
WORKER_PORT=3001

# Storage (SAME as API service)
STORAGE_PROVIDER=s3
S3_BUCKET=<your-bucket>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_BASE_URL=<optional-custom-domain>

# All provider API keys (REQUIRED - workers do the actual rendering)
SUNO_API_KEY=<key>
ELEVENLABS_API_KEY=<key>
REPLICATE_API_TOKEN=<key>
SEED_VC_BASE_URL=<gradio-server-url>

# ... copy ALL provider keys from API service
```

### Notes

- **Dockerfile.worker** is required (see below)
- Workers need **all provider API keys** since they execute rendering jobs
- Set `MAX_CONCURRENT_JOBS=3` to process 3 jobs simultaneously per worker instance
- Health check endpoint runs on `WORKER_PORT` (default: 3001)

## Dockerfile.worker

Create this file at the repository root:

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

# Health check for Railway monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.WORKER_PORT || 3001) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Worker process
CMD ["node", "src/worker.js"]
```

## Deployment Checklist

### Before First Deploy

- [ ] **Verify PostgreSQL setup** - Railway provides `DATABASE_URL` automatically
- [ ] **Configure S3/R2 storage** - See `docs/provider-setup.md`
- [ ] **Run async/await audit** - Ensure PostgreSQL compatibility (`node scripts/pg-await-audit.js`)
- [ ] **Test locally** - Deploy with `INLINE_JOB_RUNNER=false` and verify API still works

### API Service Setup

1. Create Railway service from GitHub repo
2. Set environment variables (see above)
3. Ensure `INLINE_JOB_RUNNER=false`
4. Deploy and verify `/health` endpoint

### Worker Service Setup

1. Create **new** Railway service from same GitHub repo
2. Set **Dockerfile path** to `Dockerfile.worker` in Railway settings
3. Copy environment variables from API service (see above)
4. Add worker-specific vars: `MAX_CONCURRENT_JOBS=3`, `DB_MAX_CONNECTIONS=10`, `WORKER_PORT=3001`
5. Deploy and verify `/health` endpoint

### Post-Deploy Verification

- [ ] API service responds to HTTP requests
- [ ] Worker service health check passes (`/health` returns 200)
- [ ] Submit a test render request
- [ ] Verify job appears in database queue
- [ ] Verify worker picks up and processes job
- [ ] Check Railway logs for both services

## Scaling Strategy

### Horizontal Scaling

**Scale workers independently from API:**

- **API scaling**: Based on HTTP traffic (requests per second)
- **Worker scaling**: Based on job queue depth (pending jobs)

**Example scaling rules:**
- Queue depth < 10 jobs → 1 worker instance
- Queue depth 10-50 jobs → 2-3 worker instances
- Queue depth > 50 jobs → 4+ worker instances

### Capacity Planning

| Workers | Jobs/Worker | Total Concurrent | Renders/Hour |
|---------|-------------|------------------|--------------|
| 1 | 3 | 3 | ~120 |
| 2 | 3 | 6 | ~240 |
| 3 | 3 | 9 | ~360 |

**Cost estimate per render:**
- Preview (15-25s): ~$0.07
- Full render (45-90s): ~$0.25

### Connection Pool Sizing

**Total database connections needed:**
```
API connections = DB_MAX_CONNECTIONS × API instances
Worker connections = DB_MAX_CONNECTIONS × Worker instances

Example: 2 API + 3 Workers
= (15 × 2) + (10 × 3) = 60 connections
```

**Railway PostgreSQL tiers:**
- Hobby: 20 connections (sufficient for 1 API + 1 Worker)
- Pro: 100 connections (supports 3 API + 6 Workers)

## Monitoring

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Job queue depth | `SELECT COUNT(*) FROM jobs WHERE status='PENDING'` | > 50 |
| Active workers | Railway dashboard | < 1 (no workers running) |
| Job failure rate | `SELECT COUNT(*) FROM jobs WHERE status='FAILED'` | > 5% |
| Connection pool usage | `db.getStats()` | > 80% |
| Worker memory | Railway metrics | > 1GB |

### Health Endpoints

- **API**: `https://<api-domain>/health`
- **Worker**: Health check runs internally on port 3001 (not publicly exposed)

### Logs

**Check worker logs:**
```bash
# Railway CLI
railway logs --service worker

# Look for:
# - "[Worker] Job {id} started"
# - "[Worker] Job {id} completed"
# - "[Worker] Health endpoint listening"
```

## Troubleshooting

### Jobs Not Processing

**Symptoms:** Jobs stay in `PENDING` status

**Diagnosis:**
1. Check worker service is running: `railway ps`
2. Check worker logs: `railway logs --service worker`
3. Verify `DATABASE_URL` matches between API and worker
4. Verify worker has all provider API keys

**Fix:**
- Restart worker service
- Verify `INLINE_JOB_RUNNER=false` on API service

### Connection Pool Exhausted

**Symptoms:** `Error: Connection pool timeout`

**Diagnosis:**
1. Count active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Check `DB_MAX_CONNECTIONS` settings
3. Verify connection leaks (queries not properly releasing connections)

**Fix:**
- Increase `DB_MAX_CONNECTIONS` (ensure Railway tier supports it)
- Reduce `MAX_CONCURRENT_JOBS` per worker
- Scale down worker instances temporarily

### Worker Out of Memory

**Symptoms:** Worker crashes with `ENOMEM` or restarts frequently

**Diagnosis:**
1. Check Railway metrics for memory usage
2. Check `MAX_CONCURRENT_JOBS` setting

**Fix:**
- Reduce `MAX_CONCURRENT_JOBS` from 3 to 2
- Upgrade Railway plan for more memory
- Investigate memory leaks in job processing code

## Rollback Procedure

If issues arise after deployment:

### Immediate Rollback (5 minutes)

1. **Disable workers:**
   - Stop all worker service instances in Railway
   - OR set `MAX_CONCURRENT_JOBS=0` on workers

2. **Enable inline job runner on API:**
   - Set `INLINE_JOB_RUNNER=true` on API service
   - Restart API service

3. **Verify single-threaded processing works:**
   - Submit test render
   - Check job completes

### Full Rollback (15 minutes)

1. Revert code to previous commit
2. Redeploy API service
3. Delete worker service(s)
4. Verify all functionality works

**Note:** No database schema changes are made by the multi-worker architecture, so rollback is configuration-only.

## Cost Optimization

### Development/Staging

- **1 API instance** + **1 Worker instance** (minimal cost)
- Set `MAX_CONCURRENT_JOBS=2` on worker
- Total capacity: ~80 renders/hour

### Production

- **2 API instances** (high availability) + **2-3 Worker instances** (based on load)
- Set `MAX_CONCURRENT_JOBS=3` on workers
- Total capacity: ~240-360 renders/hour

### Cost Breakdown

**Railway pricing (approximate):**
- API service: ~$10/month (minimal compute)
- Worker service: ~$20/month per instance (higher compute for FFmpeg)
- PostgreSQL Pro: ~$25/month (100 connections)

**Total monthly cost:**
- Dev: ~$30/month (1 API + 1 Worker)
- Prod: ~$75/month (2 API + 2 Workers)

## References

### Internal Documentation

- `docs/plans/2026-02-05-infra-multi-worker-scaling-plan.md` - Full implementation plan
- `docs/local-dev.md` - Local development setup
- `docs/provider-setup.md` - External API provider configuration
- `src/workflows/runner.js` - Job processing logic
- `src/worker.js` - Worker process entry point

### External Resources

- [Railway Documentation](https://docs.railway.app/)
- [Railway Service Networking](https://docs.railway.app/guides/private-networking)
- [Node.js pg Pool Configuration](https://node-postgres.com/apis/pool)

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-05 | Initial documentation for multi-worker architecture | Claude (Spark) |
