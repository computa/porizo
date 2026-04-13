//
//  AccountManagementView.swift
//  PorizoApp
//
//  Account management screen — view/manage sign-in methods, contact info, and account actions.
//  Populated from GET /auth/me response. Warm Canvas design system.
//

import SwiftUI
import AuthenticationServices

// MARK: - AccountManagementView

struct AccountManagementView: View {
    let apiClient: APIClient
    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss

    // MARK: - State

    @State private var isLoading = false
    @State private var errorMessage: String?

    // Apple link flow
    @State private var currentNonce: String?
    @State private var isLinkingApple = false
    @State private var appleLinkError: String?

    // Phone link flow
    @State private var showPhoneLinkSheet = false

    // Email verification
    @State private var isSendingVerification = false
    @State private var verificationSent = false

    // Delete account
    @State private var showDeleteConfirmation = false
    @State private var showDeleteFinalConfirmation = false
    @State private var deleteError: String?
    @State private var isDeletingAccount = false

    // MARK: - Computed

    private var user: AuthUser? { authManager.currentUser }

    private var hasApple: Bool {
        user?.authMethods.contains(where: { $0.type == "apple" }) ?? false
    }

    private var hasPhone: Bool {
        user?.authMethods.contains(where: { $0.type == "phone" }) ?? false
    }

    private var emailContact: ContactInfo? {
        user?.contacts.first(where: { $0.type == "email" })
    }

    private var phoneContact: ContactInfo? {
        user?.contacts.first(where: { $0.type == "phone" })
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 16) {
                    profileHeader
                    signInMethodsSection
                    contactInfoSection
                    accountActionsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .refreshable {
                await refreshProfile()
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPhoneLinkSheet) {
            phoneLinkFlow
        }
        .alert("Delete Account?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Continue", role: .destructive) {
                showDeleteFinalConfirmation = true
            }
        } message: {
            Text("This will permanently delete your account and all your data including songs, voice profiles, and settings. This action cannot be undone.")
        }
        .alert("Final Confirmation", isPresented: $showDeleteFinalConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete My Account", role: .destructive) {
                Task { await performAccountDeletion() }
            }
        } message: {
            Text("Are you absolutely sure? All your data will be permanently deleted and cannot be recovered.")
        }
        .alert("Error", isPresented: Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )) {
            Button("OK") { deleteError = nil }
        } message: {
            Text(deleteError ?? "An error occurred")
        }
    }

    // MARK: - Profile Header

    private var profileHeader: some View {
        VStack(spacing: 12) {
            // Avatar circle
            let name = user?.displayName ?? "User"
            let initials = name.split(separator: " ")
                .prefix(2)
                .compactMap { $0.first }
                .map(String.init)
                .joined()

            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 64, height: 64)
                Text(initials.isEmpty ? "?" : initials)
                    .font(DesignTokens.bodyFont(size: 22, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(spacing: 4) {
                Text(name)
                    .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                if let contact = emailContact {
                    HStack(spacing: 4) {
                        Text(contact.valueDisplay ?? "No email")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)

                        if contact.isRelay {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 12))
                                .foregroundStyle(DesignTokens.warning)
                                .accessibilityLabel("Relay address")
                        } else if contact.verified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(DesignTokens.success)
                                .accessibilityLabel("Verified")
                        } else {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(DesignTokens.warning)
                                .accessibilityLabel("Unverified")
                        }
                    }
                } else if let email = user?.primaryEmail ?? user?.email {
                    Text(email)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
    }

    // MARK: - Sign-in Methods Section

    private var signInMethodsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("SIGN-IN METHODS")

            VStack(spacing: 0) {
                // Apple row
                appleSignInRow

                divider

                // Phone row
                phoneSignInRow
            }
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 16))

            // Error banner for Apple linking
            if let error = appleLinkError {
                errorBanner(error) {
                    appleLinkError = nil
                }
                .padding(.top, 8)
            }
        }
    }

    private var appleSignInRow: some View {
        Group {
            if hasApple {
                // Linked state
                let method = user?.authMethods.first(where: { $0.type == "apple" })
                HStack(spacing: 12) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Apple Sign-In")
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.textPrimary)
                        if let masked = method?.subjectMasked {
                            Text(masked)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()

                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.success)
                }
                .padding(.horizontal, 16)
                .frame(height: 56)
            } else {
                // Unlinked — show link button via SignInWithAppleButton
                HStack(spacing: 12) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 28)

                    Text("Add Apple Sign-In")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    if isLinkingApple {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        // Inline Apple button trigger
                        SignInWithAppleButton(.continue) { request in
                            request.requestedScopes = [.email, .fullName]
                            let nonce = randomNonceString()
                            guard !nonce.isEmpty else {
                                currentNonce = nil
                                return
                            }
                            currentNonce = nonce
                            request.nonce = sha256(nonce)
                        } onCompletion: { result in
                            handleAppleLinkResult(result)
                        }
                        .signInWithAppleButtonStyle(.black)
                        .frame(width: 120, height: 36)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: 56)
            }
        }
    }

    private var phoneSignInRow: some View {
        Group {
            if hasPhone {
                let method = user?.authMethods.first(where: { $0.type == "phone" })
                HStack(spacing: 12) {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Phone Number")
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.textPrimary)
                        if let masked = method?.subjectMasked {
                            Text(masked)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()

                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.success)
                }
                .padding(.horizontal, 16)
                .frame(height: 56)
            } else {
                Button {
                    showPhoneLinkSheet = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 28)

                        Text("Add Phone Number")
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Spacer()

                        Text("Add")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(DesignTokens.gold, lineWidth: 1)
                            )
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Contact Info Section

    private var contactInfoSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("CONTACT INFO")

            VStack(spacing: 0) {
                // Email row
                emailRow

                if phoneContact != nil {
                    divider
                    phoneContactRow
                }
            }
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 16))
        }
    }

    private var emailRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope.fill")
                .font(.system(size: 16))
                .foregroundStyle(DesignTokens.textSecondary)
                .frame(width: 28)

            if let contact = emailContact {
                VStack(alignment: .leading, spacing: 2) {
                    Text(contact.valueDisplay ?? "No email")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)

                    if contact.isRelay {
                        Text("Apple relay address")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.warning)
                    }
                }

                Spacer()

                if contact.isRelay {
                    // Relay warning — user should add real email via profile
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.warning)
                } else if contact.verified {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.success)
                } else {
                    // Unverified — offer resend
                    Button {
                        Task { await resendVerification() }
                    } label: {
                        if isSendingVerification {
                            ProgressView()
                                .scaleEffect(0.7)
                        } else if verificationSent {
                            Text("Sent")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundStyle(DesignTokens.success)
                        } else {
                            Text("Verify")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundStyle(DesignTokens.gold)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(DesignTokens.gold, lineWidth: 1)
                                )
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isSendingVerification || verificationSent)
                }
            } else {
                Text("No email on file")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textTertiary)
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 56)
    }

    private var phoneContactRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "phone.fill")
                .font(.system(size: 16))
                .foregroundStyle(DesignTokens.textSecondary)
                .frame(width: 28)

            if let contact = phoneContact {
                Text(contact.valueDisplay ?? "Phone linked")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if contact.verified {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.success)
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 56)
    }

    // MARK: - Account Actions Section

    private var accountActionsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("ACCOUNT")

            VStack(spacing: 0) {
                Button {
                    showDeleteConfirmation = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "trash.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(DesignTokens.error)
                            .frame(width: 28)

                        Text("Delete Account")
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.error)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(DesignTokens.error)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 48)
                }
                .buttonStyle(.plain)
            }
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 16))
        }
    }

    // MARK: - Shared Components

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
            .foregroundStyle(DesignTokens.textTertiary)
            .tracking(1.5)
            .padding(.bottom, 8)
            .padding(.leading, 4)
    }

    private var divider: some View {
        Rectangle()
            .fill(DesignTokens.borderSubtle)
            .frame(height: 1)
            .padding(.leading, 56)
    }

    private func errorBanner(_ message: String, onDismiss: @escaping () -> Void) -> some View {
        HStack(spacing: DesignTokens.spacing8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DesignTokens.error)
            Text(message)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(DesignTokens.spacing12)
        .background(DesignTokens.error.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
    }

    // MARK: - Phone Link Flow

    @ViewBuilder
    private var phoneLinkFlow: some View {
        PhoneLinkFlowView(
            apiClient: apiClient,
            onLinked: {
                showPhoneLinkSheet = false
                Task { await refreshProfile() }
                ToastService.shared.success("Phone number linked")
            },
            onCancel: {
                showPhoneLinkSheet = false
            }
        )
        .environment(authManager)
    }

    // MARK: - Actions

    private func refreshProfile() async {
        do {
            try await authManager.fetchCurrentUser()
        } catch {
            ToastService.shared.show("Could not refresh account info", type: .error)
        }
    }

    private func resendVerification() async {
        isSendingVerification = true
        do {
            try await apiClient.resendEmailVerification()
            verificationSent = true
            ToastService.shared.success("Verification email sent")
        } catch {
            ToastService.shared.error("Could not send verification email")
        }
        isSendingVerification = false
    }

    private func performAccountDeletion() async {
        isDeletingAccount = true
        deleteError = nil
        do {
            try await authManager.deleteAccount()
        } catch {
            deleteError = error.localizedDescription
        }
        isDeletingAccount = false
    }

    // MARK: - Apple Link Handling

    private func handleAppleLinkResult(_ result: Result<ASAuthorization, Error>) {
        Task { @MainActor in
            isLinkingApple = true
            appleLinkError = nil

            switch result {
            case .success(let authorization):
                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                      let identityToken = credential.identityToken,
                      let tokenString = String(data: identityToken, encoding: .utf8) else {
                    appleLinkError = "Invalid Apple credential"
                    isLinkingApple = false
                    return
                }

                guard let nonce = currentNonce else {
                    appleLinkError = "Sign-in session invalid. Please try again."
                    isLinkingApple = false
                    return
                }
                currentNonce = nil

                let authCodeString: String
                if let authorizationCode = credential.authorizationCode,
                   let codeStr = String(data: authorizationCode, encoding: .utf8),
                   !codeStr.isEmpty {
                    authCodeString = codeStr
                } else {
                    authCodeString = ""
                }

                do {
                    let updatedUser = try await apiClient.linkAppleIdentity(
                        idToken: tokenString,
                        nonce: nonce,
                        authorizationCode: authCodeString,
                        providerUserId: credential.user
                    )

                    // Store Apple user ID in Keychain for credential validation on launch
                    if !credential.user.isEmpty {
                        _ = KeychainHelper.saveString(key: "porizo_apple_user_id", value: credential.user)
                    }

                    authManager.updateCurrentUser(updatedUser)
                    ToastService.shared.success("Apple Sign-In linked")
                } catch let apiError as APIClientError {
                    switch apiError {
                    case .serverError(_, let code, _):
                        if code?.contains("E118") == true {
                            appleLinkError = "This Apple ID is already linked to another account."
                        } else if code?.contains("E119") == true {
                            appleLinkError = "The email on this Apple ID belongs to another account."
                        } else {
                            appleLinkError = apiError.localizedDescription
                        }
                    default:
                        appleLinkError = apiError.localizedDescription
                    }
                } catch {
                    appleLinkError = "Failed to link Apple Sign-In. Please try again."
                }

            case .failure(let error):
                // User cancelled — don't show error
                if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                    appleLinkError = "Apple Sign-In was not completed."
                }
                currentNonce = nil
            }

            isLinkingApple = false
        }
    }

}

// MARK: - Phone Link Flow

/// Mini flow for linking a phone number from Account Management.
/// Step 1: PhoneAuthView collects and sends verification code.
/// Step 2: PhoneLinkVerificationView captures the OTP and calls linkPhone directly.
private struct PhoneLinkFlowView: View {
    let apiClient: APIClient
    let onLinked: () -> Void
    let onCancel: () -> Void
    @Environment(AuthManager.self) private var authManager

    @State private var step: PhoneLinkStep = .phoneEntry

    enum PhoneLinkStep {
        case phoneEntry
        case verification(String) // phone number in E.164
    }

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .phoneEntry:
                    PhoneAuthView(
                        onContinue: { phone, _ in
                            step = .verification(phone)
                        },
                        onBack: { onCancel() }
                    )
                    .environment(APIClientWrapper(client: apiClient))

                case .verification(let phone):
                    PhoneLinkVerificationView(
                        phoneNumber: phone,
                        apiClient: apiClient,
                        onLinked: { updatedUser in
                            authManager.updateCurrentUser(updatedUser)
                            onLinked()
                        },
                        onBack: { step = .phoneEntry }
                    )
                }
            }
        }
    }
}

/// Verification view that calls linkPhone instead of verifyPhoneCode.
/// Captures the raw OTP code and passes it to the link endpoint.
private struct PhoneLinkVerificationView: View {
    let phoneNumber: String
    let apiClient: APIClient
    let onLinked: (AuthUser) -> Void
    let onBack: () -> Void

    @State private var code: String = ""
    @State private var isVerifying = false
    @State private var error: String?
    @State private var resendCountdown: Int = 60
    @State private var countdownTask: Task<Void, Never>?

    @FocusState private var isCodeFieldFocused: Bool

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Nav bar
                HStack {
                    Button { onBack() } label: {
                        ZStack {
                            Circle()
                                .fill(Color.black.opacity(0.05))
                                .frame(width: 44, height: 44)
                            Image(systemName: "arrow.left")
                                .font(.system(size: 18))
                                .foregroundStyle(DesignTokens.textPrimary)
                        }
                    }
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, DesignTokens.spacing20)
                .padding(.bottom, DesignTokens.spacing8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Enter verification code")
                                .font(DesignTokens.bodyFont(size: 20, weight: .bold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Sent to \(maskedPhoneDisplay(phoneNumber))")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        // 6-digit code input
                        codeInputDisplay

                        if let error {
                            HStack(spacing: DesignTokens.spacing8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(DesignTokens.error)
                                Text(error)
                                    .font(DesignTokens.bodyFont(size: 14))
                                    .foregroundStyle(DesignTokens.textPrimary)
                            }
                            .padding(DesignTokens.spacing12)
                            .frame(maxWidth: .infinity)
                            .background(DesignTokens.error.opacity(0.1))
                            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
                        }

                        // Link button
                        Button {
                            Task { await linkPhone() }
                        } label: {
                            HStack(spacing: 8) {
                                if isVerifying {
                                    ProgressView().tint(.white)
                                }
                                Text("Link Phone")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                        }
                        .disabled(code.count < 6 || isVerifying)
                        .opacity(code.count < 6 ? 0.5 : 1.0)
                        .buttonStyle(.plain)

                        // Resend
                        resendSection
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, DesignTokens.spacing32)
                }
                .scrollIndicators(.hidden)
            }
        }
        .onAppear { startCountdown() }
        .task { @MainActor in
            await Task.yield()
            isCodeFieldFocused = true
        }
        .onDisappear { countdownTask?.cancel() }
        .onChange(of: code) { _, newValue in
            if newValue.count == 6 {
                Task { await linkPhone() }
            }
        }
    }

    // MARK: - Code Input Display

    private var codeInputDisplay: some View {
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isCodeFieldFocused)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .onChange(of: code) { _, newValue in
                    let filtered = newValue.filter { $0.isNumber }
                    if filtered != newValue || filtered.count > 6 {
                        code = String(filtered.prefix(6))
                    }
                }

            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    Text(index < code.count ? String(code[code.index(code.startIndex, offsetBy: index)]) : "")
                        .font(.system(size: 24, weight: .semibold, design: .monospaced))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 56)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                .stroke(index == code.count && isCodeFieldFocused
                                        ? DesignTokens.gold
                                        : DesignTokens.border,
                                        lineWidth: 1.5)
                        )
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { isCodeFieldFocused = true }
        }
    }

    // MARK: - Resend Section

    private var resendSection: some View {
        HStack(spacing: 16) {
            if resendCountdown == 0 {
                Button {
                    Task { await resendCode() }
                } label: {
                    Text("Resend code")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                }
                .disabled(isVerifying)
            } else {
                Text("Resend in \(resendCountdown)s")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Button { onBack() } label: {
                Text("Wrong number?")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    // MARK: - Actions

    @MainActor
    private func linkPhone() async {
        guard code.count == 6, !isVerifying else { return }
        isVerifying = true
        error = nil

        do {
            let updatedUser = try await apiClient.linkPhone(
                phoneNumber: phoneNumber,
                code: code
            )
            isVerifying = false
            onLinked(updatedUser)
        } catch let apiError as APIClientError {
            isVerifying = false
            code = ""
            switch apiError {
            case .serverError(let message, let errorCode, _):
                if errorCode == "PHONE_ALREADY_LINKED" || errorCode == "E120" {
                    error = "This phone number is already linked to another account."
                } else if message.lowercased().contains("invalid") || message.lowercased().contains("expired") {
                    error = "Invalid or expired code. Please try again."
                } else {
                    error = message
                }
            case .httpError(let statusCode, _):
                if statusCode == 400 {
                    error = "Invalid code. Please try again."
                } else if statusCode == 429 {
                    error = "Too many attempts. Please wait."
                } else {
                    error = "Linking failed. Please try again."
                }
            default:
                error = "Connection error. Please check your network."
            }
        } catch {
            isVerifying = false
            code = ""
            self.error = "Something went wrong. Please try again."
        }
    }

    @MainActor
    private func resendCode() async {
        guard resendCountdown == 0 else { return }
        isVerifying = true
        error = nil

        do {
            _ = try await apiClient.sendPhoneVerificationCode(phoneNumber: phoneNumber)
            isVerifying = false
            startCountdown()
            code = ""
        } catch {
            isVerifying = false
            self.error = "Failed to resend code."
        }
    }

    private func startCountdown() {
        countdownTask?.cancel()
        resendCountdown = 60
        countdownTask = Task {
            while !Task.isCancelled && resendCountdown > 0 {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    if resendCountdown > 0 { resendCountdown -= 1 }
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        AccountManagementView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
            .environment(AuthManager())
    }
}
