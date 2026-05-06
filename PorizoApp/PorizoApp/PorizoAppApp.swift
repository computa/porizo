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
#if canImport(FacebookCore)
import FacebookCore
#endif
#if canImport(AdServices)
import AdServices
#endif
#if canImport(AppTrackingTransparency)
import AppTrackingTransparency
#endif

/// Reads a placeholder-safe string from Info.plist. Returns empty string if the
/// value is missing or still contains an unresolved `$(VAR)` substitution.
private func infoPlistConfig(_ key: String) -> String {
    let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
    return (raw.isEmpty || raw.contains("$(")) ? "" : raw
}

private enum OneSignalMarketing {
    static func initialize(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        guard let appId = AppConfig.oneSignalAppId else { return }

        #if DEBUG
        OneSignal.Debug.setLogLevel(.LL_VERBOSE)
        #endif

        OneSignal.initialize(appId, withLaunchOptions: launchOptions)
    }
}

#if canImport(FacebookCore)
/// Runtime guard — skips FB SDK init if `PORIZO_FACEBOOK_CLIENT_TOKEN` isn't set in
/// build settings / Info.plist. Prevents "missing client token" NSException crashes
/// in incomplete builds.
private enum FBSDK {
    static var isConfigured: Bool {
        !infoPlistConfig("FacebookClientToken").isEmpty
    }
}
#endif

#if canImport(AdServices)
/// Apple Search Ads attribution helper. Fetches the opaque attribution token from
/// Apple's AdServices framework (iOS 14.3+). The token must be sent to Apple's
/// attribution API (https://api-adservices.apple.com/api/v1/) from your backend
/// to resolve actual campaign metadata. Locally we just capture + post a
/// notification so analytics/backend can pick it up later.
private enum AppleAdsAttribution {
    static func captureTokenIfAvailable() {
        guard #available(iOS 14.3, *) else {
            print("[AppleAds] AdServices requires iOS 14.3+ — skipping")
            return
        }
        do {
            let token = try AAAttribution.attributionToken()
            AppleAdsAttributionService.storePendingToken(token)
            print("[AppleAds] Captured attribution token (\(token.count) chars)")
            NotificationCenter.default.post(
                name: .appleAdsAttributionTokenCaptured,
                object: nil,
                userInfo: ["token": token]
            )
        } catch {
            // This is expected on simulators, devices with no ad engagement, or
            // regions where AdServices is unavailable. Log quietly, do not crash.
            print("[AppleAds] No attribution token available: \(error.localizedDescription)")
        }
    }
}

extension Notification.Name {
    /// Posted once on app launch when Apple's AdServices framework returns an
    /// attribution token. UserInfo contains `"token": String`.
    static let appleAdsAttributionTokenCaptured = Notification.Name("appleAdsAttributionTokenCaptured")
}
#endif

class AppDelegate: NSObject, UIApplicationDelegate {

    // MARK: - App Launch

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        OneSignalMarketing.initialize(launchOptions: launchOptions)

        #if canImport(FacebookCore)
        if FBSDK.isConfigured {
            ApplicationDelegate.shared.application(
                application,
                didFinishLaunchingWithOptions: launchOptions
            )
            print("[FBSDK] Initialized for Meta Ads attribution")
        } else {
            print("[FBSDK] Skipped init — FacebookClientToken not configured in build settings / Info.plist")
        }
        #endif

        #if canImport(AdServices)
        AppleAdsAttribution.captureTokenIfAvailable()
        #endif

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
    @State private var hasBeenBackgrounded = false

    // Appearance preference (System / Light / Dark). Fresh installs default to Light.
    @AppStorage("appearanceMode") private var appearanceMode: String = "Light"

    private var resolvedColorScheme: ColorScheme? {
        switch appearanceMode {
        case "Light": return .light
        case "Dark": return .dark
        default: return nil  // System — follow device setting
        }
    }

    init() {
        // Initialize Firebase core services (Crashlytics + Analytics enabled)
        FirebaseApp.configure()

        // Register BGTaskScheduler tasks for periodic background work
        BackgroundTaskRegistrar.registerTasks()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authManager)
                .environment(styleStore)
                .preferredColorScheme(resolvedColorScheme)

                .withToasts()
                .task {
                    // Wire analytics backend forward once per app launch. Uses
                    // AuthManager's getAccessToken() as the token provider so the
                    // latest valid token is read on every event (including after
                    // token refresh).
                    AnalyticsService.shared.configure(
                        apiBaseURL: AppConfig.apiBaseURL,
                        tokenProvider: { [weak authManager] in
                            guard let authManager else { return nil }
                            return try? await authManager.getAccessToken()
                        }
                    )
                }
                .task {
                    // Request App Tracking Transparency, then propagate the result to FBSDK so
                    // fb_mobile_activate_app events carry IDFA + campaign attribution. Without
                    // this, Meta Events Manager flags "not enough events sent with Campaign ID".
                    #if canImport(AppTrackingTransparency) && canImport(FacebookCore)
                    if FBSDK.isConfigured, #available(iOS 14.5, *) {
                        let status = await ATTrackingManager.requestTrackingAuthorization()
                        let granted = status == .authorized
                        Settings.shared.isAdvertiserIDCollectionEnabled = granted
                        print("[FBSDK] ATT status raw: \(status.rawValue), tracking enabled: \(granted)")
                    }
                    #endif
                }
                .task(id: scenePhase) {
                    // When app enters background, schedule background tasks
                    if scenePhase == .background {
                        hasBeenBackgrounded = true
                        BackgroundTaskRegistrar.scheduleAppRefresh()
                    }

                    if scenePhase == .active {
                        #if canImport(FacebookCore)
                        // Fires fb_mobile_activate_app — the event Meta Ads uses to count sessions
                        // and optimize App Install campaigns. Required on every foreground.
                        if FBSDK.isConfigured {
                            AppEvents.shared.activateApp()
                        }
                        #endif

                        await authManager.refreshTokensIfNeeded()
                        // Only notify views on actual foreground return, not cold start
                        if hasBeenBackgrounded {
                            NotificationCenter.default.post(name: .appReturnedToForeground, object: nil)
                        }
                    }
                }
        }
    }
}
