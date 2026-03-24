//
//  PoemRevealView.swift
//  PorizoApp
//
//  Gift reveal screen for shared poems - shows before PIN entry.
//  Matches v1.pen "23 - Poem Gift Reveal" design.
//

import SwiftUI

struct PoemRevealView: View {
    let shareInfo: PoemShareInfoResponse
    let onClaim: () -> Void

    @State private var isAnimating: Bool = false
    @State private var showTapPrompt: Bool = false
    @State private var sealScale: CGFloat = 0.5
    @State private var cardOpacity: Double = 0
    @State private var glowAmount: CGFloat = 0
    @State private var tapPromptTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            // Animated background glow
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            DesignTokens.gold.opacity(0.15 * glowAmount),
                            DesignTokens.gold.opacity(0)
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 300
                    )
                )
                .frame(width: 600, height: 600)
                .blur(radius: 60)

            // Gift Card
            VStack(spacing: 24) {
                // Wax Seal
                waxSeal

                // Received Text
                Text("You've received a poem")
                    .font(.system(size: 14, weight: .medium))
                    .tracking(1)
                    .foregroundStyle(DesignTokens.textTertiary)

                // For Recipient
                Text("For \(shareInfo.poem?.recipientName ?? "You")")
                    .font(DesignTokens.displayFont(size: 36, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                // Occasion Icon
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold.opacity(0.15))
                        .frame(width: 64, height: 64)

                    Text(occasionEmoji)
                        .font(.system(size: 28))
                }

                // From Attribution
                if let creatorName = shareInfo.poem?.creatorName {
                    Text("From \(creatorName)")
                        .font(.system(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
                }

                // Tap Prompt
                if showTapPrompt {
                    VStack(spacing: 8) {
                        Image(systemName: "hand.tap.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(DesignTokens.gold)
                            .scaleEffect(isAnimating ? 1.1 : 1.0)

                        Text("Tap to open")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                    }
                    .padding(.top, 16)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(32)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 32)
                    .fill(DesignTokens.cardBackground)
                    .overlay(
                        RoundedRectangle(cornerRadius: 32)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        DesignTokens.gold,
                                        DesignTokens.gold.opacity(0.25),
                                        DesignTokens.gold
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                lineWidth: 2
                            )
                    )
                    .shadow(color: DesignTokens.gold.opacity(0.2), radius: 64, y: 16)
                    .shadow(color: DesignTokens.gold.opacity(0.1), radius: 120)
            )
            .padding(.horizontal, 32)
            .opacity(cardOpacity)
            .onTapGesture {
                onClaim()
            }
        }
        .onAppear {
            startAnimations()
        }
        .onDisappear {
            tapPromptTask?.cancel()
        }
    }

    // MARK: - Wax Seal

    private var waxSeal: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            DesignTokens.roseGold,
                            DesignTokens.gold,
                            Color(hex: "B8956A")
                        ],
                        center: .center,
                        startRadius: 0,
                        endRadius: 40
                    )
                )
                .frame(width: 80, height: 80)
                .shadow(color: .black.opacity(0.25), radius: 16, y: 4)

            // Seal emblem
            VStack(spacing: 2) {
                Text("\u{2726}")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white.opacity(0.9))
            }
        }
        .scaleEffect(sealScale)
    }

    // MARK: - Helpers

    private var occasionEmoji: String {
        guard let occasion = shareInfo.poem?.occasion?.lowercased() else { return "✨" }
        switch occasion {
        case "birthday": return "🎂"
        case "anniversary": return "💑"
        case "thank_you": return "🙏"
        case "i_love_you": return "❤️"
        case "wedding": return "💒"
        case "graduation": return "🎓"
        case "celebration": return "🎉"
        case "apology": return "💐"
        case "encouragement": return "💪"
        case "advice": return "🧭"
        case "bereavement": return "🕊️"
        default: return "✨"
        }
    }

    private func startAnimations() {
        // Seal animation
        withAnimation(.spring(response: 0.6, dampingFraction: 0.6).delay(0.2)) {
            sealScale = 1.0
        }

        // Card fade in
        withAnimation(.easeOut(duration: 0.8).delay(0.3)) {
            cardOpacity = 1.0
        }

        // Glow pulse
        withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true).delay(0.5)) {
            glowAmount = 1.0
        }

        // Show tap prompt after delay
        tapPromptTask?.cancel()
        tapPromptTask = Task {
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.spring(response: 0.5)) {
                    showTapPrompt = true
                }

                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                    isAnimating = true
                }
            }
        }
    }
}

#Preview {
    PoemRevealView(
        shareInfo: PoemShareInfoResponse(
            status: "active",
            canAccess: false,
            poem: SharedPoemPreview(
                title: "For Sarah",
                recipientName: "Sarah",
                occasion: "birthday",
                previewLines: nil,
                creatorName: "Michael"
            ),
            expiresAt: "2026-02-27T00:00:00Z",
            requiresPin: true,
            claimAttempts: 0,
            maxAttempts: 5
        ),
        onClaim: { }
    )
}
