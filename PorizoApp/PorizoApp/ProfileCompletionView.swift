import SwiftUI
import UIKit

/// Email-only migration gate for an authenticated legacy account.
/// Phone and display name remain optional profile data and never block app access.
struct ProfileCompletionView: View {
    private static let appleRelayDomains = [
        "@privaterelay.appleid.com",
        "@private.icloud.com",
    ]

    static func isAppleRelayEmail(_ email: String) -> Bool {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appleRelayDomains.contains { normalized.hasSuffix($0) }
    }

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss

    let apiClient: APIClient

    @State private var email = ""
    @State private var errorMessage: String?
    @FocusState private var emailFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    if let presentation = addEmailPresentation {
                        CheckEmailView(
                            context: presentation,
                            state: authManager.magicLoginState,
                            onResend: { resend(to: presentation.email) },
                            onUseDifferentEmail: useDifferentEmail,
                            onRefresh: {
                                await authManager.refreshMagicLoginStatus(
                                    transactionId: presentation.transactionId
                                )
                            }
                        )
                    } else {
                        emailEntry
                    }
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if addEmailPresentation == nil {
                        Button("Not now") {
                            Task { await skipForNow() }
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }
                }
            }
        }
        .onAppear {
            guard !hasVerifiedNonRelayEmail else {
                dismiss()
                return
            }
            prefillEmail()
        }
        .onChange(of: authManager.magicLoginState) { _, state in
            if state == .success {
                dismiss()
            }
            UIAccessibility.post(notification: .announcement, argument: statusAnnouncement(for: state))
        }
    }

    private var emailEntry: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing20) {
            VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                Text("Secure your account")
                    .font(DesignTokens.displayFont(size: 26))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Add an email you can access. This becomes the simplest way to return to your songs and purchases.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                Text("Email")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)

                TextField("your@email.com", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($emailFocused)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .padding(.horizontal, DesignTokens.spacing16)
                    .frame(minHeight: 52)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay {
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.border, lineWidth: 1)
                    }
                    .accessibilityLabel("Email address")

                if Self.isAppleRelayEmail(email) {
                    Text("Enter an email you receive directly, not an Apple private relay address.")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.gold)
                }
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.error)
                    .accessibilityIdentifier("emailUpgradeError")
            }

            Button {
                requestLink()
            } label: {
                Label("Email me a secure link", systemImage: "envelope.fill")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.gold)
            .foregroundStyle(DesignTokens.background)
            .disabled(!hasValidEmail || authManager.magicLoginState == .submitting)
            .accessibilityHint("Sends a verification link that can only be completed on this device")
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing32)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
    }

    private var addEmailPresentation: MagicLoginPresentation? {
        guard authManager.pendingMagicLoginPresentation?.purpose == .addEmail else { return nil }
        return authManager.pendingMagicLoginPresentation
    }

    private var hasValidEmail: Bool {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.contains("@") && normalized.contains(".") && !Self.isAppleRelayEmail(normalized)
    }

    private var hasVerifiedNonRelayEmail: Bool {
        guard let user = authManager.currentUser else { return false }
        if user.hasRealVerifiedEmail { return true }
        guard user.emailVerified, let email = user.email else { return false }
        return !Self.isAppleRelayEmail(email)
    }

    private func requestLink() {
        errorMessage = nil
        emailFocused = false
        Task { @MainActor in
            do {
                try await authManager.requestMagicLogin(email: email, purpose: .addEmail)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func resend(to email: String) {
        self.email = email
        requestLink()
    }

    private func useDifferentEmail() {
        if let pendingEmail = addEmailPresentation?.email {
            email = pendingEmail
        }
        authManager.cancelMagicLogin()
        authManager.resetMagicLoginState()
        emailFocused = true
    }

    private func prefillEmail() {
        guard email.isEmpty else { return }
        let candidate = authManager.currentUser?.primaryEmail ?? authManager.currentUser?.email
        if let candidate, !Self.isAppleRelayEmail(candidate) {
            email = candidate
        }
    }

    private func skipForNow() async {
        do {
            try await apiClient.skipProfileCompletion()
        } catch {
            // Local dismissal remains reversible; the server will present the gate again later.
        }
        authManager.cancelMagicLogin()
        authManager.dismissProfileCompletion()
        dismiss()
    }

    private func statusAnnouncement(for state: MagicLoginState) -> String {
        switch state {
        case .sent, .cooldown: "Verification link sent."
        case .opening, .exchanging: "Verifying email."
        case .success: "Email verified."
        case .expired: "Verification link expired."
        case .offline: "You are offline."
        case .legacyRecovery: "This email belongs to another existing account."
        default: ""
        }
    }
}

#Preview("Email upgrade") {
    ProfileCompletionView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
        .environment(AuthManager())
}
