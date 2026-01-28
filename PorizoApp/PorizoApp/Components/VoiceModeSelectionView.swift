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
                        .foregroundColor(DesignTokens.gold)
                    }

                    Spacer()

                    Text("Voice Selection")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.textTertiary)

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
                            .foregroundColor(DesignTokens.textPrimary)

                        Text("How should your song sound?")
                            .font(DesignTokens.bodyFont(size: 14))
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
                        .background(selectedMode != nil ? DesignTokens.gold : DesignTokens.textTertiary)
                        .foregroundColor(DesignTokens.background)
                        .cornerRadius(28)
                    }
                    .disabled(selectedMode == nil || isCheckingProfile)
                    .padding(.horizontal)
                    .padding(.bottom, 32)
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
                // Icon (v1.pen: gold accent)
                ZStack {
                    Circle()
                        .fill(selectedMode == mode ? DesignTokens.gold.opacity(0.15) : Color(hex: "#1A1A1A"))
                        .frame(width: 56, height: 56)

                    Image(systemName: mode.icon)
                        .font(.system(size: 24))
                        .foregroundColor(selectedMode == mode ? DesignTokens.gold : DesignTokens.textSecondary)
                }

                // Text content
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(mode.displayName)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)

                        if isRecommended {
                            Text("Recommended")
                                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                .foregroundColor(DesignTokens.background)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.gold)
                                .cornerRadius(4)
                        }

                        if mode == .myVoice && !hasVoiceProfile {
                            Text("Not Set Up")
                                .font(DesignTokens.bodyFont(size: 10))
                                .foregroundColor(DesignTokens.textTertiary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color(hex: "#1A1A1A"))
                                .cornerRadius(4)
                        } else if mode == .myVoice, let quality = profileQuality {
                            Text("\(quality)% Quality")
                                .font(DesignTokens.bodyFont(size: 10))
                                .foregroundColor(DesignTokens.success)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.success.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }

                    Text(mode.description)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
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
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(selectedMode == mode ? DesignTokens.gold : DesignTokens.borderSubtle, lineWidth: selectedMode == mode ? 2 : 1)
            )
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
