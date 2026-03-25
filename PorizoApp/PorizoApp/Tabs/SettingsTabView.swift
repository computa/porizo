//
//  SettingsTabView.swift
//  PorizoApp
//
//  Settings tab matching v1.pen "12 - Settings" design.
//  Velvet & Gold design system with custom header and flat card layout.
//

import SwiftUI

// MARK: - Settings Tab View

struct SettingsTabView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    @Environment(AuthManager.self) var authManager
    @State private var apiWrapper: APIClientWrapper

    init(apiClient: APIClient, storeKit: StoreKitManager) {
        self.apiClient = apiClient
        self.storeKit = storeKit
        self._apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
    }

    @State private var activeVoiceEnrollment: VoiceEnrollmentDestination?
    @State private var queuedVoiceEnrollment: VoiceEnrollmentDestination?
    @State private var showSubscription = false
    @State private var showAuthSheet = false
    @State private var showV1Screens = false
    @State private var showDesignVariants = false
    @State private var showLyricsRedesign = false
    @State private var showCreationFlowRedesign = false
    @AppStorage("useUnifiedCreateFlow") private var useUnifiedFlow = AppConfig.useUnifiedCreateFlow
    @State private var showDesignScreensFlag = false
    @State private var voiceProfileStatus: VoiceProfileStatus?
    @State private var isLoadingProfile = true

    // Credits state
    @State private var entitlements: BillingEntitlements?
    @State private var isLoadingCredits = true

    // Error states
    @State private var voiceProfileError: String?
    @State private var creditsError: String?

    // Gift bag
    @State private var activeGiftSheet: GiftSheetDestination?
    @State private var queuedGiftSheet: GiftSheetDestination?
    @State private var giftWalletBalance: Int?

    // Account actions
    @State private var showLogoutConfirmation = false
    @State private var showDeleteAccountConfirmation = false
    @State private var showDeleteAccountFinalConfirmation = false
    @State private var deleteAccountError: String?
    @State private var isDeletingAccount = false

    // Theme picker
    @State private var showThemePicker = false
    @AppStorage("appTheme") private var appTheme: AppTheme = .system
    @AppStorage("lyricsStyle") private var lyricsStyle: LyricsDesignStyle = .karaokeSweep

    // (loadTask removed — .task auto-cancels on disappear)

    private enum VoiceEnrollmentDestination: Identifiable {
        case profile(VoiceProfileStatus)
        case enroll(existingScore: Double?)

        var id: String {
            switch self {
            case .profile:
                return "profile"
            case .enroll(let existingScore):
                return "enroll-\(existingScore ?? -1)"
            }
        }
    }

    private enum GiftSheetDestination: String, Identifiable {
        case bag
        case send

        var id: String { rawValue }
    }

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
                            onTap: { presentVoiceEnrollment() }
                        )

                        // Main settings card (v1.pen: single container)
                        settingsCard

                        // Footer
                        Text({
                            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
                            let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
                            return "PORIZO • 2026 • v\(version) (\(build))"
                        }())
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.textTertiary)
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
        .sheet(item: $activeVoiceEnrollment, onDismiss: {
            if let queuedVoiceEnrollment {
                activeVoiceEnrollment = queuedVoiceEnrollment
                self.queuedVoiceEnrollment = nil
            }
        }) { destination in
            switch destination {
            case .profile(let profile):
                VoiceProfileView(
                    profile: profile,
                    onTryAgain: {
                        queuedVoiceEnrollment = .enroll(existingScore: profile.qualityScore)
                        activeVoiceEnrollment = nil
                    },
                    onDismiss: { activeVoiceEnrollment = nil }
                )
            case .enroll(let existingScore):
                EnrollmentFlowView(
                    apiClient: apiClient,
                    existingScore: existingScore,
                    onComplete: {
                        activeVoiceEnrollment = nil
                        Task { await loadVoiceProfileAsync() }
                    }
                )
            }
        }
        .sheet(isPresented: $showSubscription) {
            SubscriptionView(apiClient: apiClient, storeKit: storeKit)
        }
        .sheet(item: $activeGiftSheet, onDismiss: {
            if let queuedGiftSheet {
                activeGiftSheet = queuedGiftSheet
                self.queuedGiftSheet = nil
            }
        }) { destination in
            switch destination {
            case .bag:
                GiftBagView(
                    apiClient: apiClient,
                    storeKit: storeKit,
                    onSendGift: {
                        queuedGiftSheet = .send
                        activeGiftSheet = nil
                    }
                )
            case .send:
                GiftSendFlowView(
                    apiClient: apiClient,
                    storeKit: storeKit,
                    onComplete: { activeGiftSheet = nil },
                    onCancel: { activeGiftSheet = nil }
                )
            }
        }
        .sheet(isPresented: $showAuthSheet) {
            AuthView()
                .environment(authManager)
                .environment(apiWrapper)
        }
        .sheet(isPresented: $showV1Screens) {
            V1ScreenCatalogView(apiClient: apiClient)
                .environment(authManager)
        }
        #if DEBUG
        .sheet(isPresented: $showDesignVariants) {
            DesignSampleView()
        }
        .sheet(isPresented: $showCreationFlowRedesign) {
            CreationFlowPickerView()
        }
        .sheet(isPresented: $showLyricsRedesign) {
            NavigationStack {
                List {
                    Section("Lyrics Redesign") {
                        NavigationLink("A - Spotlight") { LyricsOptionView(style: .spotlight) }
                        NavigationLink("B - Karaoke Sweep") { LyricsOptionView(style: .karaokeSweep) }
                        NavigationLink("C - Verse Stage") { LyricsOptionView(style: .verseStage) }
                    }
                    .listRowBackground(DesignTokens.surface)
                }
                .scrollContentBackground(.hidden)
                .background(DesignTokens.background)
                .navigationTitle("Lyrics Redesign")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        #endif
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
        .task {
            await refreshSettings()
        }
    }

    // MARK: - Header (v1.pen design)

    private var settingsHeader: some View {
        HStack {
            Text("Profile")
                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

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
            if AppConfig.enableSubscriptionsUI {
                subscriptionRow
            }

            // Gift Bag Row
            if AppConfig.enableGiftPurchaseUI {
                giftBagRow
            }

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
        .clipShape(.rect(cornerRadius: 16))
    }

    // MARK: - Account Section

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            Text("ACCOUNT")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
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
                                .fill(DesignTokens.borderSubtle)
                                .frame(width: 40, height: 40)

                            Image(systemName: "person.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        // User info
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName ?? "User")
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text(user.email ?? "")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        Spacer()

                        // Chevron
                        Text("›")
                            .font(.system(size: 24))
                            .foregroundStyle(DesignTokens.textTertiary)
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
                                .fill(DesignTokens.borderSubtle)
                                .frame(width: 40, height: 40)

                            Image(systemName: "person.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        // Sign in prompt
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Sign In")
                                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Sync your songs across devices")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        Spacer()

                        // Chevron
                        Text("›")
                            .font(.system(size: 24))
                            .foregroundStyle(DesignTokens.textTertiary)
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
                    .foregroundStyle(DesignTokens.textSecondary)

                Text("My Subscription")
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                // Upgrade button (if not pro)
                if storeKit.subscriptionState.tier != "pro" {
                    Text("Upgrade now")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(DesignTokens.gold, lineWidth: 1)
                        )
                } else {
                    Text("›")
                        .font(.system(size: 20))
                        .foregroundStyle(DesignTokens.textTertiary)
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

    // MARK: - Gift Bag Row

    private var giftBagRow: some View {
        Button {
            activeGiftSheet = .bag
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "gift.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.textSecondary)

                Text("Gift Bag")
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if let balance = giftWalletBalance, balance > 0 {
                    Text("\(balance) token\(balance == 1 ? "" : "s")")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(DesignTokens.gold.opacity(0.12))
                        .clipShape(.rect(cornerRadius: 12))
                } else {
                    Text("Buy tokens")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(DesignTokens.gold, lineWidth: 1)
                        )
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
                .foregroundStyle(DesignTokens.textTertiary)
                .tracking(1)
                .padding(.bottom, 8)

            // Appearance row
            Button {
                showThemePicker = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "paintpalette.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 20)

                    Text("Appearance")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    Text(appTheme.displayName)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)

                    Text("›")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .frame(height: 44)
            }
            .buttonStyle(.plain)

            // Lyrics style row
            Menu {
                ForEach(LyricsDesignStyle.allCases, id: \.self) { style in
                    Button {
                        lyricsStyle = style
                    } label: {
                        HStack {
                            Text(style.rawValue)
                            if style == lyricsStyle {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 17))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 20)

                    Text("Lyrics Style")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    Text(lyricsStyle.rawValue)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)

                    Text("›")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .frame(height: 44)
            }

            // Language row
            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 17))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text("Language")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                Text("English")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)

                Text("›")
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.textTertiary)
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
                .foregroundStyle(DesignTokens.textTertiary)
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
                url: AppConfig.termsURL
            )

            // Privacy Policy (external link)
            settingsLinkRow(
                icon: "shield.fill",
                title: "Privacy Policy",
                url: AppConfig.privacyURL
            )

            // Restore Purchases
            settingsRow(
                icon: "arrow.counterclockwise",
                title: "Restore Purchases",
                showChevron: true
            ) {
                Task { await storeKit.restore() }
            }

            if isDevBuild && showDesignScreensFlag {
                settingsRow(
                    icon: "rectangle.stack",
                    title: "Design Screens",
                    showChevron: true
                ) {
                    showV1Screens = true
                }
            }

            #if DEBUG
            settingsRow(
                icon: "paintbrush",
                title: "Design Variants",
                showChevron: true
            ) {
                showDesignVariants = true
            }

            settingsRow(
                icon: "music.note.list",
                title: "Lyrics Redesign",
                showChevron: true
            ) {
                showLyricsRedesign = true
            }

            settingsRow(
                icon: "bubble.left.and.text.bubble.right",
                title: "Creation Flow Redesign",
                showChevron: true
            ) {
                showCreationFlowRedesign = true
            }

            Toggle(isOn: $useUnifiedFlow) {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.triangle.swap")
                        .font(.system(size: 17))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 20)
                    Text("Unified Create Flow")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
            }
            .tint(DesignTokens.gold)
            .frame(height: 44)
            #endif

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
                        .foregroundStyle(DesignTokens.error)
                        .frame(width: 20)

                    Text("Log out")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.error)

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
                        .foregroundStyle(DesignTokens.error)
                        .frame(width: 20)

                    Text("Delete Account")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.error)

                    Spacer()

                    Text("›")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.error)
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
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text(title)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if showChevron {
                    Text("›")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textTertiary)
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
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 20)

                Text(title)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                // External link indicator
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .frame(height: 44)
        }
        .accessibilityLabel("\(title), opens in browser")
    }

    // MARK: - Helper Functions

    /// True for Debug (Xcode) and TestFlight builds, false for App Store.
    private var isDevBuild: Bool {
        #if DEBUG
        return true
        #else
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        #endif
    }

    private func refreshSettings() async {
        async let profile: () = loadVoiceProfileAsync()
        async let credits: () = loadCreditsAsync()
        async let designFlag: () = loadDesignScreensFlag()
        async let wallet: () = loadGiftWalletBalance()
        _ = await (profile, credits, designFlag, wallet)
    }

    private func loadDesignScreensFlag() async {
        do {
            let config = try await apiClient.getAppConfig()
            showDesignScreensFlag = config.flags?.showDesignScreens ?? false
            if let bundles = config.giftBundles {
                await MainActor.run {
                    AppConfig.giftBundles = bundles.sorted { $0.sortOrder < $1.sortOrder }
                }
            }
        } catch {
            showDesignScreensFlag = false
        }
    }

    private func loadVoiceProfileAsync() async {
        isLoadingProfile = true
        voiceProfileError = nil
        do {
            let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadVoiceProfile") {
                try await apiClient.getVoiceProfile()
            }
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
            entitlements = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadEntitlements") {
                try await apiClient.getBillingEntitlements()
            }
        } catch {
            creditsError = "Couldn't load credits"
        }
        isLoadingCredits = false
    }

    private func loadGiftWalletBalance() async {
        guard AppConfig.enableGiftPurchaseUI else { return }
        do {
            let response = try await apiClient.getGiftWallet(limit: 1)
            giftWalletBalance = response.balance
        } catch {
            // Non-critical — badge will show "Buy tokens" fallback
        }
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

    private func shareApp() {
        let url = URL(string: AppConfig.appStoreURL)!
        let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)

        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              let rootVC = scene.windows.first?.rootViewController else { return }

        rootVC.present(activityVC, animated: true)
    }
}

private extension SettingsTabView {
    func presentVoiceEnrollment() {
        if let profile = voiceProfileStatus, profile.hasProfile {
            activeVoiceEnrollment = .profile(profile)
        } else {
            activeVoiceEnrollment = .enroll(existingScore: voiceProfileStatus?.qualityScore)
        }
    }
}

// MARK: - Preview

#Preview {
    let apiClient = APIClient(baseURL: AppConfig.apiBaseURL)
    SettingsTabView(
        apiClient: apiClient,
        storeKit: StoreKitManager(apiClient: apiClient)
    )
    .environment(AuthManager())
}
