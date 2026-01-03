//
//  APIClientWrapper.swift
//  PorizoApp
//
//  ObservableObject wrapper for APIClient actor.
//  Enables SwiftUI environment-based dependency injection while
//  preserving the actor's thread safety guarantees.
//

import SwiftUI
import Combine

/// Wrapper that makes the APIClient actor accessible via @EnvironmentObject
///
/// Usage:
/// ```swift
/// // At app root:
/// RootView()
///     .environmentObject(APIClientWrapper(baseURL: serverURL))
///
/// // In child views:
/// @EnvironmentObject var api: APIClientWrapper
/// let tracks = try await api.client.getTracks()
/// ```
final class APIClientWrapper: ObservableObject {
    /// Required publisher for ObservableObject conformance
    /// The client is immutable so this never fires, but SwiftUI requires it
    let objectWillChange = ObservableObjectPublisher()

    /// The underlying actor-isolated API client
    let client: APIClient

    /// Convenience accessor for the user ID
    var userId: String {
        get async { await client.getUserId() }
    }

    /// Initialize with base URL and optional user ID
    /// - Parameters:
    ///   - baseURL: Server base URL (e.g., "http://localhost:3000")
    ///   - userId: Optional user ID (generated automatically if nil)
    @MainActor
    init(baseURL: String, userId: String? = nil) {
        if let userId {
            self.client = APIClient(baseURL: baseURL, userId: userId)
        } else {
            self.client = APIClient(baseURL: baseURL)
        }
    }

    /// Initialize with an existing APIClient
    /// Useful for migration from prop-drilling pattern
    @MainActor
    init(client: APIClient) {
        self.client = client
    }
}

// MARK: - Environment Key

private struct APIClientWrapperKey: EnvironmentKey {
    static let defaultValue: APIClientWrapper? = nil
}

extension EnvironmentValues {
    /// Access APIClientWrapper through the environment
    ///
    /// Note: Use @EnvironmentObject for ObservableObject access.
    /// This key is for non-view contexts that need the client.
    var apiClientWrapper: APIClientWrapper? {
        get { self[APIClientWrapperKey.self] }
        set { self[APIClientWrapperKey.self] = newValue }
    }
}
