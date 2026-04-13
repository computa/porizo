//
//  WaitPulseView.swift
//  PorizoApp
//
//  Breathing coral radial gradient shown during song generation.
//  The pulse breathes slowly (1.0 → 1.08) and adapts to elapsed time
//  with 6 emotional timing buckets that use the recipient's name.
//  At 90s+ the pulse slows to signal patience.
//
//  Respects accessibilityReduceMotion — disables the breathing animation.
//

import SwiftUI

struct WaitPulseView: View {
    let recipientName: String
    let occasion: String?
    let creationNoun: String

    // MARK: - Environment

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // MARK: - Animation State

    @State private var pulseScale: CGFloat = 1.0
    @State private var elapsedSeconds: Int = 0

    // MARK: - Derived State

    private var statusText: String {
        switch elapsedSeconds {
        case 0..<15:
            return "Gathering your story..."
        case 15..<30:
            return "Writing the melody for \(recipientName)..."
        case 30..<60:
            return "Bringing the lyrics to life..."
        case 60..<90:
            return "Adding the finishing touches..."
        case 90..<120:
            return "Almost there..."
        default:
            return "Taking a bit longer than usual..."
        }
    }

    private var pulseDuration: Double {
        elapsedSeconds >= 90 ? 5.0 : 3.0
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing24) {
                Spacer()

                // Breathing coral pulse
                pulseCircle
                    .accessibilityHidden(true)

                // "For {recipientName}"
                Text("For \(recipientName)")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                // Status line
                VStack(spacing: DesignTokens.spacing8) {
                    Text(statusText)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .contentTransition(.interpolate)
                        .animation(.easeInOut(duration: 0.4), value: elapsedSeconds)

                    Text("Ready in about 90 seconds")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .accessibilityIdentifier("wait-subtitle-text")
                }

                Spacer()
            }
            .padding(.horizontal, DesignTokens.spacing20)
        }
        .task {
            startPulseAnimation()
        }
        .task {
            await trackElapsedTime()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Creating \(creationNoun) for \(recipientName). \(statusText)")
    }

    // MARK: - Pulse Circle

    private var pulseCircle: some View {
        Circle()
            .fill(
                RadialGradient(
                    stops: [
                        .init(color: DesignTokens.gold.opacity(0.15), location: 0.15),
                        .init(color: DesignTokens.gold.opacity(0.08), location: 0.50),
                        .init(color: DesignTokens.gold.opacity(0.0), location: 0.70)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: 80
                )
            )
            .frame(width: 160, height: 160)
            .scaleEffect(pulseScale)
    }

    // MARK: - Animation Scheduling

    /// Starts the breathing pulse using `.task { }` for lifecycle-safe scheduling.
    /// When `elapsedSeconds` crosses 90, the animation restarts with a slower cadence.
    private func startPulseAnimation() {
        guard !reduceMotion else { return }

        withAnimation(
            .easeInOut(duration: pulseDuration)
                .repeatForever(autoreverses: true)
        ) {
            pulseScale = 1.08
        }
    }

    /// Increments `elapsedSeconds` every second using cooperative task cancellation.
    private func trackElapsedTime() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { break }
            elapsedSeconds += 1

            // At the 90s boundary, restart the animation with the slower duration.
            // Animate back to 1.0 first to avoid a visual snap, then start the slower cycle.
            if elapsedSeconds == 90 && !reduceMotion {
                withAnimation(.easeInOut(duration: 0.5)) {
                    pulseScale = 1.0
                }
                try? await Task.sleep(for: .milliseconds(550))
                guard !Task.isCancelled else { break }
                withAnimation(
                    .easeInOut(duration: pulseDuration)
                        .repeatForever(autoreverses: true)
                ) {
                    pulseScale = 1.08
                }
            }
        }
    }
}

// MARK: - Preview

#Preview("Default") {
    WaitPulseView(recipientName: "Sarah", occasion: "birthday", creationNoun: "song")
}

#Preview("No Occasion") {
    WaitPulseView(recipientName: "Mom", occasion: nil, creationNoun: "song")
}
