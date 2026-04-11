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
#if canImport(TikTokBusinessSDK)
import TikTokBusinessSDK
#endif
#if canImport(AdServices)
import AdServices
#endif

/// Reads a placeholder-safe string from Info.plist. Returns empty string if the
/// value is missing or still contains an unresolved `$(VAR)` substitution.
private func infoPlistConfig(_ key: String) -> String {
    let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
    return (raw.isEmpty || raw.contains("$(")) ? "" : raw
}

#if canImport(FacebookCore)
/// Runtime guard — skips FB SDK init if `PORIZO_FACEBOOK_CLIENT_TOKEN` isn't set in
/// xcconfig. Prevents "missing client token" NSException crashes in dev builds.
/// Production builds must set the env var for Meta Ads attribution to work.
private enum FBSDK {
    static var isConfigured: Bool {
        !infoPlistConfig("FacebookClientToken").isEmpty
    }
}
#endif

#if canImport(TikTokBusinessSDK)
/// Runtime guard for TikTok Business SDK. Requires 3 values from TikTok Events
/// Manager → Assets → Events → Web Events → API: access token, app id (bundle id),
/// and the numeric tiktokAppId. Skips init if any are missing.
private enum TikTokBiz {
    static var accessToken: String { infoPlistConfig("PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN") }
    static var appId: String       { infoPlistConfig("PORIZO_TIKTOK_BUSINESS_APP_ID") }
    static var tiktokAppId: String { infoPlistConfig("PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID") }
    static var isConfigured: Bool  { !accessToken.isEmpty && !appId.isEmpty && !tiktokAppId.isEmpty }
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
        #if canImport(FacebookCore)
        if FBSDK.isConfigured {
            ApplicationDelegate.shared.application(
                application,
                didFinishLaunchingWithOptions: launchOptions
            )
            print("[FBSDK] Initialized for Meta Ads attribution")
        } else {
            print("[FBSDK] Skipped init — PORIZO_FACEBOOK_CLIENT_TOKEN not set in xcconfig")
        }
        #endif

        #if canImport(TikTokBusinessSDK)
        if TikTokBiz.isConfigured,
           let config = TikTokConfig(
               accessToken: TikTokBiz.accessToken,
               appId: TikTokBiz.appId,
               tiktokAppId: TikTokBiz.tiktokAppId
           ) {
            TikTokBusiness.initializeSdk(config) { success, error in
                if success {
                    print("[TikTokBiz] Initialized for TikTok Ads attribution")
                } else {
                    print("[TikTokBiz] Init failed: \(error?.localizedDescription ?? "unknown")")
                }
            }
        } else {
            print("[TikTokBiz] Skipped init — PORIZO_TIKTOK_BUSINESS_* keys not set in xcconfig")
        }
        #endif

        #if canImport(AdServices)
        AppleAdsAttribution.captureTokenIfAvailable()
        #endif

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
    @State private var hasBeenBackgrounded = false

    // Appearance preference (System / Light / Dark)
    @AppStorage("appearanceMode") private var appearanceMode: String = "System"

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
                .preferredColorScheme(resolvedColorScheme)

                .withToasts()
                .task {
                    // Request notification permission on launch
                    do {
                        try await LocalNotificationService.shared.requestAuthorization()
                    } catch {
                        print("[App] Notification permission error: \(error)")
                    }
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
