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

## Tier 2 (real backend E2E) — TODO

For real story-gen / billing-receipt / share flows you still need the backend. See `tasks/todo.md` Tier 2 (native Postgres, `dev:full`, seed script, `/debug/seed`). Not yet implemented.
