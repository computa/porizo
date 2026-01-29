//
//  OAuthWebAuthService.swift
//  PorizoApp
//
//  ASWebAuthenticationSession wrapper for OAuth flows.
//

import Foundation
import AuthenticationServices
import UIKit

enum OAuthWebAuthError: LocalizedError {
    case missingCallback
    case cancelled
    case invalidCallback

    var errorDescription: String? {
        switch self {
        case .missingCallback:
            return "Authentication did not return a callback URL."
        case .cancelled:
            return "Authentication was cancelled."
        case .invalidCallback:
            return "Authentication callback was invalid."
        }
    }
}

@MainActor
final class OAuthWebAuthService: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = OAuthWebAuthService()

    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { callbackURL, error in
                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    continuation.resume(throwing: OAuthWebAuthError.cancelled)
                    return
                }

                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let callbackURL else {
                    continuation.resume(throwing: OAuthWebAuthError.missingCallback)
                    return
                }

                continuation.resume(returning: callbackURL)
            }

            session?.presentationContextProvider = self
            session?.prefersEphemeralWebBrowserSession = false
            session?.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = scene.windows.first(where: { $0.isKeyWindow }) {
            return window
        }

        return ASPresentationAnchor()
    }
}
