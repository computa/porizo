//
//  APIClient+Gifts.swift
//  PorizoApp
//
//  Gift scheduling + wallet API methods.
//

import Foundation

extension APIClient {

    // MARK: - Gift Wallet

    /// Fetch gift wallet balance and recent transactions
    func getGiftWallet(limit: Int = 20) async throws -> GiftWalletResponse {
        var components = URLComponents(string: "\(baseURL)/billing/gift-wallet")!
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100)))
        ]
        let request = try await makeRequest(url: components.url!, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(GiftWalletResponse.self, from: data)
    }

    /// Sync one-off consumable purchase for a gift token
    func syncAppleGiftConsumable(transactionId: String) async throws -> GiftConsumableSyncResponse {
        let url = URL(string: "\(baseURL)/billing/receipt/apple/consumable")!
        let idempotencyKey = "apple_gift_consumable_\(deviceUserId)_\(transactionId)"
        let body = try JSONSerialization.data(withJSONObject: ["transactionId": transactionId])

        // Request construction INSIDE retry so auth token is acquired fresh on each attempt
        return try await withRetry(maxAttempts: 5, initialDelay: 1.0) {
            var request = try await self.makeRequest(url: url, method: "POST")
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
            request.httpBody = body
            let (data, _) = try await self.executeWithAuthRetry(request: request)
            return try self.decodeResponse(GiftConsumableSyncResponse.self, from: data)
        }
    }

    // MARK: - Gifts

    func createGiftReservation(idempotencyKey: String) async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(CreateGiftReservationRequest(flowType: "gift"))
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(GiftReservationResponse.self, from: data)
    }

    func getActiveGiftReservation() async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/active")!
        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(GiftReservationResponse.self, from: data)
    }

    func attachGiftReservationContent(
        reservationId: String,
        contentType: String,
        contentId: String,
        versionNum: Int?
    ) async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/content")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(AttachGiftReservationContentRequest(
            contentType: contentType,
            contentId: contentId,
            versionNum: versionNum
        ))
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(GiftReservationResponse.self, from: data)
    }

    func finalizeGiftReservation(
        reservationId: String,
        request finalizeRequest: FinalizeGiftReservationRequest,
        idempotencyKey: String
    ) async throws -> CreateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/finalize")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(finalizeRequest)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(CreateGiftResponse.self, from: data)
    }

    func cancelGiftReservation(reservationId: String) async throws -> CancelGiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/cancel")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(CancelGiftReservationResponse.self, from: data)
    }

    func createGift(request giftRequest: CreateGiftRequest, idempotencyKey: String) async throws -> CreateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(giftRequest)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(CreateGiftResponse.self, from: data)
    }

    func getGifts(status: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> GetGiftsResponse {
        var components = URLComponents(string: "\(baseURL)/gifts")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100))),
            URLQueryItem(name: "offset", value: String(max(offset, 0)))
        ]
        if let status, !status.isEmpty {
            queryItems.append(URLQueryItem(name: "status", value: status))
        }
        components.queryItems = queryItems
        let request = try await makeRequest(url: components.url!, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(GetGiftsResponse.self, from: data)
    }

    func updateGift(giftId: String, updates: UpdateGiftRequest) async throws -> UpdateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/\(giftId)")!
        var request = try await makeRequest(url: url, method: "PATCH")
        request.httpBody = try JSONEncoder().encode(updates)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(UpdateGiftResponse.self, from: data)
    }

    func cancelGift(giftId: String) async throws -> CancelGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/\(giftId)/cancel")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)
        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(CancelGiftResponse.self, from: data)
    }
}
