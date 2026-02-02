//
//  PorizoAppApp.swift
//  PorizoApp
//
//  Created by aobimma on 1/1/2026.
//

import SwiftUI
import FirebaseCore
import FirebaseCrashlytics

@main
struct PorizoAppApp: App {
    // Auth manager shared across the app
    @StateObject private var authManager = AuthManager()

    // Track app lifecycle for proactive token refresh
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Initialize Firebase for Analytics and Crashlytics
        FirebaseApp.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authManager)
                .withToasts()
                .task {
                    // Request notification permission on launch
                    do {
                        try await LocalNotificationService.shared.requestAuthorization()
                    } catch {
                        print("[App] Notification permission error: \(error)")
                    }
                }
                .onChange(of: scenePhase) { oldPhase, newPhase in
                    // When app returns to foreground from background, refresh tokens proactively
                    // This ensures users don't encounter expired tokens after backgrounding the app
                    if newPhase == .active && oldPhase == .background {
                        Task {
                            await authManager.refreshTokensIfNeeded()
                        }
                    }
                }
        }
    }
}
