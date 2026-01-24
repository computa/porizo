//
//  SettingsTabView.swift
//  PorizoApp
//
//  Settings tab redesigned to match polished competitor apps.
//  Uses grouped sections with rounded containers and consistent row format.
//

import SwiftUI
import StoreKit

// MARK: - Settings Tab View

struct SettingsTabView: View {
    let apiClient: APIClient
    @ObservedObject var storeKit: StoreKitManager
    @EnvironmentObject var authManager: AuthManager

    @State private var showVoiceEnrollment = false
    @State private var showSubscription = false
    @State private var showAuthSheet = false
    @State private var voiceProfileStatus: VoiceProfileStatus?
    @State private var isLoadingProfile = true

    // Credits state
    @State private var entitlements: Entitlements?
    @State private var isLoadingCredits = true

    // Error states
    @State private var voiceProfileError: String?
    @State private var creditsError: String?

    // Account actions
    @State private var showLogoutConfirmation = false
    @State private var showDeleteAccountConfirmation = false
    @State private var showDeleteAccountFinalConfirmation = false
    @State private var deleteAccountError: String?
    @State private var isDeletingAccount = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: DesignTokens.spacing28) {
                    // Voice Banner (top promo)
                    VoiceBanner(
                        hasProfile: voiceProfileStatus?.hasProfile == true,
                        qualityScore: voiceProfileStatus?.qualityScore,
                        isLoading: isLoadingProfile,
                        onTap: { showVoiceEnrollment = true }
                    )

                    // Account Section
                    accountSection

                    // Your Plan Section
                    planSection

                    // Support Section
                    supportSection

                    // Legal Section
                    legalSection

                    // Destructive Actions (only when logged in)
                    if authManager.isAuthenticated {
                        destructiveSection
                    }

                    // App Version Footer
                    AppVersionFooter()
                }
                .padding(.horizontal, DesignTokens.spacing16)
                .padding(.top, DesignTokens.spacing16)
                .padding(.bottom, DesignTokens.spacing28)
            }
            .background(DesignTokens.backgroundSubtle.ignoresSafeArea())
            .navigationTitle("Settings")
            .refreshable {
                await refreshSettings()
            }
            .sheet(isPresented: $showVoiceEnrollment) {
                EnrollmentFlowView(
                    apiClient: apiClient,
                    onComplete: {
                        showVoiceEnrollment = false
                        Task { await loadVoiceProfileAsync() }
                    }
                )
            }
            .sheet(isPresented: $showSubscription) {
                SubscriptionView(storeKit: storeKit)
            }
            .sheet(isPresented: $showAuthSheet) {
                AuthView()
                    .environmentObject(authManager)
            }
            .alert("Sign Out", isPresented: $showLogoutConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Sign Out", role: .destructive) {
                    authManager.logout()
                }
            } message: {
                Text("Are you sure you want to sign out?")
            }
            .alert("Delete Account?", isPresented: $showDeleteAccountConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Continue", role: .destructive) {
                    showDeleteAccountFinalConfirmation = true
                }
            } message: {
                Text("This will permanently delete your account and all your data including songs, voice profiles, and settings. This action cannot be undone.")
            }
            .alert("Final Confirmation", isPresented: $showDeleteAccountFinalConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Delete My Account", role: .destructive) {
                    Task { await performAccountDeletion() }
                }
            } message: {
                Text("Are you absolutely sure? All your data will be permanently deleted and cannot be recovered.")
            }
            .alert("Error", isPresented: .constant(deleteAccountError != nil)) {
                Button("OK") { deleteAccountError = nil }
            } message: {
                Text(deleteAccountError ?? "An error occurred")
            }
            .onAppear {
                Task { await refreshSettings() }
            }
        }
    }

    // MARK: - Account Section

    private var accountSection: some View {
        SettingsSection(header: "Account") {
            if authManager.isAuthenticated, let user = authManager.currentUser {
                // Logged in - show user info
                Button {
                    // Future: navigate to account details
                } label: {
                    HStack(spacing: DesignTokens.spacing12) {
                        AccountAvatar(initials: userInitials(from: user))

                        VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                            Text(user.displayName ?? "User")
                                .font(.body)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text(user.email ?? "")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        if !user.emailVerified {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundColor(DesignTokens.warning)
                        }

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(DesignTokens.textTertiary)
                    }
                    .frame(height: 56)
                    .padding(.horizontal, DesignTokens.spacing16)
                }
                .buttonStyle(SettingsRowButtonStyle())
            } else {
                // Not logged in - show sign in prompt
                Button {
                    showAuthSheet = true
                } label: {
                    HStack(spacing: DesignTokens.spacing12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                                .fill(DesignTokens.roseMuted)
                                .frame(width: 32, height: 32)

                            Image(systemName: "person.fill")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(DesignTokens.rose)
                        }

                        VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                            Text("Sign In")
                                .font(.body)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("Sync your songs across devices")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(DesignTokens.textTertiary)
                    }
                    .frame(height: 56)
                    .padding(.horizontal, DesignTokens.spacing16)
                }
                .buttonStyle(SettingsRowButtonStyle())
            }
        }
    }

    // MARK: - Plan Section

    private var planSection: some View {
        SettingsSection(header: "Your Plan") {
            // Songs remaining
            HStack(spacing: DesignTokens.spacing12) {
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                        .fill(DesignTokens.roseMuted)
                        .frame(width: 32, height: 32)

                    Image(systemName: "music.note")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(DesignTokens.rose)
                }

                Text("Songs Remaining")
                    .font(.body)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                if isLoadingCredits {
                    ProgressView()
                        .scaleEffect(0.8)
                } else if let ent = entitlements {
                    Text(ent.remainingText)
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.rose)
                } else if creditsError != nil {
                    Button {
                        Task { await loadCreditsAsync() }
                    } label: {
                        HStack(spacing: DesignTokens.spacing4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(DesignTokens.warning)
                            Text("Retry")
                                .foregroundColor(DesignTokens.rose)
                        }
                        .font(.caption)
                    }
                }
            }
            .frame(height: 56)
            .padding(.horizontal, DesignTokens.spacing16)
            .overlay(alignment: .bottom) {
                Divider().padding(.leading, 60)
            }

            // Upgrade to Pro (if not on pro)
            if storeKit.subscriptionState.tier != "pro" {
                SettingsRow(
                    icon: "star.fill",
                    iconBackground: Color(hex: "#fef3c7"), // amber-100
                    iconColor: Color(hex: "#f59e0b"),      // amber-500
                    title: "Upgrade to Pro",
                    subtitle: "Get more songs & features"
                ) {
                    showSubscription = true
                }
            }

            // Restore purchases
            SettingsRow(
                icon: "arrow.clockwise",
                title: "Restore Purchases",
                showDivider: false
            ) {
                Task { await storeKit.restore() }
            }
        }
    }

    // MARK: - Support Section

    private var supportSection: some View {
        SettingsSection(header: "Support") {
            SettingsLinkRow(
                icon: "questionmark.circle.fill",
                title: "Help Center",
                url: URL(string: "https://porizo.co/help")!
            )

            SettingsLinkRow(
                icon: "envelope.fill",
                title: "Contact Us",
                url: URL(string: "mailto:support@porizo.co")!
            )

            // Rate Us
            SettingsRow(
                icon: "star.fill",
                iconBackground: Color(hex: "#fef3c7"),
                iconColor: Color(hex: "#f59e0b"),
                title: "Rate Us"
            ) {
                requestAppReview()
            }

            // Share App
            SettingsRow(
                icon: "square.and.arrow.up.fill",
                title: "Share App",
                showDivider: false
            ) {
                shareApp()
            }
        }
    }

    // MARK: - Legal Section

    private var legalSection: some View {
        SettingsSection(header: "Legal") {
            SettingsLinkRow(
                icon: "hand.raised.fill",
                title: "Privacy Policy",
                url: URL(string: "https://porizo.co/privacy")!
            )

            SettingsLinkRow(
                icon: "doc.text.fill",
                title: "Terms of Service",
                url: URL(string: "https://porizo.co/terms")!,
                showDivider: false
            )
        }
    }

    // MARK: - Destructive Section

    private var destructiveSection: some View {
        SettingsSection {
            SettingsRow(
                icon: "rectangle.portrait.and.arrow.right",
                title: "Sign Out",
                isDestructive: true,
                showChevron: false
            ) {
                showLogoutConfirmation = true
            }

            SettingsRow(
                icon: "trash.fill",
                title: "Delete Account",
                isDestructive: true,
                showDivider: false
            ) {
                showDeleteAccountConfirmation = true
            }
        }
    }

    // MARK: - Helper Functions

    private func userInitials(from user: AuthUser) -> String {
        if let name = user.displayName, !name.isEmpty {
            let parts = name.components(separatedBy: " ")
            let initials = parts.prefix(2).compactMap { $0.first }.map { String($0).uppercased() }
            return initials.joined()
        }
        if let email = user.email {
            return String(email.prefix(1)).uppercased()
        }
        return "?"
    }

    private func refreshSettings() async {
        async let profile: () = loadVoiceProfileAsync()
        async let credits: () = loadCreditsAsync()
        _ = await (profile, credits)
    }

    private func loadVoiceProfileAsync() async {
        isLoadingProfile = true
        voiceProfileError = nil
        do {
            let status = try await apiClient.getVoiceProfile()
            voiceProfileStatus = status
        } catch {
            voiceProfileError = "Couldn't load voice profile"
        }
        isLoadingProfile = false
    }

    private func loadCreditsAsync() async {
        isLoadingCredits = true
        creditsError = nil
        do {
            let response = try await apiClient.getEntitlements()
            entitlements = response.entitlements
        } catch {
            creditsError = "Couldn't load credits"
        }
        isLoadingCredits = false
    }

    private func performAccountDeletion() async {
        isDeletingAccount = true
        deleteAccountError = nil
        do {
            try await authManager.deleteAccount()
        } catch {
            deleteAccountError = error.localizedDescription
        }
        isDeletingAccount = false
    }

    private func requestAppReview() {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        SKStoreReviewController.requestReview(in: scene)
    }

    private func shareApp() {
        let url = URL(string: "https://apps.apple.com/app/porizo/id123456789")!
        let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)

        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              let rootVC = scene.windows.first?.rootViewController else { return }

        rootVC.present(activityVC, animated: true)
    }
}

// MARK: - Preview

#Preview {
    let apiClient = APIClient(baseURL: AppConfig.apiBaseURL)
    SettingsTabView(
        apiClient: apiClient,
        storeKit: StoreKitManager(apiClient: apiClient)
    )
    .environmentObject(AuthManager())
}
