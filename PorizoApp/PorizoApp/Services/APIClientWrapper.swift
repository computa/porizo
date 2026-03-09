//
//  APIClientWrapper.swift
//  PorizoApp
//
//  Observable wrapper for APIClient actor.
//  Enables SwiftUI environment-based dependency injection while
//  preserving the actor's thread safety guarantees.
//

import SwiftUI

/// Wrapper that makes the APIClient actor accessible via @Environment
///
/// Usage:
/// ```swift
/// // At app root:
/// RootView()
///     .environment(APIClientWrapper(baseURL: serverURL))
///
/// // In child views:
/// @Environment(APIClientWrapper.self) var api
/// let tracks = try await api.client.getTracks()
/// ```
@MainActor
@Observable
final class APIClientWrapper {
    /// The underlying actor-isolated API client
    let client: APIClient

    /// Convenience accessor for the user ID
    var userId: String {
        get async { await client.getUserId() }
    }

    /// Initialize with base URL and optional user ID
    /// - Parameters:
    ///   - baseURL: Server base URL (e.g., AppConfig.apiBaseURL)
    ///   - userId: Optional user ID (generated automatically if nil)
    init(baseURL: String, userId: String? = nil) {
        if let userId {
            self.client = APIClient(baseURL: baseURL, userId: userId)
        } else {
            self.client = APIClient(baseURL: baseURL)
        }
    }

    /// Initialize with an existing APIClient
    /// Useful for migration from prop-drilling pattern
    init(client: APIClient) {
        self.client = client
    }
}
