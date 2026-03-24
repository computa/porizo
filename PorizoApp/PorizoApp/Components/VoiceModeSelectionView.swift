//
//  VoiceModeSelectionView.swift
//  PorizoApp
//
//  Voice mode selection: AI Voice (default) or My Voice (requires profile).
//  AI-first design - AI voice is frictionless, My Voice triggers profile check.
//

import SwiftUI

/// Voice mode options
enum VoiceMode: String, Sendable {
    case aiVoice = "ai_voice"
    case myVoice = "user_voice"

    var displayName: String {
        switch self {
        case .aiVoice: return "AI Voice"
        case .myVoice: return "My Voice"
        }
    }

    var description: String {
        switch self {
        case .aiVoice: return "A professional AI singer performs your song"
        case .myVoice: return "Your song sounds like you singing"
        }
    }

    var icon: String {
        switch self {
        case .aiVoice: return "cpu"
        case .myVoice: return "person.wave.2"
        }
    }
}

struct VoiceModeSelectionView: View {
    let apiClient: APIClient
    let onSelect: (VoiceMode, VoiceGender?) -> Void
    let onBack: () -> Void

    @State private var selectedMode: VoiceMode?
    @State private var selectedGender: VoiceGender?
    @State private var isCheckingProfile = false
    @State private var showEnrollmentPrompt = false
    @State private var hasVoiceProfile = false
    @State private var profileQuality: Int?
    @State private var myVoiceEnabled = true

    /// Continue requires mode + gender (for AI voice) to be selected
    private var canContinue: Bool {
        guard selectedMode != nil else { return false }
        if selectedMode == .aiVoice { return selectedGender != nil }
        return true // My Voice doesn't need gender selection
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header with back button (v1.pen: 56h)
                HStack {
                    Button {
                        onBack()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .medium))
                            Text("Back")
                                .font(DesignTokens.bodyFont(size: 16))
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }

                    Spacer()

                    Text("Voice Selection")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textTertiary)

                    Spacer()

                    // Spacer to balance layout
                    Color.clear.frame(width: 60, height: 44)
                }
                .padding(.horizontal, 20)
                .frame(height: 56)

                // Content
                VStack(spacing: 24) {
                    // Header (v1.pen: Playfair Display 28pt)
                    VStack(spacing: 8) {
                        Text("Choose Your Voice")
                            .font(DesignTokens.displayFont(size: 28))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text("How should your song sound?")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .padding(.top, 20)

                    // Voice options
                    VStack(spacing: 16) {
                        // AI Voice option (recommended, default)
                        voiceOptionCard(
                            mode: .aiVoice,
                            isRecommended: true,
                            isAvailable: true
                        )

                        if myVoiceEnabled {
                            // My Voice option (requires profile)
                            voiceOptionCard(
                                mode: .myVoice,
                                isRecommended: false,
                                isAvailable: hasVoiceProfile
                            )
                        }
                    }
                    .padding(.horizontal)

                    // Voice gender picker (only for AI Voice)
                    if selectedMode == .aiVoice {
                        VStack(spacing: 12) {
                            Text("Singer Gender")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)

                            HStack(spacing: 12) {
                                ForEach(VoiceGender.allCases, id: \.self) { gender in
                                    Button {
                                        selectedGender = gender
                                    } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: gender == .male ? "figure.stand" : "figure.stand.dress")
                                                .font(.system(size: 16))
                                            Text(gender.displayName)
                                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                        }
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 48)
                                        .background(selectedGender == gender ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
                                        .foregroundStyle(selectedGender == gender ? DesignTokens.gold : DesignTokens.textSecondary)
                                        .clipShape(.rect(cornerRadius: 12))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(selectedGender == gender ? DesignTokens.gold : DesignTokens.border, lineWidth: selectedGender == gender ? 1.5 : 0.5)
                                        )
                                    }
                                }
                            }
                        }
                        .padding(.horizontal)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                        .animation(.easeInOut(duration: 0.2), value: selectedMode)
                    }

                    Spacer()

                    // Continue button (v1.pen: gold, 56h, cornerRadius 28)
                    Button {
                        handleContinue()
                    } label: {
                        HStack {
                            if isCheckingProfile {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.background))
                                    .scaleEffect(0.8)
                            }
                            Text(isCheckingProfile ? "Checking..." : "Continue")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(canContinue ? DesignTokens.gold : DesignTokens.textTertiary)
                        .foregroundStyle(DesignTokens.background)
                        .clipShape(.rect(cornerRadius: 28))
                    }
                    .disabled(!canContinue || isCheckingProfile)
                    .padding(.horizontal)
                    .padding(.bottom, 32)
                }
            }
        }
        .onAppear {
            // Default to AI Voice
            selectedMode = .aiVoice
            loadVoiceOptionConfig()
        }
        .alert("Voice Profile Required", isPresented: $showEnrollmentPrompt) {
            Button("Use AI Voice") {
                selectedMode = .aiVoice
            }
            Button("Set Up My Voice") {
                // Navigate to enrollment
                // For now, this would need to be handled by parent view
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("To use your own voice, you need to record a voice profile first. This takes about 2 minutes.")
        }
    }

    // MARK: - Voice Option Card

    private func voiceOptionCard(
        mode: VoiceMode,
        isRecommended: Bool,
        isAvailable: Bool
    ) -> some View {
        Button {
            if mode == .myVoice && !hasVoiceProfile {
                showEnrollmentPrompt = true
            } else {
                selectedMode = mode
            }
        } label: {
            HStack(spacing: 16) {
                // Icon (v1.pen: gold accent)
                ZStack {
                    Circle()
                        .fill(selectedMode == mode ? DesignTokens.gold.opacity(0.15) : DesignTokens.surfaceMuted)
                        .frame(width: 56, height: 56)

                    Image(systemName: mode.icon)
                        .font(.system(size: 24))
                        .foregroundStyle(selectedMode == mode ? DesignTokens.gold : DesignTokens.textSecondary)
                }

                // Text content
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(mode.displayName)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)

                        if isRecommended {
                            Text("Recommended")
                                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                .foregroundStyle(DesignTokens.background)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.gold)
                                .clipShape(.rect(cornerRadius: 4))
                        }

                        if mode == .myVoice && !hasVoiceProfile {
                            Text("Not Set Up")
                                .font(DesignTokens.bodyFont(size: 10))
                                .foregroundStyle(DesignTokens.textTertiary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.surfaceMuted)
                                .clipShape(.rect(cornerRadius: 4))
                        } else if mode == .myVoice, let quality = profileQuality {
                            Text("\(quality)% Quality")
                                .font(DesignTokens.bodyFont(size: 10))
                                .foregroundStyle(DesignTokens.success)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.success.opacity(0.1))
                                .clipShape(.rect(cornerRadius: 4))
                        }
                    }

                    Text(mode.description)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(2)
                }

                Spacer()

                // Selection indicator (v1.pen: gold)
                ZStack {
                    Circle()
                        .stroke(selectedMode == mode ? DesignTokens.gold : DesignTokens.borderSubtle, lineWidth: 2)
                        .frame(width: 24, height: 24)

                    if selectedMode == mode {
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 14, height: 14)
                    }
                }
            }
            .padding(16)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(selectedMode == mode ? DesignTokens.gold : DesignTokens.borderSubtle, lineWidth: selectedMode == mode ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func loadVoiceOptionConfig() {
        Task {
            do {
                let appConfig = try await apiClient.getAppConfig()
                let enabled = appConfig.flags?.myVoiceEnabled ?? true
                await MainActor.run {
                    myVoiceEnabled = enabled
                    if !enabled {
                        selectedMode = .aiVoice
                        hasVoiceProfile = false
                        profileQuality = nil
                    }
                }

                if enabled {
                    checkVoiceProfile()
                }
            } catch {
                // Fail-open to preserve existing behavior if config fetch fails
                await MainActor.run {
                    myVoiceEnabled = true
                }
                checkVoiceProfile()
            }
        }
    }

    private func checkVoiceProfile() {
        Task {
            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getVoiceProfile") {
                    try await apiClient.getVoiceProfile()
                }
                await MainActor.run {
                    hasVoiceProfile = status.hasProfile
                    if let score = status.qualityScore {
                        profileQuality = Int(score)
                    }
                }
            } catch {
                // No profile or error - default to AI voice
                await MainActor.run {
                    hasVoiceProfile = false
                }
            }
        }
    }

    private func handleContinue() {
        guard let mode = selectedMode else { return }

        if mode == .myVoice && !hasVoiceProfile {
            showEnrollmentPrompt = true
            return
        }

        onSelect(mode, selectedGender)
    }
}

#Preview {
    NavigationStack {
        VoiceModeSelectionView(
            apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
            onSelect: { mode, gender in print("Selected: \(mode) \(gender?.rawValue ?? "none")") },
            onBack: { }
        )
    }
}
