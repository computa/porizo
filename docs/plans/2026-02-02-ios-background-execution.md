# iOS Background Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **After each major task:** Run `/auto-pr-review` and `code-simplifier` agent.
> **Execution:** Use parallel agents where tasks are independent.

**Goal:** Enable the Porizo iOS app to continue functioning when backgrounded, ensuring API calls complete, renders are tracked, and users are notified when work finishes.

**Architecture:** Server-centric design where long-running work happens on backend. Client uses `beginBackgroundTask` for extra execution time, background URLSession for uploads, and APNs push notifications for completion alerts. Automatic polling and foreground recovery handle edge cases.

**Tech Stack:** Swift/SwiftUI (iOS 16+), Node.js/Fastify (server), APNs via `apn` package, PostgreSQL

---

## Phase Overview

| Phase | Description | Parallel Agents |
|-------|-------------|-----------------|
| **Phase 1** | Immediate fixes (beginBackgroundTask, polling, local notifications) | 2 agents |
| **Phase 2** | Background URLSession + BGTaskScheduler | 2 agents |
| **Phase 3** | Push notifications (server + client) | 3 agents |

---

## Phase 1: Immediate Fixes

### Task 1.1: Add BackgroundTaskManager Utility (Agent A)

**Files:**
- Create: `PorizoApp/PorizoApp/Services/BackgroundTaskManager.swift`
- Test: `PorizoApp/PorizoAppTests/BackgroundTaskManagerTests.swift`

**Step 1: Write the failing test**

```swift
// PorizoApp/PorizoAppTests/BackgroundTaskManagerTests.swift
import XCTest
@testable import PorizoApp

final class BackgroundTaskManagerTests: XCTestCase {

    func test_executeWithBackgroundTime_completesTask() async throws {
        let manager = BackgroundTaskManager.shared
        var completed = false

        await manager.executeWithBackgroundTime(taskName: "test") {
            completed = true
        }

        XCTAssertTrue(completed)
    }

    func test_executeWithBackgroundTime_handlesAsyncWork() async throws {
        let manager = BackgroundTaskManager.shared
        var result: String?

        await manager.executeWithBackgroundTime(taskName: "async-test") {
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1s
            result = "done"
        }

        XCTAssertEqual(result, "done")
    }
}
```

**Step 2: Run test to verify it fails**

Run: `xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:PorizoAppTests/BackgroundTaskManagerTests`

Expected: FAIL with "cannot find BackgroundTaskManager"

**Step 3: Write minimal implementation**

```swift
// PorizoApp/PorizoApp/Services/BackgroundTaskManager.swift
import UIKit

@MainActor
final class BackgroundTaskManager {
    static let shared = BackgroundTaskManager()

    private init() {}

    /// Execute work with extended background time (~30 seconds)
    func executeWithBackgroundTime(taskName: String, work: @escaping () async -> Void) async {
        let taskId = UIApplication.shared.beginBackgroundTask(withName: taskName) {
            // Expiration handler - called if we run out of time
            print("[BackgroundTask] \(taskName) expired")
        }

        guard taskId != .invalid else {
            // Fallback: just run the work without background time
            await work()
            return
        }

        await work()

        UIApplication.shared.endBackgroundTask(taskId)
        print("[BackgroundTask] \(taskName) completed")
    }

    /// Execute throwing work with extended background time
    func executeWithBackgroundTime<T>(taskName: String, work: @escaping () async throws -> T) async throws -> T {
        let taskId = UIApplication.shared.beginBackgroundTask(withName: taskName) {
            print("[BackgroundTask] \(taskName) expired")
        }

        defer {
            if taskId != .invalid {
                UIApplication.shared.endBackgroundTask(taskId)
                print("[BackgroundTask] \(taskName) completed")
            }
        }

        return try await work()
    }
}
```

**Step 4: Run test to verify it passes**

Run: `xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:PorizoAppTests/BackgroundTaskManagerTests`

Expected: PASS

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/Services/BackgroundTaskManager.swift PorizoApp/PorizoAppTests/BackgroundTaskManagerTests.swift
git commit -m "feat(ios): add BackgroundTaskManager for extended execution time"
```

---

### Task 1.2: Wrap API Calls with Background Time (Agent A)

**Files:**
- Modify: `PorizoApp/PorizoApp/APIClient.swift`

**Step 1: Identify API methods that need wrapping**

Key methods to wrap:
- `continueStory()` - Conversational chat
- `generateLyrics()` - Lyrics generation
- `renderPreview()` - Preview render initiation
- `renderFull()` - Full render initiation
- `uploadChunk()` - Voice enrollment uploads

**Step 2: Wrap continueStory with background time**

```swift
// In APIClient.swift, modify continueStory method
func continueStory(storyId: String, userInput: String) async throws -> StoryResponse {
    return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStory") {
        // Existing implementation
        let request = StoryRequest(userInput: userInput)
        let response: StoryResponse = try await self.post("/story/\(storyId)/continue", body: request)
        return response
    }
}
```

**Step 3: Wrap renderPreview with background time**

```swift
// In APIClient.swift, modify renderPreview method
func renderPreview(trackId: String, versionNum: Int) async throws -> RenderResponse {
    return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderPreview") {
        let response: RenderResponse = try await self.post("/track/\(trackId)/version/\(versionNum)/render/preview", body: EmptyBody())
        return response
    }
}
```

**Step 4: Wrap all critical API methods**

Apply same pattern to:
- `generateLyrics()`
- `renderFull()`
- `uploadChunk()`
- `createTrack()`
- `saveTrackVersion()`

**Step 5: Test manually**

1. Start conversational chat
2. Send message
3. Immediately background app
4. Return after 10 seconds
5. Verify response arrived

**Step 6: Commit**

```bash
git add PorizoApp/PorizoApp/APIClient.swift
git commit -m "feat(ios): wrap critical API calls with background execution time"
```

---

### Task 1.3: Add Automatic Polling Timer for Rendering Tracks (Agent B)

**Files:**
- Modify: `PorizoApp/PorizoApp/MySongsView.swift`
- Create: `PorizoApp/PorizoApp/Services/RenderPollingService.swift`
- Test: `PorizoApp/PorizoAppTests/RenderPollingServiceTests.swift`

**Step 1: Write the failing test**

```swift
// PorizoApp/PorizoAppTests/RenderPollingServiceTests.swift
import XCTest
@testable import PorizoApp

final class RenderPollingServiceTests: XCTestCase {

    func test_startPolling_callsRefreshHandler() async throws {
        let service = RenderPollingService()
        var refreshCount = 0

        service.startPolling(interval: 0.1) {
            refreshCount += 1
        }

        try await Task.sleep(nanoseconds: 350_000_000) // 0.35s
        service.stopPolling()

        XCTAssertGreaterThanOrEqual(refreshCount, 3)
    }

    func test_stopPolling_stopsRefreshCalls() async throws {
        let service = RenderPollingService()
        var refreshCount = 0

        service.startPolling(interval: 0.1) {
            refreshCount += 1
        }

        try await Task.sleep(nanoseconds: 150_000_000) // 0.15s
        service.stopPolling()
        let countAtStop = refreshCount

        try await Task.sleep(nanoseconds: 200_000_000) // 0.2s more

        XCTAssertEqual(refreshCount, countAtStop)
    }
}
```

**Step 2: Run test to verify it fails**

Run: `xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:PorizoAppTests/RenderPollingServiceTests`

Expected: FAIL with "cannot find RenderPollingService"

**Step 3: Write minimal implementation**

```swift
// PorizoApp/PorizoApp/Services/RenderPollingService.swift
import Foundation
import Combine

@MainActor
final class RenderPollingService: ObservableObject {
    private var timer: AnyCancellable?
    @Published private(set) var isPolling = false

    func startPolling(interval: TimeInterval = 5.0, onRefresh: @escaping () -> Void) {
        guard !isPolling else { return }
        isPolling = true

        timer = Timer.publish(every: interval, on: .main, in: .common)
            .autoconnect()
            .sink { _ in
                onRefresh()
            }

        print("[RenderPolling] Started with interval \(interval)s")
    }

    func stopPolling() {
        timer?.cancel()
        timer = nil
        isPolling = false
        print("[RenderPolling] Stopped")
    }
}
```

**Step 4: Run test to verify it passes**

Run: `xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:PorizoAppTests/RenderPollingServiceTests`

Expected: PASS

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/Services/RenderPollingService.swift PorizoApp/PorizoAppTests/RenderPollingServiceTests.swift
git commit -m "feat(ios): add RenderPollingService for automatic track status refresh"
```

---

### Task 1.4: Integrate Polling into MySongsView (Agent B)

**Files:**
- Modify: `PorizoApp/PorizoApp/MySongsView.swift`

**Step 1: Add polling service to view**

```swift
// In MySongsView.swift, add property
@StateObject private var pollingService = RenderPollingService()
```

**Step 2: Start/stop polling based on rendering status**

```swift
// In MySongsView.swift body, add .onChange modifier
.onChange(of: tracks) { _, newTracks in
    let hasRenderingTrack = newTracks.contains {
        $0.status == "rendering" || $0.status == "processing"
    }

    if hasRenderingTrack && !pollingService.isPolling {
        pollingService.startPolling(interval: 5.0) { [weak viewModel] in
            Task {
                await viewModel?.refreshTracks()
            }
        }
    } else if !hasRenderingTrack && pollingService.isPolling {
        pollingService.stopPolling()
    }
}
.onDisappear {
    pollingService.stopPolling()
}
```

**Step 3: Test manually**

1. Start a preview render
2. Navigate to My Songs tab
3. Verify polling indicator or logs show 5-second refresh
4. When render completes, verify polling stops

**Step 4: Commit**

```bash
git add PorizoApp/PorizoApp/MySongsView.swift
git commit -m "feat(ios): integrate automatic polling for rendering tracks in MySongsView"
```

---

### Task 1.5: Add Local Notification Service (Agent B)

**Files:**
- Create: `PorizoApp/PorizoApp/Services/LocalNotificationService.swift`
- Modify: `PorizoApp/PorizoApp/PorizoAppApp.swift`
- Test: `PorizoApp/PorizoAppTests/LocalNotificationServiceTests.swift`

**Step 1: Write the failing test**

```swift
// PorizoApp/PorizoAppTests/LocalNotificationServiceTests.swift
import XCTest
import UserNotifications
@testable import PorizoApp

final class LocalNotificationServiceTests: XCTestCase {

    func test_requestAuthorization_doesNotThrow() async throws {
        let service = LocalNotificationService.shared
        // This will prompt for permission in simulator - just verify no crash
        do {
            try await service.requestAuthorization()
        } catch {
            // Permission denied is acceptable in tests
        }
    }

    func test_showRenderComplete_createsNotification() async throws {
        let service = LocalNotificationService.shared

        // Just verify no crash - can't easily test notification content
        await service.showRenderComplete(trackId: "test-123", trackTitle: "Happy Birthday")
    }
}
```

**Step 2: Run test to verify it fails**

Expected: FAIL with "cannot find LocalNotificationService"

**Step 3: Write minimal implementation**

```swift
// PorizoApp/PorizoApp/Services/LocalNotificationService.swift
import UserNotifications

final class LocalNotificationService {
    static let shared = LocalNotificationService()

    private let center = UNUserNotificationCenter.current()

    private init() {}

    func requestAuthorization() async throws {
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        print("[LocalNotification] Authorization granted: \(granted)")
    }

    func showRenderComplete(trackId: String, trackTitle: String) async {
        let content = UNMutableNotificationContent()
        content.title = "Your song is ready!"
        content.body = trackTitle
        content.sound = .default
        content.userInfo = ["trackId": trackId, "type": "render_complete"]

        let request = UNNotificationRequest(
            identifier: "render-\(trackId)",
            content: content,
            trigger: nil // Deliver immediately
        )

        do {
            try await center.add(request)
            print("[LocalNotification] Scheduled render complete notification for \(trackId)")
        } catch {
            print("[LocalNotification] Failed to schedule: \(error)")
        }
    }

    func removeNotification(for trackId: String) {
        center.removeDeliveredNotifications(withIdentifiers: ["render-\(trackId)"])
        center.removePendingNotificationRequests(withIdentifiers: ["render-\(trackId)"])
    }
}
```

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/Services/LocalNotificationService.swift PorizoApp/PorizoAppTests/LocalNotificationServiceTests.swift
git commit -m "feat(ios): add LocalNotificationService for render completion alerts"
```

---

### Task 1.6: Request Notification Permission on App Launch (Agent B)

**Files:**
- Modify: `PorizoApp/PorizoApp/PorizoAppApp.swift`

**Step 1: Add notification permission request**

```swift
// In PorizoAppApp.swift, add to init() or onAppear
.task {
    do {
        try await LocalNotificationService.shared.requestAuthorization()
    } catch {
        print("[App] Notification permission error: \(error)")
    }
}
```

**Step 2: Commit**

```bash
git add PorizoApp/PorizoApp/PorizoAppApp.swift
git commit -m "feat(ios): request notification permission on app launch"
```

---

### Task 1.7: Show Local Notification When Render Completes (Agent B)

**Files:**
- Modify: `PorizoApp/PorizoApp/MySongsView.swift`

**Step 1: Track previously rendering tracks**

```swift
// In MySongsView, add state
@State private var previouslyRenderingTrackIds: Set<String> = []
```

**Step 2: Detect completion and show notification**

```swift
// In .onChange(of: tracks) modifier
.onChange(of: tracks) { oldTracks, newTracks in
    // Track which were rendering before
    let currentlyRendering = Set(newTracks.filter {
        $0.status == "rendering" || $0.status == "processing"
    }.map { $0.id })

    // Find tracks that just completed
    let justCompleted = previouslyRenderingTrackIds.subtracting(currentlyRendering)

    for trackId in justCompleted {
        if let track = newTracks.first(where: { $0.id == trackId && $0.status == "completed" }) {
            Task {
                await LocalNotificationService.shared.showRenderComplete(
                    trackId: track.id,
                    trackTitle: track.title
                )
            }
        }
    }

    previouslyRenderingTrackIds = currentlyRendering

    // ... existing polling logic
}
```

**Step 3: Test manually**

1. Start preview render
2. Background app
3. Wait for completion (check server logs)
4. Notification should appear

**Step 4: Commit**

```bash
git add PorizoApp/PorizoApp/MySongsView.swift
git commit -m "feat(ios): show local notification when render completes"
```

---

### 🔄 Phase 1 Review Checkpoint

**Run after Phase 1 completion:**

```bash
# Run auto-pr-review
/auto-pr-review

# Run code-simplifier agent
# Task tool: subagent_type="code-simplifier"
```

**Manual Testing Checklist:**
- [ ] Conversational chat continues when app backgrounded for 10s
- [ ] Lyrics generation completes when app backgrounded
- [ ] Rendering tracks poll every 5 seconds
- [ ] Local notification appears when render completes
- [ ] Polling stops when no tracks are rendering

---

## Phase 2: Background URLSession + BGTaskScheduler

### Task 2.1: Create Background URLSession Configuration (Agent C)

**Files:**
- Create: `PorizoApp/PorizoApp/Services/BackgroundURLSessionManager.swift`
- Test: `PorizoApp/PorizoAppTests/BackgroundURLSessionManagerTests.swift`

**Step 1: Write the failing test**

```swift
// PorizoApp/PorizoAppTests/BackgroundURLSessionManagerTests.swift
import XCTest
@testable import PorizoApp

final class BackgroundURLSessionManagerTests: XCTestCase {

    func test_session_hasBackgroundConfiguration() {
        let manager = BackgroundURLSessionManager.shared
        let config = manager.session.configuration

        XCTAssertNotNil(config.identifier)
        XCTAssertTrue(config.identifier?.contains("porizo") ?? false)
        XCTAssertTrue(config.sessionSendsLaunchEvents)
    }
}
```

**Step 2: Run test to verify it fails**

Expected: FAIL with "cannot find BackgroundURLSessionManager"

**Step 3: Write minimal implementation**

```swift
// PorizoApp/PorizoApp/Services/BackgroundURLSessionManager.swift
import Foundation

final class BackgroundURLSessionManager: NSObject {
    static let shared = BackgroundURLSessionManager()

    static let sessionIdentifier = "com.porizo.background-upload"

    private(set) lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.shouldUseExtendedBackgroundIdleMode = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var completionHandlers: [String: (Result<Data, Error>) -> Void] = [:]
    private let lock = NSLock()

    private override init() {
        super.init()
    }

    func upload(data: Data, to url: URL, completion: @escaping (Result<Data, Error>) -> Void) -> URLSessionUploadTask {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")

        let task = session.uploadTask(with: request, from: data)

        lock.lock()
        completionHandlers["\(task.taskIdentifier)"] = completion
        lock.unlock()

        task.resume()
        return task
    }
}

extension BackgroundURLSessionManager: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let key = "\(dataTask.taskIdentifier)"
        lock.lock()
        let handler = completionHandlers.removeValue(forKey: key)
        lock.unlock()

        handler?(.success(data))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let key = "\(task.taskIdentifier)"
        lock.lock()
        let handler = completionHandlers.removeValue(forKey: key)
        lock.unlock()

        if let error = error {
            handler?(.failure(error))
        }
    }
}
```

**Step 4: Run test to verify it passes**

Expected: PASS

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/Services/BackgroundURLSessionManager.swift PorizoApp/PorizoAppTests/BackgroundURLSessionManagerTests.swift
git commit -m "feat(ios): add BackgroundURLSessionManager for upload persistence"
```

---

### Task 2.2: Add Background Modes to Info.plist (Agent C)

**Files:**
- Modify: `PorizoApp/Info.plist`

**Step 1: Add required background modes**

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>fetch</string>
    <string>remote-notification</string>
    <string>processing</string>
</array>
```

**Step 2: Add BGTaskScheduler identifiers**

```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.porizo.refresh</string>
    <string>com.porizo.render-check</string>
</array>
```

**Step 3: Commit**

```bash
git add PorizoApp/Info.plist
git commit -m "feat(ios): add background modes and BGTaskScheduler identifiers"
```

---

### Task 2.3: Register BGTaskScheduler Tasks (Agent D)

**Files:**
- Create: `PorizoApp/PorizoApp/Services/BackgroundTaskRegistrar.swift`
- Modify: `PorizoApp/PorizoApp/PorizoAppApp.swift`

**Step 1: Create task registrar**

```swift
// PorizoApp/PorizoApp/Services/BackgroundTaskRegistrar.swift
import BackgroundTasks

struct BackgroundTaskRegistrar {
    static let refreshTaskId = "com.porizo.refresh"
    static let renderCheckTaskId = "com.porizo.render-check"

    static func registerTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: refreshTaskId,
            using: nil
        ) { task in
            handleAppRefresh(task: task as! BGAppRefreshTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: renderCheckTaskId,
            using: nil
        ) { task in
            handleRenderCheck(task: task as! BGProcessingTask)
        }

        print("[BGTask] Registered background tasks")
    }

    static func scheduleAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BGTask] Scheduled app refresh")
        } catch {
            print("[BGTask] Failed to schedule app refresh: \(error)")
        }
    }

    static func scheduleRenderCheck() {
        let request = BGProcessingTaskRequest(identifier: renderCheckTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60) // 5 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BGTask] Scheduled render check")
        } catch {
            print("[BGTask] Failed to schedule render check: \(error)")
        }
    }

    private static func handleAppRefresh(task: BGAppRefreshTask) {
        scheduleAppRefresh() // Schedule next refresh

        let refreshTask = Task {
            // Refresh track status
            // This would call your API client
            print("[BGTask] Running app refresh")
        }

        task.expirationHandler = {
            refreshTask.cancel()
        }

        Task {
            await refreshTask.value
            task.setTaskCompleted(success: true)
        }
    }

    private static func handleRenderCheck(task: BGProcessingTask) {
        scheduleRenderCheck() // Schedule next check

        let checkTask = Task {
            // Check for completed renders
            print("[BGTask] Running render check")
        }

        task.expirationHandler = {
            checkTask.cancel()
        }

        Task {
            await checkTask.value
            task.setTaskCompleted(success: true)
        }
    }
}
```

**Step 2: Register tasks on app launch**

```swift
// In PorizoAppApp.swift init()
init() {
    BackgroundTaskRegistrar.registerTasks()
}
```

**Step 3: Schedule tasks when app backgrounds**

```swift
// In PorizoAppApp.swift, in scenePhase onChange
.onChange(of: scenePhase) { oldPhase, newPhase in
    if newPhase == .background {
        BackgroundTaskRegistrar.scheduleAppRefresh()
        BackgroundTaskRegistrar.scheduleRenderCheck()
    }
}
```

**Step 4: Commit**

```bash
git add PorizoApp/PorizoApp/Services/BackgroundTaskRegistrar.swift PorizoApp/PorizoApp/PorizoAppApp.swift
git commit -m "feat(ios): register and schedule BGTaskScheduler tasks"
```

---

### 🔄 Phase 2 Review Checkpoint

**Run after Phase 2 completion:**

```bash
# Run auto-pr-review
/auto-pr-review

# Run code-simplifier agent
```

**Manual Testing Checklist:**
- [ ] Background modes appear in Xcode capabilities
- [ ] BGTaskScheduler tasks register on launch (check logs)
- [ ] Tasks schedule when app backgrounds
- [ ] BackgroundURLSessionManager creates valid session

---

## Phase 3: Push Notifications (Server + Client)

### Task 3.1: Database Migration for Push Tokens (Agent E)

**Files:**
- Create: `migrations/pg/033_add_push_tokens.sql`

**Step 1: Write migration**

```sql
-- migrations/pg/033_add_push_tokens.sql
-- Add push notification token storage to devices table

ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_push_token ON devices(push_token)
WHERE push_token IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN devices.push_token IS 'APNs device token for push notifications';
```

**Step 2: Run migration locally**

```bash
npm run db:migrate
```

**Step 3: Verify migration**

```bash
npm run db:shell
# Then run: \d devices
# Should show push_token and push_token_updated_at columns
```

**Step 4: Commit**

```bash
git add migrations/pg/033_add_push_tokens.sql
git commit -m "feat(db): add push_token column to devices table"
```

---

### Task 3.2: Update Device Registration Endpoint (Agent E)

**Files:**
- Modify: `src/server.js` (device registration route)

**Step 1: Find device registration route**

```bash
grep -n "device/register" src/server.js
```

**Step 2: Update to accept push_token**

```javascript
// In src/server.js, find POST /device/register route
// Add push_token to the body schema and save logic

fastify.post('/device/register', {
  schema: {
    body: {
      type: 'object',
      properties: {
        device_id: { type: 'string' },
        platform: { type: 'string' },
        app_version: { type: 'string' },
        push_token: { type: 'string' }  // ADD THIS
      },
      required: ['device_id', 'platform']
    }
  }
}, async (request, reply) => {
  const { device_id, platform, app_version, push_token } = request.body;
  const userId = request.userId;

  // Update or insert device with push_token
  await db.run(`
    INSERT INTO devices (id, user_id, device_id, platform, app_version, push_token, push_token_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, device_id) DO UPDATE SET
      app_version = excluded.app_version,
      push_token = excluded.push_token,
      push_token_updated_at = CASE
        WHEN excluded.push_token IS NOT NULL AND excluded.push_token != devices.push_token
        THEN excluded.push_token_updated_at
        ELSE devices.push_token_updated_at
      END,
      updated_at = excluded.updated_at
  `, [
    generateId('device'),
    userId,
    device_id,
    platform,
    app_version,
    push_token,
    push_token ? new Date().toISOString() : null,
    new Date().toISOString(),
    new Date().toISOString()
  ]);

  return { success: true };
});
```

**Step 3: Test endpoint**

```bash
curl -X POST http://localhost:3000/device/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"device_id": "test-device", "platform": "ios", "push_token": "abc123"}'
```

**Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat(api): accept push_token in device registration"
```

---

### Task 3.3: Create Push Notification Service (Agent F)

**Files:**
- Create: `src/services/push-notification.js`
- Modify: `package.json` (add apn dependency)

**Step 1: Install apn package**

```bash
npm install @parse/node-apn
```

**Step 2: Create push notification service**

```javascript
// src/services/push-notification.js
const apn = require('@parse/node-apn');

let provider = null;

function getProvider() {
  if (provider) return provider;

  const privateKey = process.env.APPLE_SIGNIN_PRIVATE_KEY;
  const keyId = process.env.APPLE_SIGNIN_KEY_ID;
  const teamId = process.env.APPLE_SIGNIN_TEAM_ID;

  if (!privateKey || !keyId || !teamId) {
    console.warn('[PushNotification] Missing Apple credentials, push disabled');
    return null;
  }

  provider = new apn.Provider({
    token: {
      key: privateKey,
      keyId: keyId,
      teamId: teamId,
    },
    production: process.env.NODE_ENV === 'production'
  });

  console.log('[PushNotification] Provider initialized');
  return provider;
}

async function sendRenderComplete(pushToken, trackId, trackTitle) {
  const apnProvider = getProvider();
  if (!apnProvider) {
    console.log('[PushNotification] Provider not available, skipping push');
    return { sent: false, reason: 'provider_not_configured' };
  }

  const notification = new apn.Notification();
  notification.contentAvailable = true; // Silent push
  notification.topic = process.env.APPLE_CLIENT_ID || 'porizo.ios.app.PorizoApp';
  notification.payload = {
    type: 'render_complete',
    trackId,
    trackTitle
  };

  try {
    const result = await apnProvider.send(notification, pushToken);
    console.log('[PushNotification] Send result:', JSON.stringify(result));
    return { sent: result.sent.length > 0, result };
  } catch (error) {
    console.error('[PushNotification] Send error:', error);
    return { sent: false, error: error.message };
  }
}

async function sendSongReady(pushToken, trackId, trackTitle) {
  const apnProvider = getProvider();
  if (!apnProvider) return { sent: false, reason: 'provider_not_configured' };

  const notification = new apn.Notification();
  notification.alert = {
    title: 'Your song is ready!',
    body: trackTitle
  };
  notification.sound = 'default';
  notification.topic = process.env.APPLE_CLIENT_ID || 'porizo.ios.app.PorizoApp';
  notification.payload = {
    type: 'song_ready',
    trackId
  };

  try {
    const result = await apnProvider.send(notification, pushToken);
    return { sent: result.sent.length > 0, result };
  } catch (error) {
    console.error('[PushNotification] Send error:', error);
    return { sent: false, error: error.message };
  }
}

module.exports = {
  sendRenderComplete,
  sendSongReady,
  getProvider
};
```

**Step 3: Commit**

```bash
git add src/services/push-notification.js package.json package-lock.json
git commit -m "feat(server): add APNs push notification service"
```

---

### Task 3.4: Trigger Push on Job Completion (Agent F)

**Files:**
- Modify: `src/services/job-service.js` or worker completion callback

**Step 1: Find job completion handler**

```bash
grep -rn "status.*completed\|job.*complete" src/services/
```

**Step 2: Add push notification trigger**

```javascript
// In job completion handler (e.g., src/services/job-service.js)
const pushNotification = require('./push-notification');
const db = require('../db');

async function onJobComplete(job) {
  // ... existing completion logic ...

  // Send push notification
  if (job.workflow_type === 'preview_render' || job.workflow_type === 'full_render') {
    try {
      // Get user's device with push token
      const device = await db.get(`
        SELECT push_token FROM devices
        WHERE user_id = ? AND push_token IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1
      `, [job.user_id]);

      if (device?.push_token) {
        // Get track title
        const track = await db.get('SELECT title FROM tracks WHERE id = ?', [job.track_id]);

        await pushNotification.sendSongReady(
          device.push_token,
          job.track_id,
          track?.title || 'Your song'
        );

        console.log(`[Job] Sent push notification for job ${job.id}`);
      }
    } catch (error) {
      console.error('[Job] Failed to send push notification:', error);
      // Don't fail the job for notification errors
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/services/job-service.js
git commit -m "feat(server): trigger push notification on render completion"
```

---

### Task 3.5: iOS Push Notification Registration (Agent G)

**Files:**
- Create: `PorizoApp/PorizoApp/Services/PushNotificationService.swift`
- Modify: `PorizoApp/PorizoApp/PorizoAppApp.swift`

**Step 1: Create push notification service**

```swift
// PorizoApp/PorizoApp/Services/PushNotificationService.swift
import UIKit
import UserNotifications

@MainActor
final class PushNotificationService: NSObject, ObservableObject {
    static let shared = PushNotificationService()

    @Published private(set) var deviceToken: String?
    @Published private(set) var isRegistered = false

    private override init() {
        super.init()
    }

    func requestPermissionAndRegister() async {
        let center = UNUserNotificationCenter.current()

        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            print("[Push] Authorization granted: \(granted)")

            if granted {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        } catch {
            print("[Push] Authorization error: \(error)")
        }
    }

    func handleDeviceToken(_ tokenData: Data) {
        let token = tokenData.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = token
        self.isRegistered = true
        print("[Push] Device token: \(token)")

        // Send to server
        Task {
            await sendTokenToServer(token)
        }
    }

    func handleRegistrationError(_ error: Error) {
        print("[Push] Registration error: \(error)")
        self.isRegistered = false
    }

    private func sendTokenToServer(_ token: String) async {
        guard let apiClient = APIClient.shared else { return }

        do {
            try await apiClient.registerDevice(pushToken: token)
            print("[Push] Token sent to server")
        } catch {
            print("[Push] Failed to send token to server: \(error)")
        }
    }
}
```

**Step 2: Add AppDelegate for push callbacks**

```swift
// In PorizoAppApp.swift, add AppDelegate
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            PushNotificationService.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in
            PushNotificationService.shared.handleRegistrationError(error)
        }
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        print("[Push] Received remote notification: \(userInfo)")

        if let type = userInfo["type"] as? String {
            switch type {
            case "render_complete", "song_ready":
                // Refresh tracks
                NotificationCenter.default.post(name: .refreshTracks, object: nil)

                // Show local notification if app is in background
                if let trackTitle = userInfo["trackTitle"] as? String,
                   let trackId = userInfo["trackId"] as? String {
                    Task {
                        await LocalNotificationService.shared.showRenderComplete(
                            trackId: trackId,
                            trackTitle: trackTitle
                        )
                    }
                }

                completionHandler(.newData)
            default:
                completionHandler(.noData)
            }
        } else {
            completionHandler(.noData)
        }
    }
}

// Add notification name extension
extension Notification.Name {
    static let refreshTracks = Notification.Name("refreshTracks")
}
```

**Step 3: Wire up AppDelegate**

```swift
// In PorizoAppApp.swift
@main
struct PorizoAppApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    // ... rest of app
}
```

**Step 4: Register on app launch**

```swift
// In PorizoAppApp.swift body
.task {
    await PushNotificationService.shared.requestPermissionAndRegister()
}
```

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/Services/PushNotificationService.swift PorizoApp/PorizoApp/PorizoAppApp.swift
git commit -m "feat(ios): add push notification registration and handling"
```

---

### Task 3.6: Update APIClient to Send Push Token (Agent G)

**Files:**
- Modify: `PorizoApp/PorizoApp/APIClient.swift`

**Step 1: Add registerDevice method**

```swift
// In APIClient.swift
func registerDevice(pushToken: String? = nil) async throws {
    let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    let body = DeviceRegistration(
        device_id: deviceId,
        platform: "ios",
        app_version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
        push_token: pushToken
    )

    let _: EmptyResponse = try await post("/device/register", body: body)
}

struct DeviceRegistration: Codable {
    let device_id: String
    let platform: String
    let app_version: String?
    let push_token: String?
}
```

**Step 2: Commit**

```bash
git add PorizoApp/PorizoApp/APIClient.swift
git commit -m "feat(ios): add push token to device registration"
```

---

### Task 3.7: Handle Track Refresh Notification (Agent G)

**Files:**
- Modify: `PorizoApp/PorizoApp/MySongsView.swift`

**Step 1: Listen for refresh notification**

```swift
// In MySongsView.swift
.onReceive(NotificationCenter.default.publisher(for: .refreshTracks)) { _ in
    Task {
        await viewModel.refreshTracks()
    }
}
```

**Step 2: Commit**

```bash
git add PorizoApp/PorizoApp/MySongsView.swift
git commit -m "feat(ios): handle track refresh notification from push"
```

---

### 🔄 Phase 3 Review Checkpoint

**Run after Phase 3 completion:**

```bash
# Run auto-pr-review
/auto-pr-review

# Run code-simplifier agent
```

**Manual Testing Checklist:**
- [ ] Migration adds push_token column
- [ ] Device registration accepts and stores push_token
- [ ] Push notification service initializes with Apple credentials
- [ ] iOS app requests push permission
- [ ] Device token is sent to server
- [ ] Push received when render completes
- [ ] Track list refreshes on push notification

---

## Final Integration Testing

### End-to-End Test Scenarios

**Scenario 1: Conversational Chat Background**
1. Start song extraction chat
2. Send message
3. Background app for 15 seconds
4. Return - response should be there

**Scenario 2: Render with Background**
1. Start preview render
2. Background app immediately
3. Wait 90 seconds
4. Should receive push notification
5. Return to app - song should be ready

**Scenario 3: App Killed During Render**
1. Start render
2. Force quit app
3. Wait for completion
4. Relaunch app
5. Song should appear in My Songs

---

## Agent Assignments Summary

| Agent | Tasks | Focus Area |
|-------|-------|------------|
| **Agent A** | 1.1, 1.2 | BackgroundTaskManager + API wrapping |
| **Agent B** | 1.3, 1.4, 1.5, 1.6, 1.7 | Polling + Local notifications |
| **Agent C** | 2.1, 2.2 | Background URLSession + Info.plist |
| **Agent D** | 2.3 | BGTaskScheduler registration |
| **Agent E** | 3.1, 3.2 | Database migration + API endpoint |
| **Agent F** | 3.3, 3.4 | Server push notification service |
| **Agent G** | 3.5, 3.6, 3.7 | iOS push registration + handling |

---

## Parallel Execution Groups

**Group 1 (Can run simultaneously):**
- Agent A: Tasks 1.1, 1.2
- Agent B: Tasks 1.3, 1.4, 1.5

**Group 2 (Can run simultaneously after Group 1):**
- Agent C: Tasks 2.1, 2.2
- Agent D: Task 2.3

**Group 3 (Can run simultaneously):**
- Agent E: Tasks 3.1, 3.2 (server)
- Agent F: Tasks 3.3, 3.4 (server)
- Agent G: Tasks 3.5, 3.6, 3.7 (iOS)

**Note:** Run Phase 1 → Review → Phase 2 → Review → Phase 3 → Review
