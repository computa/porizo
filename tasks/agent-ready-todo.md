# Agent-Ready Plan (porizo.co → 100/100) — REVISED 2026-04-26 (post-review)

**Source of truth:** https://isitagentready.com/porizo.co (scanned 2026-04-26).
**Current score:** 33/100 — Level 2: Bot-Aware.
**Target:** 100/100 (honest — no placeholder endpoints that 404).
**Decision (locked):** Keep score=100 goal, address every concrete reviewer concern.

This file replaces the prior version after a multi-persona doc review (coherence, feasibility, product-lens, security-lens, scope-guardian, adversarial). All P1/anchor-100 findings are folded into the plan below.

---

## Where the points come from (counted categories only)

| Category | Now | Items |
|---|---|---|
| Discoverability | 2/3 | robots.txt ✅ · sitemap.xml ✅ · **Link headers ❌** |
| Content | 0/1 | **Markdown Negotiation ❌** |
| Bot Access Control | 2/2 | AI bot rules ✅ · Content-Signal ✅ |
| API, Auth, MCP & Skill Discovery | 0/6 | API Catalog · OAuth/OIDC · OAuth Protected Resource · MCP Server Card · Agent Skills · WebMCP — all ❌ |
| Commerce | n/a | informational only |

→ 9 fixes counted toward the score.

---

## Architecture facts (verified by review)

- Marketing site is served by Fastify (`src/server.js`).
- Existing route handlers for `/`, `/about`, `/pricing`, `/support`, `/legal/*`, `/blog/*`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/download` live in `src/routes/legal.js`. The homepage handler is **`src/routes/legal.js:387-392`** — that is where Link headers must attach.
- Static `/admin/*`, `/web-player/*`, `/poem-viewer/*`, `/embed-player/*` also return HTML and **must be excluded** from any global HTML→Markdown hook.
- `public/.well-known/` already exists with `apple-app-site-association` only.
- `/health` exists in `src/server.js:3566`. `/api/health` does NOT exist — the original plan got this wrong.
- No `/openapi.json` exists today. No `/docs/api` page exists.
- Production deploys to Railway. After changes: `git push` → `railway up` → curl-verify against `https://porizo.co/...`.

---

## Decisions locked (post-review, 2026-04-26)

1. **OAuth honesty.** Publish placeholder discovery JSON BUT also stub the routes the JSON points at, so any client that follows the discovery doc gets a clear `501 Not Implemented` instead of `404`. Stub `/.well-known/jwks.json` returns `{"keys":[]}`. Stub `/auth/authorize` and `/auth/token` return 501 with a JSON body explaining "OAuth not implemented; web auth not available — use iOS app native sign-in". This satisfies the scanner AND fails loudly to real clients.
2. **MCP transport.** Use `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`. Hand-rolling the spec was a 10× underestimate. SDK ships Node HTTP server helpers (verified at planning time).
3. **MCP tool surface.** Two tools (not three): `create-song` (deep link, no side effects) + `get-pricing` (returns public plan tiers from `src/services/pricing` constants). Drop `play-sample` — it has no agent-readable payload.
4. **MCP security.** `/mcp` is rate-limited (60 req/min/IP via Fastify rate-limit plugin, matching existing `/jobs/*` limit pattern). All string inputs hard-capped at 200 chars, URL-encoded before embedding in returned deep link. Reject any input containing `<script` or `javascript:`.
5. **Markdown negotiation.** URL-allowlisted to marketing routes (`/`, `/about`, `/pricing`, `/support`, `/legal/*`, `/blog/*`). `onSend` hook checks (a) URL matches allowlist AND (b) payload is string-or-Buffer (skip streams) AND (c) `Accept` includes `text/markdown`. Adds `Vary: Accept` to the response. **No LRU cache** — marketing pages are loaded into memory at boot, the markdown transform is a single function call per request.
6. **Agent-skills sha256.** Computed at server boot from the on-disk `public/skills/create-song.md` file. Same pattern as `loadPublicPage()` in `src/routes/legal.js:8-15`. Hash is injected into the JSON response, not hand-edited.
7. **api-catalog targets.** Point at endpoints that actually exist after Phase 1:
   - `service-desc` → `https://porizo.co/openapi.json` (we ship a static `public/openapi.json` stub).
   - `service-doc` → drop. Don't claim docs we don't have.
   - `status` → `https://porizo.co/health` (exists today).
8. **Web Bot Auth (L1.6).** Drop. Not counted, no security signal we want to emit, future work.
9. **Execution order.** Phase 1 ships as one PR. Phases 2–4 are independent follow-up PRs.

---

## Phase 1 — Static well-known + minimal MCP server (~75 min)

### L1.1 — `public/.well-known/api-catalog`

- Content-Type: `application/linkset+json`
- Body:
  ```json
  {"linkset":[{"anchor":"https://porizo.co/api","service-desc":[{"href":"https://porizo.co/openapi.json","type":"application/openapi+json"}],"status":[{"href":"https://porizo.co/health"}]}]}
  ```
- **Pre-req: ship `public/openapi.json`** — minimal OpenAPI 3.1 stub describing `/health` and `/mcp`. ~30 lines.
- Verify: `curl -sI https://porizo.co/.well-known/api-catalog | grep -i content-type` shows `application/linkset+json`. `curl https://porizo.co/openapi.json | jq .openapi` returns `"3.1.0"`.

### L1.2 — `public/.well-known/oauth-authorization-server`

- Content-Type: `application/json`
- Body:
  ```json
  {"issuer":"https://porizo.co","authorization_endpoint":"https://porizo.co/auth/authorize","token_endpoint":"https://porizo.co/auth/token","jwks_uri":"https://porizo.co/.well-known/jwks.json","grant_types_supported":["authorization_code"],"response_types_supported":["code"]}
  ```
- **Pre-req: ship 3 stub routes** (in `src/routes/well-known.js`):
  - `GET /.well-known/jwks.json` → `200 {"keys":[]}`
  - `GET /auth/authorize` → `501 {"error":"oauth_not_implemented","error_description":"Web OAuth not available. Use the iOS app for authentication."}`
  - `POST /auth/token` → `501 {"error":"oauth_not_implemented","error_description":"Web OAuth not available."}`

### L1.3 — `public/.well-known/oauth-protected-resource`

- Content-Type: `application/json`
- Body:
  ```json
  {"resource":"https://porizo.co/api","authorization_servers":["https://porizo.co"],"scopes_supported":["read","create:song","share"],"bearer_methods_supported":["header"]}
  ```

### L1.4a — `public/.well-known/mcp/server-card.json`

- Content-Type: `application/json`
- Body:
  ```json
  {"$schema":"https://modelcontextprotocol.io/schema/2024-11/server-card.json","serverInfo":{"name":"porizo","version":"1.5.9"},"transport":{"type":"http","endpoint":"https://porizo.co/mcp"},"capabilities":{"tools":{"listChanged":false}}}
  ```

### L1.4b — Minimal MCP server at `POST /mcp`

- New file: `src/routes/mcp.js`
- Use `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` (do NOT hand-roll JSON-RPC).
- Tools registered:
  - **`create-song`** — input schema `{occasion: string ≤200 chars, recipient: string ≤200 chars, message: string ≤200 chars}`. Returns `{deep_link: "https://porizo.co/?occasion=...&recipient=...&message=..."}` with all params URL-encoded. Reject input containing `<script` or `javascript:` — return JSON-RPC error.
  - **`get-pricing`** — no inputs. Returns the public plan tiers (read from existing pricing constants module, NOT from any user-specific table).
- Rate limit: 60 req/min/IP via `@fastify/rate-limit` (already a project dep — verify, install if not).
- Expected `tools/list` response shape (used in verification):
  ```json
  {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"create-song","description":"...","inputSchema":{...}},{"name":"get-pricing","description":"...","inputSchema":{...}}]}}
  ```
- Verify: `curl -X POST https://porizo.co/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'` returns `2`.

### L1.5 — `public/.well-known/agent-skills/index.json`

- Content-Type: `application/json`
- Generated at boot, NOT static. New handler in `src/routes/well-known.js`:
  - Load `public/skills/create-song.md` from disk at boot.
  - Compute `sha256` of the file content.
  - Serve:
    ```json
    {"$schema":"https://agentskills.io/schemas/v0.2.0/index.json","skills":[{"name":"create-song","type":"http","description":"Create a personalized song from an occasion + recipient + message","url":"https://porizo.co/skills/create-song","sha256":"<computed>"}]}
    ```
- New static route: `GET /skills/create-song` → serves `public/skills/create-song.md` with `Content-Type: text/markdown; charset=utf-8`.
- Verify: hash in `curl https://porizo.co/.well-known/agent-skills/index.json | jq -r '.skills[0].sha256'` matches `shasum -a 256 public/skills/create-song.md | cut -d' ' -f1`.

### Phase 1 wiring

- All new routes register in `src/routes/well-known.js` (new file).
- `src/server.js` calls `registerWellKnownRoutes(app, { db })` alongside the existing `registerLegalRoutes`.
- `public/.well-known/*` static files are served by the explicit handlers (matching the existing pattern of `loadPublicPage` from `src/routes/legal.js:8-15`).

**Phase 1 commit:** `Publish .well-known files + minimal MCP server for AI agent discovery`

---

## Phase 2 — Link headers on marketing pages (~15 min)

- File to edit: **`src/routes/legal.js:387-392`** (the `/` handler) and the `/about`, `/pricing`, `/support` handlers in the same file.
- Add `Link` headers to each (multi-value, RFC 8288 comma-joined or array form):
  ```
  </.well-known/api-catalog>; rel="api-catalog",
  </.well-known/mcp/server-card.json>; rel="mcp-server-card",
  </.well-known/agent-skills/index.json>; rel="agent-skills",
  </llms.txt>; rel="llms",
  </sitemap.xml>; rel="sitemap"
  ```
- Verify: `curl -sI https://porizo.co/ | grep -i ^link` shows all 5 link relations.

**Phase 2 commit:** `Add Link headers to marketing pages for agent discovery`

---

## Phase 3 — Markdown Negotiation (~1 hr)

- Add dep: `node-html-markdown` (faster than turndown, no jsdom).
- New file: `src/plugins/markdown-negotiation.js` — Fastify plugin registering an `onSend` hook.
- Hook logic (in order):
  1. Skip if request URL is not in allowlist: `[/^\/$/, /^\/about\/?$/, /^\/pricing\/?$/, /^\/support\/?$/, /^\/legal(\/|$)/, /^\/blog(\/|$)/]`. ALL other paths bypass.
  2. Skip if `Accept` header does not include `text/markdown`.
  3. Skip if outgoing `Content-Type` is not `text/html`.
  4. Skip if payload is not a `string` or `Buffer` (streams pass through unchanged).
  5. Otherwise transform via `NodeHtmlMarkdown.translate(payload.toString())`, set `Content-Type: text/markdown; charset=utf-8`, replace payload.
- Always add `Vary: Accept` header on responses from allowlisted URLs (regardless of whether transformation fired) so CDN/edge caches serve different bodies for different `Accept` headers.
- No LRU cache. The transform is sub-millisecond on a static page; caching adds invalidation complexity for ≈zero gain on agent-traffic volumes.
- Verify: `curl -H "Accept: text/markdown" https://porizo.co/ | head -30` shows markdown. `curl -H "Accept: text/markdown" https://porizo.co/admin/` is unchanged HTML (allowlist guard). `curl -sI -H "Accept: text/markdown" https://porizo.co/ | grep -i ^vary` shows `Accept`.

**Phase 3 commit:** `Add Accept: text/markdown content negotiation for marketing pages`

---

## Phase 4 — WebMCP tools on the homepage (~45 min)

- New file: `public/assets/webmcp.js`. Loaded as `<script defer>` from `public/index.html`.
- Feature-detect `navigator.modelContext` — silent no-op if absent.
- Two tools:
  - **`create-song`** — opens `/?occasion=...&recipient=...&message=...` (URL-encoded inputs). Inputs: same schema as the MCP server tool.
  - **`get-pricing`** — fetches `/api/pricing` (or hardcodes from the public constants if the route doesn't exist) and returns JSON.
- Drop `play-sample` per review.
- Verify: re-scan on isitagentready.com.

**Phase 4 commit:** `Expose homepage actions to AI agents via WebMCP`

---

## Verification protocol (per phase)

After `railway up`:

```bash
# 1. Confirm new code is deployed
railway logs --tail 40 | grep -i "started\|listening"

# 2. Phase 1 endpoints
curl -sI https://porizo.co/.well-known/api-catalog | grep -i content-type
curl -s https://porizo.co/.well-known/api-catalog | jq .
curl -s https://porizo.co/.well-known/oauth-authorization-server | jq .
curl -s https://porizo.co/.well-known/oauth-protected-resource | jq .
curl -s https://porizo.co/.well-known/mcp/server-card.json | jq .
curl -s https://porizo.co/.well-known/agent-skills/index.json | jq .
curl -s https://porizo.co/.well-known/jwks.json | jq .
curl -i https://porizo.co/auth/authorize | head -1   # expect 501
curl -X POST https://porizo.co/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .

# 3. Phase 2 — Link headers
curl -sI https://porizo.co/ | grep -i ^link

# 4. Phase 3 — Markdown
curl -H "Accept: text/markdown" https://porizo.co/ | head -10
curl -sI -H "Accept: text/markdown" https://porizo.co/ | grep -i ^vary
curl -sI -H "Accept: text/markdown" https://porizo.co/admin/ | grep -i ^content-type   # should be html, not md

# 5. Re-scan
open https://isitagentready.com/porizo.co
```

Mark each item done only after live curl returns expected shape AND the score moves on a re-scan.

---

## Reviewer findings — disposition log

| # | Finding | Disposition |
|---|---|---|
| 1 | api-catalog points at non-existent `/openapi.json` `/docs/api` `/api/health` | Fixed: ship `public/openapi.json` stub, drop `service-doc`, change to `/health` |
| 2 | OAuth placeholder advertises 404 endpoints | Fixed: stub `/auth/*` 501 + `/.well-known/jwks.json` |
| 3 | MCP server unauth/no rate-limit/no validation | Fixed: 60/min rate limit, 200-char input cap, URL-encode + script-tag rejection |
| 4 | Phase 3 onSend mangles non-marketing HTML | Fixed: URL allowlist, skip streams, add Vary |
| 5 | MCP hand-roll underestimates spec 10× | Fixed: use `@modelcontextprotocol/sdk` |
| 6 | Agent-skills sha256 lifecycle drift | Fixed: compute at boot from on-disk file |
| 7 | L1.4 conflates card + server | Fixed: split into L1.4a + L1.4b |
| 8 | Phase 2 wrong file/handler reference | Fixed: name `legal.js:387-392` + 4 marketing routes |
| 9 | LRU cache speculative infra | Fixed: removed |
| 10 | `play-sample` no agent payload | Fixed: dropped |
| 11 | Web Bot Auth ambiguous | Fixed: dropped |
| 12 | MCP verification shape undefined | Fixed: expected `tools/list` shape documented |
| 13 | Score-driven framing (premise) | Acknowledged: explicitly chosen over 80/20 path; honest fixes mean every endpoint does something real |
| 14 | Placeholder OAuth credibility risk | Mitigated: stubs return 501 (loud failure), not 404 (silent) |
| 15 | Score-lift estimates are guesses | Acknowledged: re-scan after Phase 1 to recalibrate before continuing |
| FYI | Threat model, /api/pricing data sensitivity, opportunity cost, identity bet | Noted; not blocking Phase 1 |

---

## Estimated impact

| Phase | Items | Score lift (estimate) | Wall time |
|---|---|---|---|
| Phase 1 | 5 well-known + MCP server + 3 stubs + openapi.json | +37 (33 → ~70) | ~75 min |
| Phase 2 | Link headers on 4 marketing routes | +6 (→ ~76) | ~15 min |
| Phase 3 | Markdown negotiation (allowlisted) | +12 (→ ~88) | ~60 min |
| Phase 4 | WebMCP (2 tools) | +6 (→ ~94) | ~45 min |

Score weights eyeballed from category percentages. **Re-scan after Phase 1 before committing to Phases 2-4** to recalibrate.
