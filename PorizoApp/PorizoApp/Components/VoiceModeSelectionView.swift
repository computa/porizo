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
    let onSelect: (VoiceMode) -> Void
    let onBack: () -> Void

    @State private var selectedMode: VoiceMode?
    @State private var isCheckingProfile = false
    @State private var showEnrollmentPrompt = false
    @State private var hasVoiceProfile = false
    @State private var profileQuality: Int?

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Text("Choose Your Voice")
                        .font(.title2.bold())
                        .foregroundColor(DesignTokens.textPrimary)

                    Text("How should your song sound?")
                        .foregroundColor(DesignTokens.textSecondary)
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

                    // My Voice option (requires profile)
                    voiceOptionCard(
                        mode: .myVoice,
                        isRecommended: false,
                        isAvailable: hasVoiceProfile
                    )
                }
                .padding(.horizontal)

                Spacer()

                // Continue button
                Button {
                    handleContinue()
                } label: {
                    HStack {
                        if isCheckingProfile {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        }
                        Text(isCheckingProfile ? "Checking..." : "Continue")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(selectedMode != nil ? DesignTokens.rose : DesignTokens.textTertiary)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(selectedMode == nil || isCheckingProfile)
                .padding(.horizontal)
                .padding(.bottom, 32)
            }
        }
        .navigationTitle("Voice Selection")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    onBack()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Back")
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }
        }
        .onAppear {
            // Default to AI Voice
            selectedMode = .aiVoice
            checkVoiceProfile()
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
                // Icon
                ZStack {
                    Circle()
                        .fill(selectedMode == mode ? DesignTokens.roseMuted : DesignTokens.backgroundSubtle)
                        .frame(width: 56, height: 56)

                    Image(systemName: mode.icon)
                        .font(.system(size: 24))
                        .foregroundColor(selectedMode == mode ? DesignTokens.rose : DesignTokens.textSecondary)
                }

                // Text content
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(mode.displayName)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        if isRecommended {
                            Text("Recommended")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.rose)
                                .cornerRadius(4)
                        }

                        if mode == .myVoice && !hasVoiceProfile {
                            Text("Not Set Up")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.textTertiary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.backgroundSubtle)
                                .cornerRadius(4)
                        } else if mode == .myVoice, let quality = profileQuality {
                            Text("\(quality)% Quality")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.success)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.success.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }

                    Text(mode.description)
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                        .lineLimit(2)
                }

                Spacer()

                // Selection indicator
                ZStack {
                    Circle()
                        .stroke(selectedMode == mode ? DesignTokens.rose : DesignTokens.cardBorder, lineWidth: 2)
                        .frame(width: 24, height: 24)

                    if selectedMode == mode {
                        Circle()
                            .fill(DesignTokens.rose)
                            .frame(width: 14, height: 14)
                    }
                }
            }
            .padding()
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(selectedMode == mode ? DesignTokens.rose : Color.clear, lineWidth: 2)
            )
            .subtleShadow()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func checkVoiceProfile() {
        Task {
            do {
                let status = try await apiClient.getVoiceProfile()
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

        onSelect(mode)
    }
}

#Preview {
    NavigationStack {
        VoiceModeSelectionView(
            apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
            onSelect: { mode in print("Selected: \(mode)") },
            onBack: { }
        )
    }
}
