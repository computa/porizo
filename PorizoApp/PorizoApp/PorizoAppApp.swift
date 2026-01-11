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

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authManager)
                .withToasts()
        }
    }
}
