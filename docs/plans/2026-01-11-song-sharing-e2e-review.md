# Song Sharing E2E Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the ShareStats API contract mismatch that causes iOS decoding failures, then verify the complete sharing flow works E2E.

**Architecture:** The sharing system has a critical API contract mismatch - server returns nested `access_stats` and `claim_info` objects, but iOS expects flat structure. Fix server first (breaking change is acceptable since iOS is the only client), update iOS model to match, then verify the complete creator→recipient flow.

**Tech Stack:** Node.js/Fastify (server), Swift/SwiftUI (iOS), TDD with node:test and XCTest

---

## Summary of Issues

| Priority | Issue | Server Location | iOS Location |
|----------|-------|-----------------|--------------|
| **P0** | `total_events` nested in `access_stats` | `server.js:3174-3178` | `Models.swift:741` |
| **P0** | `event_counts` vs `events_by_type` | `server.js:3178` | `Models.swift:742` |
| **P0** | `is_claimed` nested in `claim_info` | `server.js:3180-3188` | `Models.swift:790` |
| **P0** | `bound_device` vs `claim_info` | `server.js:3180-3188` | `Models.swift:744` |

---

## Task 1: Write Failing Test for ShareStats Response Structure

**Files:**
- Modify: `test/share-flow.test.js` (add new test at end)

**Step 1: Write the failing test**

Add this test to `test/share-flow.test.js`:

```javascript
test("GET /tracks/:id/share/stats returns flat iOS-compatible structure", async (t) => {
  // Setup: Create user, track, and share
  const userId = `test-user-${Date.now()}`;
  const trackId = `test-track-${Date.now()}`;

  // Insert test user
  db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").run(userId, "Test User");

  // Insert test track with completed version
  db.prepare(`
    INSERT INTO tracks (id, user_id, title, occasion, recipient_name, status)
    VALUES (?, ?, 'Test Song', 'birthday', 'Recipient', 'completed')
  `).run(trackId, userId);

  db.prepare(`
    INSERT INTO track_versions (id, track_id, version_num, status, full_url)
    VALUES (?, ?, 1, 'completed', 'http://example.com/song.m4a')
  `).run(`${trackId}-v1`, trackId, 1);

  // Create share
  const createRes = await app.inject({
    method: "POST",
    url: `/tracks/${trackId}/share`,
    headers: { "x-user-id": userId },
    payload: { versionNum: 1 },
  });
  assert.equal(createRes.statusCode, 200, "Share creation should succeed");

  // Get stats
  const statsRes = await app.inject({
    method: "GET",
    url: `/tracks/${trackId}/share/stats`,
    headers: { "x-user-id": userId },
  });

  assert.equal(statsRes.statusCode, 200, "Stats request should succeed");
  const body = JSON.parse(statsRes.payload);

  // iOS expects these fields at ROOT level (not nested)
  assert.equal(typeof body.total_events, "number", "total_events must be at root");
  assert.ok("event_counts" in body, "event_counts must be at root");
  assert.equal(typeof body.is_claimed, "boolean", "is_claimed must be at root");
  assert.ok("bound_device" in body, "bound_device must be at root (can be null)");

  // These MUST NOT exist (old nested structure)
  assert.equal(body.access_stats, undefined, "access_stats should NOT exist");
  assert.equal(body.claim_info, undefined, "claim_info should NOT exist");

  // Cleanup
  db.prepare("DELETE FROM share_tokens WHERE id = ?").run(body.share_id);
  db.prepare("DELETE FROM track_versions WHERE track_id = ?").run(trackId);
  db.prepare("DELETE FROM tracks WHERE id = ?").run(trackId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm test -- test/share-flow.test.js --test-name-pattern="flat iOS-compatible"
```

Expected: FAIL with `AssertionError: total_events must be at root`

**Step 3: Commit the failing test**

```bash
git add test/share-flow.test.js
git commit -m "test(share): add failing test for iOS-compatible stats structure"
```

---

## Task 2: Fix Server ShareStats Response Structure

**Files:**
- Modify: `src/server.js:3168-3190`

**Step 1: Read current implementation**

Run:
```bash
sed -n '3168,3191p' src/server.js
```

**Step 2: Replace nested structure with flat structure**

Find this code block in `src/server.js` (around line 3168):

```javascript
    reply.send({
      share_id: share.id,
      status: share.status,
      created_at: share.created_at,
      expires_at: share.expires_at,
      is_expired: new Date(share.expires_at) < new Date(),
      access_stats: {
        total_opens: share.access_count,
        last_accessed_at: share.last_accessed_at,
        total_events: totalEvents,
        events_by_type: eventCounts,
      },
      claim_info: share.bound_device_id
        ? {
            is_claimed: true,
            claimed_at: share.bound_at,
            device_platform: share.bound_device_platform,
          }
        : {
            is_claimed: false,
          },
      recent_activity: recentActivity,
    });
```

Replace with:

```javascript
    reply.send({
      share_id: share.id,
      status: share.status,
      created_at: share.created_at,
      expires_at: share.expires_at,
      is_expired: new Date(share.expires_at) < new Date(),
      // Flattened for iOS compatibility (was nested in access_stats)
      total_events: totalEvents,
      event_counts: eventCounts,
      // Flattened for iOS compatibility (was nested in claim_info)
      is_claimed: !!share.bound_device_id,
      bound_device: share.bound_device_id
        ? {
            platform: share.bound_device_platform,
            app_version: share.bound_device_app_version,
            bound_at: share.bound_at,
          }
        : null,
      recent_activity: recentActivity,
    });
```

**Step 3: Run test to verify it passes**

Run:
```bash
npm test -- test/share-flow.test.js --test-name-pattern="flat iOS-compatible"
```

Expected: PASS

**Step 4: Run full share test suite**

Run:
```bash
npm test -- test/share-flow.test.js
```

Expected: All tests pass (or note any regressions)

**Step 5: Commit the fix**

```bash
git add src/server.js
git commit -m "fix(api): flatten ShareStats response for iOS compatibility

BREAKING: Removed nested access_stats and claim_info objects.
- total_events now at root (was access_stats.total_events)
- event_counts now at root (was access_stats.events_by_type)
- is_claimed now at root (was claim_info.is_claimed)
- bound_device now at root (was claim_info with different shape)"
```

---

## Task 3: Update iOS ShareStats Model

**Files:**
- Modify: `PorizoApp/PorizoApp/Models.swift:736-802`

**Step 1: Read current model**

Run:
```bash
sed -n '736,803p' PorizoApp/PorizoApp/Models.swift
```

**Step 2: Replace ShareStats struct**

Find the `ShareStats` struct (around line 736) and replace entirely:

```swift
/// Share statistics from GET /tracks/:id/share/stats
struct ShareStats: Codable, Sendable {
    let shareId: String
    let status: String
    let expiresAt: String
    let createdAt: String
    let isExpired: Bool
    // Flattened fields (previously nested in access_stats/claim_info)
    let totalEvents: Int
    let eventCounts: [String: EventCount]?
    let isClaimed: Bool
    let boundDevice: BoundDeviceInfo?
    let recentActivity: [ActivityEntry]?

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case status
        case expiresAt = "expires_at"
        case createdAt = "created_at"
        case isExpired = "is_expired"
        case totalEvents = "total_events"
        case eventCounts = "event_counts"
        case isClaimed = "is_claimed"
        case boundDevice = "bound_device"
        case recentActivity = "recent_activity"
    }

    struct EventCount: Codable, Sendable {
        let count: Int
        let lastAt: String?

        enum CodingKeys: String, CodingKey {
            case count
            case lastAt = "last_at"
        }
    }

    struct ActivityEntry: Codable, Sendable {
        let eventType: String
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case eventType = "event_type"
            case createdAt = "created_at"
        }
    }

    struct BoundDeviceInfo: Codable, Sendable {
        let platform: String?
        let appVersion: String?
        let boundAt: String?

        enum CodingKeys: String, CodingKey {
            case platform
            case appVersion = "app_version"
            case boundAt = "bound_at"
        }
    }

    /// Check if share is expired
    var isActuallyExpired: Bool {
        isExpired || Date() > (ISO8601DateFormatter().date(from: expiresAt) ?? Date.distantFuture)
    }

    /// Check if share is revoked
    var isRevoked: Bool {
        status == "revoked"
    }
}
```

**Step 3: Update ShareSheetView to use new isClaimed property**

Run:
```bash
grep -n "\.isClaimed" PorizoApp/PorizoApp/ShareSheetView.swift
```

The view already uses `stats.isClaimed` which was a computed property. Now it's a direct field, so no changes needed.

**Step 4: Build iOS app to verify**

Run:
```bash
cd PorizoApp && xcodebuild -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -20
```

Expected: BUILD SUCCEEDED

**Step 5: Commit the iOS changes**

```bash
git add PorizoApp/PorizoApp/Models.swift
git commit -m "fix(ios): update ShareStats model to match flattened API response

- Added isExpired, isClaimed as direct fields (were computed)
- Changed eventCounts key (was events_by_type on server)
- Changed boundDevice shape to match new server response
- Removed computed isClaimed property (now a field)"
```

---

## Task 4: Run PR Review Checkpoint

**Step 1: Run auto-pr-review**

Run:
```bash
# From Claude Code
/pr-review-toolkit:review-pr
```

**Step 2: Address any issues found**

Review the output and fix any:
- Silent failure patterns
- Type mismatches
- Missing error handling

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address PR review feedback for share stats"
```

---

## Task 5: E2E Manual Verification

**Step 1: Start the server**

Run:
```bash
npm run api
```

**Step 2: Test share creation via curl**

Run:
```bash
# Get a valid track ID first
TRACK_ID=$(sqlite3 storage/porizo.db "SELECT id FROM tracks WHERE status='completed' LIMIT 1")
USER_ID=$(sqlite3 storage/porizo.db "SELECT user_id FROM tracks WHERE id='$TRACK_ID'")

# Create share
curl -X POST "http://localhost:3000/tracks/$TRACK_ID/share" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"versionNum": 1}' | jq
```

Expected: Response with `share_id`, `share_url`, `claim_pin`

**Step 3: Test stats endpoint with new structure**

Run:
```bash
curl "http://localhost:3000/tracks/$TRACK_ID/share/stats" \
  -H "x-user-id: $USER_ID" | jq
```

Expected: Flat structure with `total_events`, `event_counts`, `is_claimed`, `bound_device` at root level

**Step 4: Verify in iOS Simulator**

1. Build and run the iOS app in Simulator
2. Navigate to a completed track
3. Tap "Share with [recipient]" button
4. Verify:
   - [ ] Share sheet opens without errors
   - [ ] QR code displays
   - [ ] 6-digit PIN is visible
   - [ ] Stats section shows (views, claimed status, days left)
   - [ ] Copy link works
   - [ ] Revoke button works

---

## Task 6: Final Commit and Summary

**Step 1: Verify all tests pass**

Run:
```bash
npm test
cd PorizoApp && xcodebuild -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16' build
```

**Step 2: Create summary commit if needed**

```bash
git log --oneline -5
```

---

## Verification Checklist

After all tasks:

- [ ] `npm test -- test/share-flow.test.js` passes
- [ ] iOS app builds without errors
- [ ] Share sheet opens and displays correctly
- [ ] Share stats load without JSON decoding errors
- [ ] QR code generates and displays
- [ ] PIN is visible and copyable
- [ ] Stats show views, claimed status, days remaining
- [ ] Revoke functionality works

---

## Known Limitations (Out of Scope)

1. **Web player**: `/play/:shareId` web player not implemented (returns 404)
2. **PIN rotation**: Must revoke entire share to change PIN
3. **Device binding**: Headers are client-controlled (spoofable) - P1 security issue
4. **Rate limiting**: Public share endpoints lack rate limiting - P1 security issue
