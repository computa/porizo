//
//  AppConfig.swift
//  PorizoApp
//
//  Centralized configuration for API endpoints.
//

import Foundation

enum AppConfig {
    static let apiBaseURL: String = {
        let envValue = ProcessInfo.processInfo.environment["PORIZO_API_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !envValue.isEmpty {
            return envValue
        }

        if let infoValue = Bundle.main.object(forInfoDictionaryKey: "PORIZO_API_BASE_URL") as? String {
            let trimmed = infoValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }

#if DEBUG
#if targetEnvironment(simulator)
        return "http://localhost:3000"
#else
        return "https://api.porizo.co"
#endif
#else
        return "https://api.porizo.co"
#endif
    }()
}
