//
//  APIClient+Analytics.swift
//  PorizoApp
//
//  Attribution and analytics endpoints.
//

import Foundation

struct AppleAdsAttributionResponse: Decodable {
    struct Attribution: Decodable {
        let id: String
        let userId: String
        let status: String
        let apiStatusCode: Int?
        let campaignId: Int?
        let adGroupId: Int?
        let keywordId: Int?
        let orgId: Int?
        let conversionType: String?
        let countryOrRegion: String?
        let clickDate: String?
        let impressionDate: String?
        let isRedownload: Bool?
        let lastError: String?
        let createdAt: String
        let updatedAt: String
        let resolvedAt: String?

        enum CodingKeys: String, CodingKey {
            case id
            case userId = "user_id"
            case status
            case apiStatusCode = "api_status_code"
            case campaignId = "campaign_id"
            case adGroupId = "ad_group_id"
            case keywordId = "keyword_id"
            case orgId = "org_id"
            case conversionType = "conversion_type"
            case countryOrRegion = "country_or_region"
            case clickDate = "click_date"
            case impressionDate = "impression_date"
            case isRedownload = "is_redownload"
            case lastError = "last_error"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case resolvedAt = "resolved_at"
        }
    }

    let attribution: Attribution
    let deduped: Bool
}

extension APIClient {
    func submitAppleAdsAttributionToken(_ token: String) async throws -> AppleAdsAttributionResponse {
        struct RequestBody: Encodable {
            let attributionToken: String
        }

        let url = URL(string: "\(baseURL)/analytics/apple-ads-attribution")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(
            RequestBody(attributionToken: token.trimmingCharacters(in: .whitespacesAndNewlines))
        )

        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(AppleAdsAttributionResponse.self, from: data)
    }
}
