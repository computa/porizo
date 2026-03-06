//
//  APIClient+Billing.swift
//  PorizoApp
//
//  Billing, subscriptions, and app configuration API methods.
//

import Foundation

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
        return try decodeResponse(BillingEntitlements.self, from: data)
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
        let request = try await makeRequest(url: url, method: "GET", requiresAuth: false)
        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try decodeResponse(AppConfigResponse.self, from: data)
    }
}
