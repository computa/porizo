//
//  PorizoAppApp.swift
//  PorizoApp
//
//  Created by aobimma on 1/1/2026.
//

import SwiftUI
import FirebaseCore
import FirebaseCrashlytics
import OneSignalFramework

class AppDelegate: NSObject, UIApplicationDelegate {

    // MARK: - App Launch

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Register for remote notifications (APNs)
        // This requests a device token from Apple's push notification service.
        // The actual permission prompt is handled separately by LocalNotificationService.
        application.registerForRemoteNotifications()
        return true
    }

    // MARK: - Push Notification Registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = PushTokenManager.tokenToString(deviceToken)
        print("[Push] Device token: \(token)")

        // Store token for later sending to server (native APNs for transactional pushes)
        PushTokenManager.savePushToken(token)

        // Notify the app that a fresh push token is available for server registration
        NotificationCenter.default.post(name: .pushTokenUpdated, object: nil)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // This can fail in simulators or if push notifications aren't configured
        print("[Push] Failed to register: \(error.localizedDescription)")
    }

    // MARK: - Push Notification Handling

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        print("[Push] Received remote notification: \(userInfo)")

        // Parse render completion notifications
        if let payload = PushPayloadParser.parseRenderComplete(from: userInfo) {
            print("[Push] Render complete for track: \(payload.trackId)")

            // Show local notification to the user
            Task {
                await LocalNotificationService.shared.showRenderComplete(
                    trackId: payload.trackId,
                    trackTitle: payload.trackTitle
                )
            }

            // Post notification to refresh the tracks list in any active views
            NotificationCenter.default.post(
                name: .trackRenderCompleted,
                object: nil,
                userInfo: ["trackId": payload.trackId]
            )

            completionHandler(.newData)
        } else {
            completionHandler(.noData)
        }
    }

    // MARK: - Background URL Session

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if identifier == BackgroundURLSessionManager.sessionIdentifier {
            BackgroundURLSessionManager.shared.handleEventsForBackgroundURLSession(
                completionHandler: completionHandler
            )
        }
    }
}

@main
struct PorizoAppApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    // Auth manager shared across the app
    @State private var authManager = AuthManager()

    // API-driven style list
    @State private var styleStore = StyleStore()

    // Track app lifecycle for proactive token refresh
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Initialize Firebase core services (Crashlytics enabled, Analytics disabled in Info.plist)
        FirebaseApp.configure()

        // Initialize OneSignal for marketing/engagement push notifications.
        // Transactional pushes ("song ready") continue via native APNs in push-notification.js.
        if let appId = AppConfig.oneSignalAppId {
            OneSignal.initialize(appId)
            #if DEBUG
            OneSignal.Debug.setLogLevel(.LL_VERBOSE)
            #endif
        }

        // Register BGTaskScheduler tasks for periodic background work
        BackgroundTaskRegistrar.registerTasks()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(styleStore)
                .withToasts()
                .task {
                    // Request notification permission on launch
                    do {
                        try await LocalNotificationService.shared.requestAuthorization()
                    } catch {
                        print("[App] Notification permission error: \(error)")
                    }

                    // Check for renders that completed while the app was suspended
                    await JobRecoveryService.checkPendingRenders()
                }
                .onChange(of: scenePhase) { oldPhase, newPhase in
                    // When app enters background, schedule background tasks
                    if newPhase == .background {
                        BackgroundTaskRegistrar.scheduleAppRefresh()
                        // TODO: Only schedule render check if there are rendering tracks
                        // This will be enhanced once we have state access
                    }

                    // When app returns to foreground from background, refresh tokens proactively
                    // This ensures users don't encounter expired tokens after backgrounding the app
                    if newPhase == .active && oldPhase == .background {
                        Task {
                            await authManager.refreshTokensIfNeeded()
                        }
                        // Notify views to refresh their data (e.g., check for completed renders)
                        NotificationCenter.default.post(name: .appReturnedToForeground, object: nil)
                    }
                }
        }
    }
}
