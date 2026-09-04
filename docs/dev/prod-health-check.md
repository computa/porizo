# Porizo Production Health Check (runbook)

One composed pass answering "is production okay / why is there no activity." Verified working 2026-07-05 (found: backend healthy, both ad channels dead → signup cliff).

## 0. Auth (see also `~/.claude/rules/railway-auth.md`)

```bash
source ~/.config/railway-profiles.zsh; rw-use abcobimma
# prints "✓ Railway active: abcobimma (projects: propcharter,amiable-blessing)" when the token is valid
```

## 1. Live API (no Railway token needed)

```bash
curl -sS https://api.porizo.co/health          # rich JSON; NOTE: does NOT check the DB
# DB read-path proof (safe, mutation-free — forces a users-table lookup):
curl -sS -X POST https://api.porizo.co/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"diagnostic-nonexistent@porizo.test","password":"x"}'
# expect 401 INVALID_CREDENTIALS = DB queried OK; a 500/timeout = real DB problem
```

## 2. DB activity (all `created_at` columns are ISO-8601 TEXT — cast to compare)

```bash
printf '%s\n' "SELECT 'users' t, count(*) total,
  count(*) FILTER (WHERE created_at::timestamptz > now()-interval '7 days') d7,
  max(created_at) latest FROM users
UNION ALL SELECT 'tracks', count(*), count(*) FILTER (WHERE created_at::timestamptz > now()-interval '7 days'), max(created_at) FROM tracks
UNION ALL SELECT 'jobs',   count(*), count(*) FILTER (WHERE created_at::timestamptz > now()-interval '7 days'), max(created_at) FROM jobs;" \
| railway connect postgres
```

Daily signup trend: `SELECT substr(created_at,1,10) day, count(*) FROM users WHERE created_at::timestamptz > now()-interval '21 days' GROUP BY 1 ORDER BY 1;`
Baseline (June 2026): ~1–3 signups/day. Recent `tracks`/`jobs` rows may be OUR OWN test renders — check before calling them organic.

## 3. Logs

```bash
railway logs 2>&1 | grep -icE 'error|fatal|unhandled|econnrefused'   # error scan
railway logs 2>&1 | tail -10                                          # are requests arriving at all
```

## 4. Acquisition (the usual real culprit when DB is quiet but API is healthy)

```bash
node - <<'JS'   # ASA 30-day spend, from repo root (env keys PORIZO_ASA_* in .env)
import('./scripts/aso/spend-pull.mjs').then(async ({pullDailySpend}) => {
  const fs = await import('node:fs/promises');
  for (const l of (await fs.readFile('.env','utf8')).split('\n')) {
    const m = l.match(/^(PORIZO_ASA_[A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
  const r = await pullDailySpend({days:30});
  const byDay = {}; r.campaigns.forEach(c => byDay[c.date]=(byDay[c.date]||0)+c.spend);
  Object.keys(byDay).sort().forEach(d => console.log(d, '$'+byDay[d].toFixed(2)));
});
JS
```

Meta: `meta` CLI from `~/meta-ads/` (never-expiring token in `.env` there).

## Interpretation

| Signal                                          | Meaning                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| health 200 + login 401 + 0 log errors + flat DB | **Demand problem, not outage** — check §4                                                                      |
| login 500/timeout                               | DB down — check `railway logs` for boot crash; remember public-proxy ≠ private-network (lessons.md 2026-07-02) |
| requests arriving, signups flat, ads at $0      | Acquisition starved — fix budgets/campaigns, not code                                                          |

## Related

- Specific user/feature forensics (not aggregate health): trace `audit_logs` + `share_access_log` + Railway logs by user_id/track_id/time-window.
- 2026-07-05 cliff case study: last organic signup 06-28; Meta paused + ASA spent $0.00 from 06-30 (~$7.44 total/30d).

---

# Prod Trace (specific user / track / feature — forensics, not aggregate health)

When asked to "trace this user", "check if feature X made it to prod", or "investigate suspicious activity":

```bash
# Timeline for a user (audit trail is the spine)
printf '%s\n' "SELECT substr(created_at,1,19) t, action, resource_type, resource_id
  FROM audit_logs WHERE user_id='user_XXX' ORDER BY created_at DESC LIMIT 50;" | railway connect postgres

# A track's full story: versions, jobs, shares, access
printf '%s\n' "SELECT 'version' k, id, status, substr(created_at,1,19) FROM track_versions WHERE track_id='trk_XXX'
UNION ALL SELECT 'job', id, status||' '||step, substr(created_at,1,19) FROM jobs
  WHERE track_version_id IN (SELECT id FROM track_versions WHERE track_id='trk_XXX')
UNION ALL SELECT 'share', id, status, substr(created_at,1,19) FROM share_tokens WHERE track_id='trk_XXX';" | railway connect postgres

# Share-link claim behavior (viral-loop debugging)
printf '%s\n' "SELECT event_type, count(*), max(created_at) FROM share_access_log
  WHERE share_token_id='sht_XXX' GROUP BY 1;" | railway connect postgres

# Correlate with request logs by time window
railway logs 2>&1 | grep -E '<user_id or track_id or route>' | tail -40
```

Rules of engagement:
- Feature-rollout verification = find rows created AFTER the deploy time and check they carry the new behavior (e.g. binding attempted, web-play blocked) — never infer from code alone (`verify-production-claims` rule).
- Distinguish OUR test traffic from organic before drawing conclusions (our renders often follow deploys within minutes).
