# Simulator Testing — Launch Args & Fixtures (Tier 1)

Test the app on the iOS simulator **with no login and no backend**, by launching with fixture flags. DEBUG builds only.

## ⚠️ Critical: how to pass launch args

`launch_app_sim` (XcodeBuildMCP) **silently drops `args`** — they never reach
`ProcessInfo.processInfo.arguments`. Use **`xcrun simctl`** instead, which
delivers argv correctly:

```bash
UDID=<booted-sim-udid>   # from: xcrun simctl list devices | grep Booted
xcrun simctl terminate "$UDID" porizo.ios.app.PorizoApp 2>/dev/null
xcrun simctl launch "$UDID" porizo.ios.app.PorizoApp --bypass-auth --mock-payperson --fixture-paywall
```

Then drive the UI with XcodeBuildMCP (`snapshot_ui` → `tap` by elementRef → `screenshot`).
Build/install first via `build_sim` + `install_app_sim` (or `build_run_sim`, which installs but launches without args — relaunch via simctl).

## Launch flags

| Flag                                                                 | Effect                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bypass-auth`                                                      | Skip onboarding + auth, land straight on the Home tab (`RootView`). Also works via env `PORIZO_BYPASS_AUTH=1`.                                          |
| `--reset-onboarding`                                                 | Clear onboarding UserDefaults for a clean run.                                                                                                          |
| `--mock-payperson`                                                   | `getBillingEntitlements()` returns a mock: pay-per-song ON, 0 credits (no backend).                                                                     |
| `--mock-has-credits`                                                 | Mock: Plus tier, 3 available credits.                                                                                                                   |
| `--mock-no-credits`                                                  | Mock: free, 0 credits, flag OFF (subscription-only wall).                                                                                               |
| `--fixture-paywall`                                                  | On entering the create flow, present the create-flow wall (`SubscriptionView`) directly — combine with `--mock-payperson` to see the pay-per-song hero. |
| `--fixture-reveal` / `--fixture-reveal-ready` / `--fixture-creating` | Jump to the song reveal/creating screens (screenshot fixtures).                                                                                         |
| `--design-samples`                                                   | Open the design catalog.                                                                                                                                |

### Verify the pay-per-song hero (example)

```bash
xcrun simctl launch "$UDID" porizo.ios.app.PorizoApp --bypass-auth --mock-payperson --fixture-paywall
# → Home tab → tap "Create for someone special" → wall presents with the
#   "Make one song now / Pay $1.99 — make this song" hero.
```

## How it works (code map)

- `SimulatorFixtures.swift` — DEBUG registry; parses the `--mock-*` flags → `mockEntitlements`.
- `APIClient+Billing.getBillingEntitlements()` — returns `SimulatorFixtures.mockEntitlements` (no network) when set.
- `BillingEntitlements.mock(...)` — DEBUG factory (round-trips a dict through the real decoder).
- `RootView` — `--bypass-auth` / any `--mock-*` → straight to `.main`.
- `WarmCanvasFlowView.initializeFlow` — `--fixture-paywall` → `activeSheet = .upgrade`.
- `SubscriptionView.payPerSongHero` — DEBUG price fallback (`$1.99`) + `--mock-payperson` gate, so the hero renders even without StoreKit/entitlements load.

## StoreKit in the simulator

`Configuration.storekit` is wired into the PorizoApp scheme (`StoreKitConfigurationFileReference`), so IAP products load with **simulated** purchases (no sandbox Apple ID) when run through Xcode. Under raw `simctl` launches some products may not load — the hero falls back to a DEBUG price so it still renders.

## Tier 2 — Real backend E2E (no Docker)

For real story-gen / billing-receipt / share flows, run the actual local backend.
**Docker is NOT required** — this Mac runs native Postgres (`brew services` →
`postgresql@14` on port 5432) with the `porizo` role+db already created. The
`db:up` Docker script is optional; `npm run dev` connects to native pg directly
via `DATABASE_URL` in `.env`.

```bash
# 1. Ensure native Postgres is up (already a brew service):
brew services list | grep postgres        # expect: postgresql@14 started
npm run seed:status                        # prints flags + plans (confirms DB reachable)

# 2. Flip the pay-per-song flag ON locally (so the REAL backend shows the hero):
npm run seed:payperson                     # → paywall_pay_per_song_enabled = true
#   (npm run seed:payperson:off to revert)

# 3. Start the API server (simulator talks to http://localhost:3000):
npm run dev

# 4. Run the app on the simulator WITHOUT mock fixtures (real entitlements):
xcrun simctl launch "$UDID" porizo.ios.app.PorizoApp --bypass-auth
#   → real getBillingEntitlements() now returns pay_per_song_enabled=true.
```

The seed script (`scripts/dev/seed-test-state.mjs`) refuses to run unless
`DATABASE_URL` points at localhost — it cannot touch production.

### Tier 1 vs Tier 2

- **Tier 1 (fixtures)** — fastest; no backend at all. Use for UI/state checks.
- **Tier 2 (native pg + `npm run dev`)** — real flows; use for integration
  (story-gen, purchase→wallet credit, share). Still no Docker.
