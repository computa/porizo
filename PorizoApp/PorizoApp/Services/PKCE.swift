//
//  PKCE.swift
//  PorizoApp
//
//  Proof Key for Code Exchange helper for OAuth flows.
//

import Foundation
import Security
import CryptoKit

struct PKCE {
    static func generate() -> (verifier: String, challenge: String) {
        let verifier = randomURLSafeString(length: 64)
        let challenge = base64URLSHA256(verifier)
        return (verifier, challenge)
    }

    private static func randomURLSafeString(length: Int) -> String {
        let charset = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        var result = ""
        var remaining = length

        while remaining > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
            if status != errSecSuccess {
                break
            }

            for byte in randomBytes where remaining > 0 {
                let index = Int(byte) % charset.count
                result.append(charset[index])
                remaining -= 1
            }
        }

        if result.isEmpty {
            result = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }

        return result
    }

    private static func base64URLSHA256(_ value: String) -> String {
        let data = Data(value.utf8)
        let digest = SHA256.hash(data: data)
        let base64 = Data(digest).base64EncodedString()
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
