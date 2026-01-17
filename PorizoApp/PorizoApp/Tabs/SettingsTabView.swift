//
//  SettingsTabView.swift
//  PorizoApp
//
//  Settings tab with voice profile, account, and support options.
//  Extracted from MainTabView for better modularity.
//

import SwiftUI

// MARK: - Settings Tab View

struct SettingsTabView: View {
    let apiClient: APIClient
    @ObservedObject var storeKit: StoreKitManager

    @State private var showVoiceEnrollment = false
    @State private var showSubscription = false
    @State private var voiceProfileStatus: VoiceProfileStatus?
    @State private var isLoadingProfile = true

    // Credits state
    @State private var entitlements: Entitlements?
    @State private var isLoadingCredits = true

    // Error states for user feedback
    @State private var voiceProfileError: String?
    @State private var creditsError: String?

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                List {
                    // Your Voice Section (Optional, with NEW badge)
                    Section {
                        // Promo card if not enrolled
                        if voiceProfileStatus?.hasProfile != true {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Your Voice")
                                        .font(.headline)
                                        .foregroundColor(DesignTokens.textPrimary)

                                    Text("NEW")
                                        .font(.caption2.bold())
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(DesignTokens.rose)
                                        .cornerRadius(4)
                                }

                                Text("Make songs sound like you singing")
                                    .font(.subheadline)
                                    .foregroundColor(DesignTokens.textSecondary)

                                Button {
                                    showVoiceEnrollment = true
                                } label: {
                                    Text("Set Up Voice")
                                        .font(.subheadline.bold())
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 10)
                                        .background(DesignTokens.rose)
                                        .cornerRadius(20)
                                }
                            }
                            .padding()
                            .listRowBackground(DesignTokens.cardBackground)
                            .listRowInsets(EdgeInsets())
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(DesignTokens.roseLight, lineWidth: 1)
                                    .padding(1)
                            )
                        } else {
                            // Voice profile active
                            Button {
                                showVoiceEnrollment = true
                            } label: {
                                HStack {
                                    Image(systemName: "waveform.circle.fill")
                                        .font(.title2)
                                        .foregroundColor(DesignTokens.rose)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Voice Profile")
                                            .foregroundColor(DesignTokens.textPrimary)

                                        HStack(spacing: 4) {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.caption)
                                                .foregroundColor(DesignTokens.success)
                                            if let score = voiceProfileStatus?.qualityScore {
                                                Text("Quality: \(Int(score))%")
                                                    .font(.caption)
                                                    .foregroundColor(DesignTokens.textSecondary)
                                            } else {
                                                Text("Active")
                                                    .font(.caption)
                                                    .foregroundColor(DesignTokens.textSecondary)
                                            }
                                        }
                                    }

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .foregroundColor(DesignTokens.textSecondary)
                                }
                            }
                            .listRowBackground(DesignTokens.cardBackground)
                        }
                    } header: {
                        HStack {
                            Text("Your Voice")
                            Text("NEW")
                                .font(.caption2.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(DesignTokens.rose)
                                .cornerRadius(3)
                        }
                    } footer: {
                        if let error = voiceProfileError {
                            Button {
                                Task { await loadVoiceProfileAsync() }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .foregroundColor(DesignTokens.warning)
                                    Text(error)
                                    Text("Retry")
                                        .fontWeight(.semibold)
                                        .foregroundColor(DesignTokens.rose)
                                }
                                .font(.caption)
                            }
                        } else {
                            Text("Optional: Record your voice to create songs that sound like you singing.")
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                    }

                    // Credits Section
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Songs")
                                        .font(.headline)
                                        .foregroundColor(DesignTokens.textPrimary)

                                    if isLoadingCredits {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    } else if let ent = entitlements {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(ent.remainingText)
                                                .font(.system(size: 24, weight: .bold, design: .rounded))
                                                .foregroundColor(DesignTokens.rose)

                                            Text(tierDisplayName(ent.tier))
                                                .font(.caption)
                                                .foregroundColor(DesignTokens.textSecondary)
                                        }
                                    } else if let error = creditsError {
                                        Button {
                                            Task { await loadCreditsAsync() }
                                        } label: {
                                            HStack(spacing: 4) {
                                                Image(systemName: "exclamationmark.triangle.fill")
                                                    .foregroundColor(DesignTokens.warning)
                                                Text(error)
                                                    .foregroundColor(DesignTokens.textSecondary)
                                                Text("Retry")
                                                    .foregroundColor(DesignTokens.rose)
                                                    .fontWeight(.semibold)
                                            }
                                            .font(.caption)
                                        }
                                    } else {
                                        Text("No data")
                                            .font(.subheadline)
                                            .foregroundColor(DesignTokens.textSecondary)
                                    }
                                }

                                Spacer()

                                // Songs icon
                                ZStack {
                                    Circle()
                                        .fill(DesignTokens.roseMuted)
                                        .frame(width: 50, height: 50)

                                    Image(systemName: "music.note.list")
                                        .font(.system(size: 24))
                                        .foregroundColor(DesignTokens.rose)
                                }
                            }

                            // Upgrade button
                            if storeKit.subscriptionState.tier == "free" {
                                Button {
                                    showSubscription = true
                                } label: {
                                    HStack {
                                        Image(systemName: "arrow.up.circle.fill")
                                        Text("Upgrade Plan")
                                    }
                                    .font(.subheadline.bold())
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .background(DesignTokens.rose)
                                    .cornerRadius(20)
                                }
                            }
                        }
                        .padding()
                        .listRowBackground(DesignTokens.cardBackground)
                        .listRowInsets(EdgeInsets())
                    } header: {
                        Text("Your Plan")
                    } footer: {
                        if let ent = entitlements {
                            Text("Total songs created: \(ent.creditsUsedTotal)")
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                    }

                    // Account Section
                    Section("Account") {
                        AccountSectionView()
                    }

                    // Support Section
                    Section("Support") {
                        Link(destination: URL(string: "https://porizo.com/help")!) {
                            Label("Help Center", systemImage: "questionmark.circle")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "mailto:support@porizo.com")!) {
                            Label("Contact Us", systemImage: "envelope")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "https://porizo.com/privacy")!) {
                            Label("Privacy Policy", systemImage: "hand.raised")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "https://porizo.com/terms")!) {
                            Label("Terms of Service", systemImage: "doc.text")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)
                    }

                    // Developer Tools removed - V2 is now in production flow

                    // App Info
                    Section {
                        HStack {
                            Text("Version")
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Text(appVersion)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)
                    }
                }
                .scrollContentBackground(.hidden)
                .refreshable {
                    await refreshSettings()
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showVoiceEnrollment) {
                EnrollmentFlowView(
                    apiClient: apiClient,
                    onComplete: {
                        showVoiceEnrollment = false
                        loadVoiceProfile()
                    }
                )
            }
            .sheet(isPresented: $showSubscription) {
                SubscriptionView(storeKit: storeKit)
            }
            .onAppear {
                // Load voice profile and credits in parallel (not sequential)
                Task {
                    await refreshSettings()
                }
            }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private func tierDisplayName(_ tier: String) -> String {
        switch tier.lowercased() {
        case "free": return "Free Plan"
        case "basic": return "Basic Plan"
        case "pro": return "Pro Plan"
        case "premium": return "Premium Plan"
        default: return tier.capitalized + " Plan"
        }
    }

    private func refreshSettings() async {
        // Reload both voice profile and credits in parallel
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

    private func loadVoiceProfile() {
        Task { @MainActor in
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
    }

    private func loadCredits() {
        Task { @MainActor in
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
    }
}

// MARK: - Account Section View

struct AccountSectionView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var showAuthSheet = false
    @State private var showLogoutConfirmation = false
    @State private var showDeleteAccountConfirmation = false
    @State private var showDeleteAccountFinalConfirmation = false
    @State private var deleteAccountError: String?
    @State private var isDeletingAccount = false

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                // Logged in state
                if let user = authManager.currentUser {
                HStack {
                    // User avatar/icon
                    ZStack {
                        Circle()
                            .fill(DesignTokens.roseMuted)
                            .frame(width: 44, height: 44)
                        Text(userInitials(from: user))
                            .font(.headline)
                            .foregroundColor(DesignTokens.rose)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName ?? "User")
                            .font(.headline)
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
                }
                .listRowBackground(DesignTokens.cardBackground)

                // Sign-in providers
                if user.providers.contains("apple") {
                    HStack {
                        Image(systemName: "apple.logo")
                        Text("Signed in with Apple")
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .font(.caption)
                    .listRowBackground(DesignTokens.cardBackground)
                }

                // Logout button
                Button(role: .destructive) {
                    showLogoutConfirmation = true
                } label: {
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .listRowBackground(DesignTokens.cardBackground)

                // Delete account button
                Button(role: .destructive) {
                    showDeleteAccountConfirmation = true
                } label: {
                    HStack {
                        Label("Delete Account", systemImage: "trash")
                        if isDeletingAccount {
                            Spacer()
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }
                }
                .disabled(isDeletingAccount)
                .listRowBackground(DesignTokens.cardBackground)
            } else {
                // Loading user info
                HStack {
                    ProgressView()
                    Text("Loading account...")
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .listRowBackground(DesignTokens.cardBackground)
            }
        } else {
            // Not logged in
            VStack(alignment: .leading, spacing: 8) {
                Text("Sync across devices")
                    .font(.subheadline.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Create an account to access your songs on any device")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)

                Button {
                    showAuthSheet = true
                } label: {
                    Text("Sign In or Create Account")
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(DesignTokens.rose)
                        .cornerRadius(20)
                }
                .padding(.top, 4)
            }
            .padding(.vertical, 4)
            .listRowBackground(DesignTokens.cardBackground)
            }
        }
        // Sheets and alerts (applied to entire view via Group)
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
    }

    private func performAccountDeletion() async {
        isDeletingAccount = true
        deleteAccountError = nil

        do {
            try await authManager.deleteAccount()
            // Success - user is logged out automatically
        } catch {
            deleteAccountError = error.localizedDescription
        }

        isDeletingAccount = false
    }

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
}


#Preview {
    let apiClient = APIClient(baseURL: "http://localhost:3000")
    SettingsTabView(
        apiClient: apiClient,
        storeKit: StoreKitManager(apiClient: apiClient)
    )
    .environmentObject(AuthManager())
}
