//
//  PorizoAppApp.swift
//  PorizoApp
//
//  Created by aobimma on 1/1/2026.
//

import SwiftUI

@main
struct PorizoAppApp: App {
    // Auth manager shared across the app
    @StateObject private var authManager = AuthManager()

    // Track app lifecycle for proactive token refresh
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authManager)
                .withToasts()
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
