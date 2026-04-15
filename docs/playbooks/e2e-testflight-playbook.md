# Porizo E2E TestFlight Playbook

**Purpose:** a reusable template for pre-release end-to-end validation. Copy `tasks/e2e-testflight-YYYY-MM-DD.md` from this playbook before each release build, walk the phases, produce a green/red signal for ship-readiness.

**First written:** 2026-04-15 after the Launch Flash + Auth hardening release.
**Maintainer:** Ambrose (solo dev). Claude assists as test driver.

---

## 1. Why we E2E

Unit tests and simulator runs catch ~70% of regressions. The other 30% only surface when:

- Real Apple Sign-In hits the real Apple servers (not a simulator mock)
- iOS Keychain persists across app reinstalls with quirks only device-class firmware expresses
- Background tasks actually get suspended (simulator never truly suspends)
- Warm resume ≥10 min hits system memory pressure you can't simulate
- Production APIs return schemas that diverge from dev ones
- StoreKit transactions reconcile against App Store Connect sandbox

TestFlight is the highest-fidelity test short of production. Before every release, we walk this playbook on a physical device with a real Apple ID, real network, real time-based behaviors.

**Non-goal:** this playbook is NOT unit-test replacement. It assumes the unit/integration suite is already green.

---

## 2. Philosophy — five principles

### 2.1 The device is the source of truth
Simulator logs lie about suspension, keychain scope, and audio session negotiation. Physical device behaviour is authoritative.

### 2.2 Server logs beat client logs for multi-launch sessions
Device log capture via `xcodebuildmcp` is **PID-bound**. When the user force-quits and relaunches, a new PID starts — the capture stops following. For Launch-Flash-style tests that exercise many cold launches, **Railway server logs are the durable oracle** because every cold launch still hits `/app/config`, `/tracks`, `/billing/*` and those land server-side regardless of client PID.

### 2.3 Debug config, not Release
Release strips `#if DEBUG` print statements. We need those prints to understand which content path fired, which auth branch ran. Install Debug config for E2E — don't test Release until post-run sanity only.

### 2.4 Reproduce fresh install; don't trust old state
Delete the app before starting. iOS Keychain persists across delete — that's realistic for returning users but blocks true fresh onboarding. For clean onboarding, also revoke "Sign in with Apple" for Porizo in iOS Settings (optional; cruel to the user but honest).

### 2.5 Write findings as you go
The test doc is append-only during the run. Don't wait until the end to record — log the finding, move on. The matrix fills itself.

---

## 3. When to run

| Trigger | Playbook scope |
|---------|---------------|
| Pre-release (any shipped feature touching UI, auth, billing, launch, or workflows) | Full playbook |
| Post-server-deploy with schema or auth changes | Phases 2 + 4 only |
| Hotfix release with narrow blast radius | Phase 3 (for launch flash touch) or Phase 4 only |
| Weekly cadence in a release week | Full playbook |
| Before App Store submission | Full playbook **+** Release config smoke test after Debug passes |

---

## 4. Setup (5 min before starting)

### 4.1 Pre-flight checks
- [ ] Physical iPhone plugged in (or wirelessly paired + developer mode enabled)
- [ ] Device has sound ON (ringer not silenced)
- [ ] Wi-Fi or cellular working
- [ ] Device is signed into an Apple ID matching the one you'll test with
- [ ] Xcode is open (Window → Devices and Simulators recognises the device)

### 4.2 Clean slate
- [ ] Delete PorizoApp from device (long-press → Remove App → Delete App)
- [ ] *(Optional for TRUE fresh auth)* Settings → Apple ID → Sign-In & Security → Sign in with Apple → Porizo → Stop Using

### 4.3 Session defaults via xcodebuildmcp
```ts
session_set_defaults({
  projectPath: "/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj",
  scheme: "PorizoApp",
  configuration: "Debug",   // NOT Release — we need #if DEBUG prints
  deviceId: "<your UDID>",   // list_devices to find it
  bundleId: "porizo.ios.app.PorizoApp",
  platform: "iOS",
})
```

### 4.4 Build, install, start log capture
```ts
build_device({ extraArgs: ["-allowProvisioningUpdates"] })
get_device_app_path()                   // grab the .app path
install_app_device({ appPath: <path> }) // install without launching
start_device_log_cap()                  // launches the app AND starts capture
```
**Don't use `build_run_device` for the first install** — it launches the app before log capture is active, so Phase 1 onboarding prints would be missed.

### 4.5 Parallel: tail Railway logs in a second terminal
```bash
railway logs --service porizo | grep -E "error|statusCode.:5|VALIDATION"
```
Leave this running. You'll pull full logs at the end of each phase.

---

## 5. Phase structure — what and why

Five phases. Each has a distinct intent. Walk them in order unless you're scoping to a hotfix.

### Phase 1 — Onboarding (7 rows)
**Intent:** confirm a brand-new user can make it from first launch through onboarding to the auth handoff without crashing. Covers belief-shift adaptive flow, Mirror view question-graph resolution, demo-song audio playback, and graceful backgrounding mid-flow.

**Failure modes to watch:**
- Continue button enabling before graph resolves (would let user through with blank context)
- Demo audio not playing (bundled sample URL missing, AVAudioSession misconfigured)
- Crash at handoff (MainActor escape, invalid navigation transition)

### Phase 2 — Authentication (6 rows)
**Intent:** confirm the full auth lifecycle — sign in, persist across kill, refresh across 15-min background, sign out, sign in again — works with no 401 loops and no duplicate token rotations.

**Failure modes to watch:**
- Session not persisting across kill (Keychain write lost, refresh token not stored)
- 401 loops (token rotation race condition)
- Re-onboarding triggered on returning sign-in (user-id reconciliation bug)
- `AccountExistsView` appearing unexpectedly (cross-identifier lookup firing when it shouldn't)

### Phase 3 — Launch Flash (21 rows, 7 sub-phases)
**Intent:** validate the TikTok-style launch flash fires correctly for every content path, every trigger condition, every settings mode, every dismissal variant.

**Sub-phases:**
- **3.a** Cold launch — demo path
- **3.b** Suggestion path (N/A if no pending suggestion)
- **3.c** Created-track path (with pre-warm precision test)
- **3.d** Warm resume ≥10 min *(the 10-min wait is unavoidable — build it into your schedule)*
- **3.e** Warm resume <10 min (negative — must NOT fire)
- **3.f** Settings modes — All / Only Mine / Off, long-press disable
- **3.g** Dismissal variants — tap anywhere, VoiceOver auto-dismiss

**Failure modes to watch:**
- No audio on cold launch (pre-warm + lazy fetch both broken)
- Scene-phase tracking wrong (flash fires on <10 min resume, or doesn't fire on ≥10 min)
- Circuit breaker eating legitimate launches
- Long-press disable not persisting
- VoiceOver auto-dismiss missing (accessibility regression)

### Phase 4 — Regressions (4 rows)
**Intent:** smoke test the rest of the app — MySongs playback, share flow, Explore tab, pull-to-refresh — to make sure the release didn't break adjacent features.

### Post-run verification
**Intent:** pull Railway logs, grep for 500s / SQL errors / ffmpeg errors / auth failures. The device log capture missed most of the run (PID-bound), so Railway is the authority.

---

## 6. Reporting protocol (human ↔ Claude)

Claude drives the test plan doc and log analysis. Human is on the device executing steps.

### Reply format for the human
Pick one per phase:
- **`Phase X pass`** — all rows green, move on
- **`Phase X pass except 3.Y skipped`** — one row deferred, rest green
- **`Phase X failed: 3.Y — <what happened>`** — one or more rows broken; describe
- Paste any **`[LaunchFlash]` / `[Auth]` / `[StoreKit]` / red error lines** you see in Xcode Console if something failed

### What Claude does
- Updates `tasks/e2e-testflight-YYYY-MM-DD.md` matrix after each phase report
- Between phases: spot-check Railway logs for new errors
- Investigates any failure before unblocking the next phase
- At end: stops log capture, pulls full server log window, writes results summary

---

## 7. Severity framework

Use this to triage findings without over-thinking:

| Sev | Definition | Example |
|-----|------------|---------|
| **P1** | Blocks ship. Active user harm or data loss. | Auth fails on cold launch, payment sync SQL error, crash on launch |
| **P2** | Degraded UX. Feature works but worse than spec. | Pre-warm miss (audio still plays, just delayed), animated share falls back to still |
| **P3** | Cosmetic or polish. Ship-safe. | Misleading copy, UX surprise but not broken |
| **Deferred** | Valid concern but out of scope for this release. | VoiceOver accessibility pass, edge-case internationalisation |

**Rule:** if unsure between P2 and P1, ask "does this ship?" If yes → P2. If no → P1.

---

## 8. Reusable row template

Copy this into `tasks/e2e-testflight-YYYY-MM-DD.md` at the start of a run. Columns: `#`, `Step`, `Expected`, `Actual`, `Pass`.

```markdown
| # | Step | Expected | Actual | Pass |
|---|------|----------|--------|------|
| 1.1 | Launch app for first time | Splash → Onboarding V2 | | ☐ |
| ... | ... | ... | ... | ... |
```

Then at the bottom:

```markdown
## Results — {date} E2E complete

### Scoreboard
| Phase | Pass | Partial | Skip | N/A | Fail |
|-------|:----:|:-------:|:----:|:---:|:----:|
...

### Findings (by severity)
#### P1 — {fixed or blocker}
#### P2 — follow-up
#### P3 — polish
#### Deferred

### Ship recommendation
{Green-lit / Red-lit / Green with conditions}

### Commits from this session
- `<sha>` — <description>
```

---

## 9. Lessons learned from prior runs

### 2026-04-15 — Launch Flash release (first full E2E)
1. **Device log capture is PID-bound.** First force-quit = capture ends. Always pair device capture with server-log capture for multi-launch runs.
2. **Railway `up` times out on local working trees >~300MB.** Use `git push` for deploys instead; `.gitignore` + `.railwayignore` discipline matters.
3. **`ffmpeg-static` silently drops filters.** `drawtext` missing from the minimal static build. Prefer system ffmpeg from the Dockerfile.
4. **SQLite-vs-Postgres dialect bugs are invisible to the test suite** (tests run on sql.js). `FOR UPDATE` positioning differs. Flag any `${lockSuffix}` interpolation sites in code review.
5. **"Most of the auths worked" ≠ all rows pass.** Don't auto-mark a phase pass when the human's language is fuzzy. Ask.
6. **Pre-warm caches keyed by trackId are fragile.** User plays track A → cache[A] warmed → resolver picks track B → cache miss. If you want reliable pre-warm, warm the candidate track the resolver WILL pick next time, not what the user just played.
7. **`AccountExistsView` copy said "phone linked" but the match could be email.** Generic copy survives either identifier driving the match. Specific copy needs a server-supplied `match_reason`.
8. **Home tab filter surprises users.** Received tracks dominate, created tracks hidden — by design but not intuitive. Two-section layout would remove ambiguity.

### How to add to this section
After each E2E run, append a dated subsection. Keep it to 3–8 concrete lessons per run. Delete any lesson that becomes stale or fixed.

---

## 10. Common commands reference

### Device log capture
```ts
start_device_log_cap()             // launches app, begins capture
stop_device_log_cap({ logSessionId: "..." })
```

### Build + install without launching
```ts
build_device({ extraArgs: ["-allowProvisioningUpdates"] })
install_app_device({ appPath: "<from get_device_app_path>" })
```

### Build + install + launch
```ts
build_run_device({ extraArgs: ["-allowProvisioningUpdates"] })
```

### Railway
```bash
railway logs --service porizo | tail -100
railway logs --service porizo | grep "statusCode.:5"   # 500s
railway ssh --service porizo "ffmpeg -version"         # inspect container
```

### Git + deploy
```bash
git push origin <branch>       # auto-deploys via Railway GitHub integration
```

### Check ffmpeg feature on Railway
```bash
railway ssh --service porizo "ffmpeg -hide_banner -filters | grep <filter_name>"
```

---

## 11. Anti-patterns to avoid

- **Don't test Release config first.** Without `#if DEBUG` prints, you can't tell which code path ran when things fail.
- **Don't skip the 10-min warm-resume wait.** It's the only way to validate scene-phase tracking end-to-end. Do other work while you wait.
- **Don't mark a phase pass based on Claude's inference.** If the human said "most worked" — ASK which rows specifically passed.
- **Don't run `railway up` on a 9GB working tree.** Use `git push`. If `railway up` is necessary, check `.railwayignore` first.
- **Don't assume keychain clears on app delete.** It doesn't. For truly fresh auth, also revoke Sign in with Apple.
- **Don't spawn new device log capture sessions for each sub-phase.** Leave one running for the whole phase; only stop at the end to read.

---

## 12. Emergency triage — what to do if something fails

1. **Stop the E2E run at the failing row.** Don't continue — context helps diagnosis.
2. **Stop the device log capture** and read the last 100 lines. Grep for `error`, `Failed`, the relevant subsystem (`[Auth]`, `[LaunchFlash]`, etc.).
3. **Pull Railway logs** for the same time window. Grep for 500s, stacks, specific endpoint names.
4. **Decide severity**:
   - P1 → halt E2E, fix + deploy + rebuild + resume from the failing row
   - P2 → log finding, continue E2E, ticket for after
   - P3 → note observation, continue
5. **Never force a green.** If a row doesn't pass, it doesn't pass. The playbook is the record — honest-or-bust.

---

*Last updated: 2026-04-15 — first full E2E written up retrospectively.*
