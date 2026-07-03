import Foundation
import Observation
import SkipFuse

/// App-wide authentication state (U4b). @Observable + @MainActor so SwiftUI/
/// Compose track it and all mutation is main-actor isolated. Wraps AuthLogic
/// (the tested pure decisions) and drives AndroidAPIClient.
@MainActor
@Observable
final class AndroidAuthModel {

    /// Where the user is in the auth flow.
    enum Phase: Equatable {
        case signedOut
        case phoneEntry
        case phoneVerify(phoneNumber: String)
        case profileCompletion(registrationToken: String, phoneNumber: String)
        case accountExists(message: String)
        case linkConfirmation(idToken: String, email: String?)
        case authenticated(userId: String)
    }

    private(set) var phase: Phase = .signedOut
    private(set) var isWorking = false
    private(set) var errorMessage: String?

    var isAuthenticated: Bool {
        if case .authenticated = phase { return true }
        return false
    }

    private let apiClient: AndroidAPIClient
    private let sessionStore: AndroidSessionStore

    init(
        apiClient: AndroidAPIClient = AndroidAPIClient(),
        sessionStore: AndroidSessionStore = AndroidSessionStore()
    ) {
        self.apiClient = apiClient
        self.sessionStore = sessionStore
    }

    /// Restore session on launch: if a stored session exists, treat as
    /// authenticated (a real /auth/me validation happens lazily on first use).
    func restore() {
        if let session = sessionStore.loadAuthSession(), !session.userId.isEmpty {
            phase = .authenticated(userId: session.userId)
        } else {
            phase = .signedOut
        }
    }

    // MARK: - Phone

    func beginPhone() { phase = .phoneEntry; errorMessage = nil }

    func sendCode(to phoneNumber: String) async {
        await run {
            _ = try await self.apiClient.sendPhoneVerificationCode(phoneNumber: phoneNumber)
            self.phase = .phoneVerify(phoneNumber: phoneNumber)
        }
    }

    func verifyCode(_ code: String, phoneNumber: String) async {
        await run {
            let response = try await self.apiClient.verifyPhoneCode(phoneNumber: phoneNumber, code: code)
            switch AuthLogic.phoneVerifyOutcome(response) {
            case .authenticated(let userId, _, _):
                self.phase = .authenticated(userId: userId)
            case .needsRegistration(let regToken):
                self.phase = .profileCompletion(registrationToken: regToken, phoneNumber: phoneNumber)
            case .rejected(let remaining):
                let suffix = remaining.map { " (\($0) attempts left)" } ?? ""
                self.errorMessage = "That code didn't match.\(suffix)"
            }
        }
    }

    func completeRegistration(registrationToken: String, phoneNumber: String) async {
        await run {
            let session = try await self.apiClient.registerPhoneAccount(
                registrationToken: registrationToken, phoneNumber: phoneNumber
            )
            self.phase = .authenticated(userId: session.userId)
        }
    }

    // MARK: - Google

    /// Complete a Google sign-in given an ID token from the native bridge.
    /// Handles the requires_link_confirmation two-step.
    func signInWithGoogle(idToken: String, name: String? = nil, confirmLink: Bool = false) async {
        await run {
            let response = try await self.apiClient.socialLogin(
                provider: "google", idToken: idToken, name: name, confirmLink: confirmLink
            )
            if response.requiresLinkConfirmation == true {
                self.phase = .linkConfirmation(idToken: idToken, email: response.existingAccountEmail)
                return
            }
            guard let userId = response.userId else {
                self.errorMessage = "Google sign-in did not return an account."
                return
            }
            self.phase = .authenticated(userId: userId)
        }
    }

    func confirmGoogleLink(idToken: String) async {
        await signInWithGoogle(idToken: idToken, confirmLink: true)
    }

    // MARK: - Logout

    func logout() async {
        await apiClient.logout()
        phase = .signedOut
    }

    // MARK: - helpers

    /// Run an auth action with isWorking/error handling, mirroring the spike's
    /// catch-into-status convention but routed through structured state.
    private func run(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
