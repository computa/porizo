import Foundation

struct STTConfig: Codable, Sendable, Equatable {
    let primaryProvider: String
    let fallbackProvider: String
    let whisperkitModel: String
    let providerStatus: [String: String]

    enum CodingKeys: String, CodingKey {
        case primaryProvider = "primary_provider"
        case fallbackProvider = "fallback_provider"
        case whisperkitModel = "whisperkit_model"
        case providerStatus = "provider_status"
    }

    static let `default` = STTConfig(
        primaryProvider: "whisperkit",
        fallbackProvider: "openai",
        whisperkitModel: "small",
        providerStatus: [:]
    )

    func isProviderEnabled(_ providerId: String) -> Bool {
        let status = providerStatus["stt_\(providerId)"] ?? "active"
        return status == "active"
    }
}
