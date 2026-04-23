//
//  APIClient+Billing.swift
//  PorizoApp
//
//  Billing, subscriptions, and app configuration API methods.
//

import Foundation

struct AppConfigLoadContext: Equatable, Sendable {
    let isDebugBuild: Bool
    let isSimulator: Bool

    static let current: AppConfigLoadContext = {
        #if DEBUG
        let isDebugBuild = true
        #else
        let isDebugBuild = false
        #endif

        #if targetEnvironment(simulator)
        let isSimulator = true
        #else
        let isSimulator = false
        #endif

        return AppConfigLoadContext(isDebugBuild: isDebugBuild, isSimulator: isSimulator)
    }()
}

enum AppConfigLoadPolicy {
    static let hostedConfigURL = URL(string: "https://api.porizo.co/app/config")!
    static let localSimulatorConfigURL = URL(string: "http://localhost:3000/app/config")!

    static func fallbackURL(
        after error: Error,
        primaryURL: URL,
        context: AppConfigLoadContext
    ) -> URL? {
        guard context.isDebugBuild, context.isSimulator else {
            return nil
        }

        guard primaryURL == localSimulatorConfigURL else {
            return nil
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .timedOut, .networkConnectionLost, .notConnectedToInternet:
                return hostedConfigURL
            default:
                break
            }
        }

        if case APIClientError.httpError(statusCode: 404, _) = error {
            return hostedConfigURL
        }

        return nil
    }
}

extension APIClient {

    // MARK: - Billing API

    /// Sync an Apple App Store transaction with the backend
    func syncAppleReceipt(transactionId: String) async throws -> SyncReceiptResponse {
        let url = URL(string: "\(baseURL)/billing/receipt/apple")!
        // Idempotency key is stable (derived from deviceUserId + transactionId) — safe to capture outside retry
        let idempotencyKey = "apple_receipt_\(deviceUserId)_\(transactionId)"
        let body = try JSONSerialization.data(withJSONObject: ["transactionId": transactionId])

        // Request construction INSIDE retry so auth token is acquired fresh on each attempt
        return try await withRetry(maxAttempts: 5, initialDelay: 1.0) {
            var request = try await self.makeRequest(url: url, method: "POST")
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
            request.httpBody = body
            let (data, _) = try await self.executeWithAuthRetry(request: request)
            return try self.decodeResponse(SyncReceiptResponse.self, from: data)
        }
    }

    /// Get user's billing entitlements (subscription tier, songs remaining, etc.)
    func getBillingEntitlements() async throws -> BillingEntitlements {
        let url = URL(string: "\(baseURL)/billing/entitlements")!
        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        let result = try decodeResponse(BillingEntitlements.self, from: data)
        print("[Entitlements] tier=\(result.tier) songs=\(result.songsRemaining) poems=\(result.poemsRemaining) allowance=\(result.songsAllowance)")
        return result
    }

    /// Activate a free trial for the user
    func activateTrial() async throws -> ActivateTrialResponse {
        let url = URL(string: "\(baseURL)/billing/trial/activate")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(ActivateTrialResponse.self, from: data)
    }

    /// Get available subscription plans
    func getPlans() async throws -> PlansResponse {
        let url = URL(string: "\(baseURL)/billing/plans")!
        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(PlansResponse.self, from: data)
    }

    /// Get current subscription status
    func getSubscription() async throws -> SubscriptionResponse {
        let url = URL(string: "\(baseURL)/billing/subscription-status")!
        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(SubscriptionResponse.self, from: data)
    }

    // MARK: - App Config

    /// Get app configuration (public endpoint, no auth required)
    func getAppConfig() async throws -> AppConfigResponse {
        let url = URL(string: "\(baseURL)/app/config")!
        do {
            return try await fetchAppConfig(from: url)
        } catch {
            if let fallbackURL = AppConfigLoadPolicy.fallbackURL(
                after: error,
                primaryURL: url,
                context: .current
            ) {
                print("[AppConfig] Local /app/config unavailable at \(url.absoluteString). Falling back to hosted config.")
                return try await fetchAppConfig(from: fallbackURL)
            }
            throw error
        }
    }

    private func fetchAppConfig(from url: URL) async throws -> AppConfigResponse {
        let request = try await makeRequest(url: url, method: "GET", requiresAuth: false)
        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        let decoded = try decodeResponse(AppConfigResponse.self, from: data)
        return decoded.resolvingRelativeURLs(against: url)
    }
}
