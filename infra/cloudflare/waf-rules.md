# Cloudflare WAF Configuration — porizo.co

**Last applied:** 2026-05-19 (ruleset version 4)
**Owner:** Ambrose
**Source of truth:** Cloudflare API (this doc reflects it; the dashboard is read-only for ops)

## Goal

Three concurrent posture goals on the `porizo.co` zone:

1. **Allow all social preview crawlers** — Facebook, Twitter/X, LinkedIn, Slack, Discord, Telegram, WhatsApp, Pinterest, Reddit, iMessage, etc. — to scrape share URLs and render rich Open Graph cards.
2. **Allow LLM citation bots** — ChatGPT-User, Claude-User, Perplexity-User, OAI-SearchBot, etc. — so when users ask an assistant about Porizo or a specific share, the bot can fetch and cite content.
3. **Block AI training crawlers** — GPTBot, ClaudeBot, Bytespider, Amazonbot, CCBot, Meta-ExternalAgent, FacebookBot (Meta's training bot, NOT the previewer), Google-CloudVertexBot, Diffbot, etc. — so Porizo content isn't ingested for model training.

## Architecture (2 rules, evaluated in order)

The WAF entrypoint ruleset for the `http_request_firewall_custom` phase contains two rules. Both live in:

```
GET /zones/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint
```

**Ruleset ID:** `0e3f22c4128c4d36a19f5bd61fb62c12`
**Zone ID:** `6323f5638ac78568cb9b0301f7d00509` (porizo.co, Free plan)
**Account ID:** `edf870e7d2eb87095b3e2b83b7a78c27` (Acuoos)

### Rule #1 — Allowlist (action: `skip`)

Bypass Cloudflare bot-class protections for verified previewers, LLM citation bots, and search engine crawlers.

- **Action parameters:**
  - `ruleset: "current"` — skip remaining rules in this ruleset (matters because rule #2 is the training block; this rule comes first so allowlisted UAs can never be caught by it).
  - `phases: [http_ratelimit, http_request_sbfm, http_request_firewall_managed]` — skip rate limiting, Super Bot Fight Mode, and the Cloudflare Managed Free Ruleset.
  - `products: [bic, hot, rateLimit, securityLevel, uaBlock, waf, zoneLockdown]` — explicit list of WAF products to bypass.
- **Why this is in rule #1 (higher priority):** an allowlisted UA that is _also_ present in rule #2's expression (which can happen if e.g. you ever add a UA that overlaps) must not be blocked. Skip-first guarantees that.

UAs covered (33 global + 1 path-scoped total, case-insensitive substring match on `lower(http.user_agent)`):

| Group                | UAs                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Meta family          | `facebookexternalhit`, `facebookcatalog`, `facebot`, `meta-externalfetcher`              |
| Twitter/X            | `twitterbot`                                                                             |
| LinkedIn             | `linkedinbot`                                                                            |
| Messengers           | `slackbot`, `discordbot`, `telegrambot`, `whatsapp`, `skypeuripreview`, `line/`, `viber` |
| Apple                | `applebot`                                                                               |
| Social platforms     | `pinterest`, `pinterestbot`, `redditbot`, `tiktokspider`                                 |
| LLM user-triggered   | `chatgpt-user`, `claude-user`, `perplexity-user`, `duckassistbot`                        |
| LLM search/citations | `oai-searchbot`, `claude-searchbot`, `perplexitybot`                                     |
| Search engines       | `googlebot`, `bingbot`, `duckduckbot`, `yandexbot`, `baiduspider`                        |
| Preview aggregators  | `iframely`, `embedly`, `kagibot`                                                         |

`meta-externalagent` is intentionally **not** globally allowlisted because Cloudflare and Meta classify it as an AI crawler. It is path-scoped through the skip rule only for public preview/player assets on `api.porizo.co`:

- `/play/*`
- `/share/*`
- `/oembed`
- `/tracks/*`
- `/web-player/*`
- `/robots.txt`

This keeps Facebook/Meta unfurling functional without opening the whole site to Meta's training crawler.

### Rule #2 — Blocklist (action: `block`)

Block known AI training crawlers. Returns Cloudflare's default 403 page (custom response bodies require Pro+ plan, not used here).

UAs covered (14 total — Cloudflare's "AI Crawler" verified-bot category + well-known commercial scrapers):

| Operator                       | UA                                  |
| ------------------------------ | ----------------------------------- |
| OpenAI                         | `gptbot`                            |
| Anthropic                      | `claudebot`                         |
| ByteDance                      | `bytespider`                        |
| Amazon                         | `amazonbot`                         |
| Common Crawl                   | `ccbot`                             |
| Meta (training, not previewer) | `meta-externalagent`, `facebookbot` |
| Google (Vertex AI)             | `google-cloudvertexbot`             |
| Diffbot                        | `diffbot`                           |
| Omgili                         | `omgilibot`                         |
| Huawei Petal                   | `petalbot`                          |
| Imagesift                      | `imagesiftbot`                      |
| AI2                            | `ai2bot`                            |
| Cohere                         | `cohere-ai`                         |

**Note on substring match safety:** `lower(...) contains "facebookbot"` does NOT match `facebookexternalhit` (the previewer) because `facebookbot` is not a substring of `facebookexternalhit`. Verified at deploy time. `meta-externalagent` is still in the block rule; the path-scoped skip rule above must remain before this block rule.

## Token & access

**Long-lived API token** stored at `~/.cloudflare/porizo-waf-mcp.token` (mode 0600). Scopes:

| Type | Group         | Action |
| ---- | ------------- | ------ |
| Zone | Zone WAF      | Edit   |
| Zone | Zone          | Read   |
| Zone | Analytics     | Read   |
| Zone | Zone Settings | Read   |

**Zone resource:** scoped to `porizo.co` only — token can't touch paideio.com or sessionfill.com.

**Why a long-lived token, not the OAuth-based MCP:** Cloudflare's MCP OAuth tokens are short-lived and don't auto-refresh in Claude Code's MCP runtime; they expire between sessions and require re-authorization, which is the opposite of robust. The PAT is stored once, used everywhere.

**To revoke:** Cloudflare dashboard → Profile → API Tokens → `porizo-waf-mcp` → `…` → Delete. The WAF rules persist; only the credential dies.

## How to extend (add a new UA)

When a new social preview / citation bot appears (e.g., new Threads previewer, new LLM search engine):

```bash
# 1. Verify the new UA actually scrapes by checking firewall events for unusual patterns:
TOKEN=$(cat ~/.cloudflare/porizo-waf-mcp.token)
node -e '
const since = new Date(Date.now() - 24*60*60*1000).toISOString();
fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { "Authorization": `Bearer '"$TOKEN"'`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `query {
    viewer { zones(filter: { zoneTag: "6323f5638ac78568cb9b0301f7d00509" }) {
      firewallEventsAdaptiveGroups(
        filter: { datetime_geq: "'"$(date -u -v-1d +%FT%TZ)"'" }
        limit: 50
        orderBy: [count_DESC]
      ) { count dimensions { userAgent action source } }
    }}
  }` })
}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)));
'

# 2. Add the new UA token to the appropriate list (allow or block) in this file.
# 3. Re-run the PUT — see "Reapply" section below.
```

## Reapply the rules from scratch

If the WAF state diverges from this doc (e.g., dashboard edit, accidental deletion), reapply via a Node one-liner. The full PUT body is below — `node` reads the token from disk, builds the body, and calls the API.

See `infra/cloudflare/apply-waf-rules.mjs` (TODO if/when this needs to live as an automation script). For ad-hoc reapply, the inline script that originally deployed version 3 is reproducible from the contents of this file.

## Monitoring & verification

### Check that the rules are deployed

```bash
TOKEN=$(cat ~/.cloudflare/porizo-waf-mcp.token)
curl -s "https://api.cloudflare.com/client/v4/zones/6323f5638ac78568cb9b0301f7d00509/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.result.rules[] | {id, action, description, enabled}'
```

### Check that real social bots are getting through

Query `firewallEventsAdaptive` for FB-ASN traffic in the last hour. Should show `action=skip status=200`:

```bash
curl -s "https://api.cloudflare.com/client/v4/graphql" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { viewer { zones(filter: {zoneTag: \"6323f5638ac78568cb9b0301f7d00509\"}) { firewallEventsAdaptive(filter: {datetime_geq: \"'$(date -u -v-1H +%FT%TZ)'\", clientASNDescription: \"Facebook, Inc.\"}, limit: 10, orderBy: [datetime_DESC]) { datetime action edgeResponseStatus clientRequestPath userAgent } } } }"
  }' | jq '.data.viewer.zones[0].firewallEventsAdaptive'
```

### Check that training crawlers are blocked

Probe directly with `curl` — should return 403 from Cloudflare:

```bash
curl -sI -A "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" \
  https://api.porizo.co/play/ANY_VALID_SHARE_ID | head -1
# HTTP/2 403
```

## Facebook Sharing Debugger caveat

The FB Sharing Debugger caches scrape results **per URL for ~30 days**. URLs first scraped _before_ this WAF was deployed (i.e., before 2026-05-19) may show a stale `403` even after Cloudflare has been letting Meta's scraper through cleanly. The Debugger's "Scrape Again" button often only re-renders the cached error instead of forcing a fresh origin fetch.

Cloudflare Managed robots.txt may also inject:

```txt
User-agent: meta-externalagent
Disallow: /
```

That setting lives behind Cloudflare Bot Management / AI Crawl controls, not the custom WAF entrypoint. If Facebook's debugger still reports a robots-related warning after the WAF shows `action=skip status=200`, disable Cloudflare's managed robots.txt / AI Crawl Control robots publishing in the Cloudflare dashboard, or use a token/auth scheme with Bot Management write access to set `is_robots_txt_managed=false`.

**To verify the _current_ state:** check `firewallEventsAdaptive` (above) for actual Facebook-ASN events on the URL. If there are recent `action=skip status=200` events, Cloudflare is letting FB through and the Debugger UI is lying.

**To force FB to re-scrape an existing URL:**

1. **Easiest — query-string mutation:** append `?v=2` (or any unused query param) when re-sharing. FB treats this as a new URL and scrapes fresh.
2. **Graph API scrape POST** (requires the Porizo FB app's access token):
   ```bash
   curl -X POST \
     "https://graph.facebook.com/v18.0/?id=https%3A%2F%2Fapi.porizo.co%2Fplay%2FRrm8PRM3tlwV&scrape=true&access_token=$FB_APP_TOKEN"
   ```
3. **Wait it out:** ~30 days, the cache expires naturally.

## Why this is robust (and not patch work)

1. **Two-rule design rooted in intent, not maintenance lists** — rule #1 enumerates "who is allowed to read our public shares (previewers, LLMs, search engines)"; rule #2 enumerates "who must be blocked from training on us". Adding a new previewer is a 1-line edit, _not_ a refactor.
2. **Skip-first ordering** — guarantees that any UA that overlaps both lists wins as "allowed", preventing accidental self-block.
3. **Path-agnostic** — works for `/play/*`, `/share/*`, `/poem/*`, `/s/*`, `/tracks/*/artwork.jpg`, `/web-player/player.js`, `/embed/*` — any current or future public-share path. No path list to maintain.
4. **Free-plan-compatible** — uses 2 of the 5 allowed custom rules. Headroom for 3 more (e.g., add a country block, an admin allowlist, etc.) without exceeding the cap.
5. **Programmatically managed** — token-based, persisted credential. No OAuth dance per session. Future automation (cron-based monitoring, alerts on unusual block rates) can reuse the same token.
6. **Observable** — every match emits a firewall event with `ruleId` and `source=firewallCustom`, queryable via GraphQL. No "what fired?" mystery.

## Known limitations

- **DDoS L7 phase runs before custom rules.** If Cloudflare's managed DDoS protection ever decides a Facebook/Twitter scraper looks suspicious, our skip rule cannot bypass it. Mitigation: monitor firewall events for unexpected blocks; if a pattern emerges, file a Cloudflare support ticket (verified-bot allowlist on Pro+ would resolve it permanently).
- **Search Engine Optimization tools (Ahrefs, Semrush, etc.) are NOT in the allowlist** — by design. Add their UAs if SEO tracking matters.
- **Free plan can't customize block responses.** Training bots see Cloudflare's default branded 403 page, not a custom "licensing info" message.

## Change log

| Date       | Version | Change                                                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 2026-05-19 | v4      | Added path-scoped `meta-externalagent` skip for public share/player routes while keeping global block   |
| 2026-05-19 | v3      | Expanded skip rule to 33 UAs (added iframely, embedly, kagibot, line/, viber, search engines explicit) |
| 2026-05-19 | v2      | Added skip rule for social previewers + LLM citation bots                                              |
| 2026-05-19 | v1      | Created entrypoint ruleset with single AI-training block rule                                          |
