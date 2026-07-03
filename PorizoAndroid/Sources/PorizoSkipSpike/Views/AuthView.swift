import SwiftUI

/// Sign-in surface (U4d). Renders the AndroidAuthModel phase machine:
/// options → phone entry → verify → profile completion, plus Google and the
/// cross-provider link/account-exists states. Mirrors iOS AuthView.
struct AuthView: View {
    let auth: AndroidAuthModel
    var onCancel: (() -> Void)? = nil

    // Not `private` — Skip Fuse cannot bridge private @State on a bridged View.
    @State var phoneNumber = ""
    @State var code = ""

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    phaseContent
                    if let message = auth.errorMessage {
                        PorizoStatusText(text: message)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 40)
                .padding(.bottom, 32)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            FrauncesTitle(text: "Sign in", size: 34, weight: .bold)
            Text("Save your songs and keep them across devices.")
                .font(.system(size: 15))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
        }
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch auth.phase {
        case .signedOut:
            signInOptions
        case .phoneEntry:
            phoneEntry
        case .phoneVerify(let phone):
            phoneVerify(phone)
        case .profileCompletion(let token, let phone):
            profileCompletion(token: token, phone: phone)
        case .accountExists(let message):
            infoState(title: "Account already exists", detail: message)
        case .linkConfirmation(let idToken, let email):
            linkConfirmation(idToken: idToken, email: email)
        case .authenticated:
            infoState(title: "Signed in", detail: "You're all set.")
        }
    }

    // MARK: options

    private var signInOptions: some View {
        VStack(spacing: 14) {
            PorizoActionButton(
                title: AndroidAppConfig.isGoogleSignInConfigured
                    ? "Continue with Google"
                    : "Google sign-in (coming soon)",
                symbol: "g.circle",
                isDisabled: !AndroidAppConfig.isGoogleSignInConfigured || auth.isWorking
            ) {
                Task { await signInWithGoogle() }
            }

            PorizoActionButton(title: "Continue with phone", symbol: "phone", isDisabled: auth.isWorking) {
                auth.beginPhone()
            }

            if let onCancel {
                Button("Not now", action: onCancel)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .padding(.top, 4)
            }
        }
    }

    // MARK: phone

    private var phoneEntry: some View {
        VStack(alignment: .leading, spacing: 14) {
            PorizoTextInput(title: "Phone number (e.g. +14155551234)", text: $phoneNumber)
            PorizoActionButton(title: "Send code", symbol: "paperplane", isDisabled: auth.isWorking || phoneNumber.trimmed.isEmpty) {
                Task { await auth.sendCode(to: phoneNumber.trimmed) }
            }
        }
    }

    private func phoneVerify(_ phone: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            PorizoStatusText(text: "Enter the code we sent to \(phone).")
            PorizoTextInput(title: "6-digit code", text: $code)
            PorizoActionButton(title: "Verify", symbol: "checkmark.circle", isDisabled: auth.isWorking || code.trimmed.isEmpty) {
                Task { await auth.verifyCode(code.trimmed, phoneNumber: phone) }
            }
        }
    }

    private func profileCompletion(token: String, phone: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            PorizoStatusText(text: "Almost there — finish creating your account.")
            PorizoActionButton(title: "Create account", symbol: "person.crop.circle.badge.plus", isDisabled: auth.isWorking) {
                Task { await auth.completeRegistration(registrationToken: token, phoneNumber: phone) }
            }
        }
    }

    // MARK: google link

    private func linkConfirmation(idToken: String, email: String?) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            infoState(
                title: "Link this Google account?",
                detail: email.map { "An account already exists for \($0). Confirm to link Google to it." }
                    ?? "An account already exists. Confirm to link Google to it."
            )
            PorizoActionButton(title: "Confirm and link", symbol: "link", isDisabled: auth.isWorking) {
                Task { await auth.confirmGoogleLink(idToken: idToken) }
            }
        }
    }

    private func infoState(title: String, detail: String) -> some View {
        PorizoEmptyStateCard(symbol: "info.circle", title: title, detail: detail)
    }

    private func signInWithGoogle() async {
        let provider = AndroidGoogleSignInProvider()
        switch provider.signIn() {
        case .success(let idToken):
            await auth.signInWithGoogle(idToken: idToken)
        case .failure(let error):
            // Surface via the model's error channel by attempting an empty flow;
            // simplest is to reflect it directly.
            auth.setExternalError(error.description)
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
