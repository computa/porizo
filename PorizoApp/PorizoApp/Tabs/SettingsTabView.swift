//
//  SettingsTabView.swift
//  PorizoApp
//
//  Settings tab matching v1.pen "12 - Settings" design.
//  Velvet & Gold design system with custom header and flat card layout.
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
    @State private var showV1Screens = false
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

    // Theme picker
    @State private var showThemePicker = false
    @AppStorage("appTheme") private var appTheme: AppTheme = .system

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header (v1.pen design)
                settingsHeader

                ScrollView {
                    VStack(spacing: 16) {
                        // Voice Banner (promotional - keep from existing)
                        VoiceBanner(
                            hasProfile: voiceProfileStatus?.hasProfile == true,
                            qualityScore: voiceProfileStatus?.qualityScore,
                            isLoading: isLoadingProfile,
                            onTap: { showVoiceEnrollment = true }
                        )

                        // Main settings card (v1.pen: single container)
                        settingsCard

                        // Footer
                        Text("PORIZO • 2026 • v1.0.0")
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundColor(DesignTokens.textTertiary)
                            .tracking(1)
                            .padding(.top, 16)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 120) // Space for tab bar
                }
                .refreshable {
                    await refreshSettings()
                }
            }
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
            SubscriptionView(apiClient: apiClient, storeKit: storeKit)
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthView()
                .environmentObject(authManager)
                .environmentObject(APIClientWrapper(client: apiClient))
        }
        .sheet(isPresented: $showV1Screens) {
            V1ScreenCatalogView(apiClient: apiClient)
                .environmentObject(authManager)
        }
        .sheet(isPresented: $showThemePicker) {
            ThemePickerSheet(
                selectedTheme: $appTheme,
                onDismiss: { showThemePicker = false }
            )
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

    // MARK: - Header (v1.pen design)

    private var settingsHeader: some View {
        HStack {
            Text("Profile")
                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }

    // MARK: - Settings Card (v1.pen: single container)

    private var settingsCard: some View {
        VStack(spacing: 0) {
            // Account Section
            accountSection

            // Subscription Row
            subscriptionRow

            // Preferences Section
            preferencesSection

            // More Section
            moreSection

            // Danger Section (only when logged in)
            if authManager.isAuthenticated {
                dangerSection
            }
        }
        .background(DesignTokens.surface)
        .cornerRadius(16)
    }

    // MARK: - Account Section

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            Text("ACCOUNT")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
                .tracking(1)

            // Account row
            if authManager.isAuthenticated, let user = authManager.currentUser {
                Button {
                    // Future: navigate to account details
                } label: {
                    HStack(spacing: 12) {
                        // Avatar
                        ZStack {
                            Circle()
                                .fill(Color(hex: "#333333"))
                                .frame(width: 40, height: 40)

                            Image(systemName: "person.fill")
                                .font(.system(size: 16))
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        // User info
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName ?? "User")
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                            Text(user.email ?? "")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        // Chevron
                        Text("›")
                            .font(.system(size: 24))
                            .foregroundColor(DesignTokens.textTertiary)
                    }
                    .padding(.vertical, 12)
                }
                .buttonStyle(.plain)
            } else {
                // Not logged in
                Button {
                    showAuthSheet = true
                } label: {
                    HStack(spacing: 12) {
                        // Avatar placeholder
                        ZStack {
                            Circle()
                                .fill(Color(hex: "#333333"))
                                .frame(width: 40, height: 40)

                            Image(systemName: "person.fill")
                                .font(.system(size: 16))
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        // Sign in prompt
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Sign In")
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("Sync your songs across devices")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        // Chevron
                        Text("›")
                            .font(.system(size: 24))
                            .foregroundColor(DesignTokens.textTertiary)
                    }
                    .padding(.vertical, 12)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Subscription Row

    private var subscriptionRow: some View {
        Button {
            showSubscription = true
        } label: {
            HStack(spacing: 12) {
                // Crown icon
                Image(systemName: "crown.fill")
                    .font(.system(size: 18))
                    .foregroundColor(DesignTokens.textSecondary)

                Text("My Subscription")
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                // Upgrade button (if not pro)
                if storeKit.subscriptionState.tier != "pro" {
                    Text("Upgrade now")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(DesignTokens.gold, lineWidth: 1)
                        )
                } else {
                    Text("›")
                        .font(.system(size: 20))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
            .frame(height: 44)
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }

    // MARK: - Preferences Section

    private var preferencesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Section header
            Text("PREFERENCES")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
                .tracking(1)
                .padding(.bottom, 8)

            // Notifications row
            settingsRow(
                icon: "bell.fill",
                title: "Notifications",
                showChevron: true
            ) {
                // TODO: Navigate to notifications settings
            }

            // Appearance row
            Button {
                showThemePicker = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "paintpalette.fill")
                        .font(.system(size: 17))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(width: 20)

                    Text("Appearance")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundColor(DesignTokens.textPrimary)

                    Spacer()

                    Text(appTheme.displayName)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)

                    Text("›")
                        .font(.system(size: 18))
                        .foregroundColor(DesignTokens.textTertiary)
                }
                .frame(height: 44)
            }
            .buttonStyle(.plain)

            // Language row
            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 17))
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text("Language")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Text("English")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)

                Text("›")
                    .font(.system(size: 18))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .frame(height: 44)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }

    // MARK: - More Section

    private var moreSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Section header
            Text("MORE")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
                .tracking(1)
                .padding(.bottom, 8)

            // Invite a Friend
            settingsRow(
                icon: "person.badge.plus.fill",
                title: "Invite a Friend",
                showChevron: true
            ) {
                shareApp()
            }

            // Terms of Use (external link)
            settingsLinkRow(
                icon: "doc.text.fill",
                title: "Terms of Use",
                url: URL(string: "https://porizo.co/terms")!
            )

            // Privacy Policy (external link)
            settingsLinkRow(
                icon: "shield.fill",
                title: "Privacy Policy",
                url: URL(string: "https://porizo.co/privacy")!
            )

            // Restore Purchases
            settingsRow(
                icon: "arrow.counterclockwise",
                title: "Restore Purchases",
                showChevron: true
            ) {
                Task { await storeKit.restore() }
            }

            // Design Preview (v1.pen screens)
            settingsRow(
                icon: "rectangle.stack",
                title: "Design Screens",
                showChevron: true
            ) {
                showV1Screens = true
            }

            // Get Support (external link)
            settingsLinkRow(
                icon: "bubble.left.fill",
                title: "Get Support",
                url: URL(string: "mailto:support@porizo.co")!
            )
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }

    // MARK: - Danger Section

    private var dangerSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Log out
            Button {
                showLogoutConfirmation = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 17))
                        .foregroundColor(Color(hex: "#EF4444"))
                        .frame(width: 20)

                    Text("Log out")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundColor(Color(hex: "#EF4444"))

                    Spacer()
                }
                .frame(height: 44)
            }
            .buttonStyle(.plain)

            // Delete Account
            Button {
                showDeleteAccountConfirmation = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "trash.fill")
                        .font(.system(size: 17))
                        .foregroundColor(Color(hex: "#EF4444"))
                        .frame(width: 20)

                    Text("Delete Account")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundColor(Color(hex: "#EF4444"))

                    Spacer()

                    Text("›")
                        .font(.system(size: 18))
                        .foregroundColor(Color(hex: "#EF4444"))
                }
                .frame(height: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }

    // MARK: - Row Helpers

    private func settingsRow(
        icon: String,
        title: String,
        showChevron: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17))
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text(title)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                if showChevron {
                    Text("›")
                        .font(.system(size: 18))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
            .frame(height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func settingsLinkRow(
        icon: String,
        title: String,
        url: URL
    ) -> some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17))
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text(title)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                // External link indicator
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .frame(height: 44)
        }
        .accessibilityLabel("\(title), opens in browser")
    }

    // MARK: - Helper Functions

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
