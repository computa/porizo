//
//  FlowErrorViews.swift
//  PorizoApp
//
//  Five contextual error state views for the create flow.
//  Each view is a full-screen centered layout using DesignTokens,
//  with coral primary CTA and text-link secondary actions.
//

import SwiftUI

// MARK: - Shared Error View Scaffold

/// Internal layout scaffold shared by all flow error views.
/// Provides: background, centered VStack, icon area, title, body lines, CTA stack.
private struct FlowErrorScaffold<Icon: View, Actions: View>: View {
    let icon: Icon
    let title: String
    let bodyLines: [String]
    let actions: Actions

    init(
        title: String,
        bodyLines: [String],
        @ViewBuilder icon: () -> Icon,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.bodyLines = bodyLines
        self.icon = icon()
        self.actions = actions()
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing24) {
                Spacer()

                icon
                    .accessibilityHidden(true)

                VStack(spacing: DesignTokens.spacing12) {
                    Text(title)
                        .font(DesignTokens.displayFont(size: 24, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)

                    ForEach(Array(bodyLines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .multilineTextAlignment(.center)
                            .lineSpacing(3)
                    }
                }

                Spacer()

                actions
                    .padding(.bottom, DesignTokens.spacing32)
            }
            .padding(.horizontal, 40)
        }
    }
}

// MARK: - Shared Button Styles

/// Full-width coral CTA button matching the Warm Canvas design system.
private struct CoralCTAButton: View {
    let label: String
    let icon: String?
    let action: () -> Void

    init(_ label: String, icon: String? = nil, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                }
                Text(label)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: DesignTokens.buttonHeightLarge)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        }
        .goldGlow()
    }
}

/// Outlined secondary button (coral border, no fill).
private struct OutlineCTAButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
                .frame(maxWidth: .infinity)
                .frame(height: DesignTokens.buttonHeightLarge)
                .background(DesignTokens.background)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                        .stroke(DesignTokens.gold.opacity(0.5), lineWidth: 1)
                )
        }
    }
}

/// Text-link secondary action (no background, coral tint).
private struct TextLinkButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(.top, DesignTokens.spacing4)
    }
}

// MARK: - 1. TellConnectionErrorView

/// Shown when network connectivity is lost during the story conversation.
struct TellConnectionErrorView: View {
    let onPrimaryAction: () -> Void   // Continue My Story
    let onSecondaryAction: () -> Void  // Save and Exit

    var body: some View {
        FlowErrorScaffold(
            title: "We lost the connection",
            bodyLines: [
                "Your story is saved. We just need to reconnect to keep going.",
                "Check your Wi-Fi or mobile data and try again."
            ],
            icon: { connectionIcon },
            actions: {
                VStack(spacing: DesignTokens.spacing12) {
                    CoralCTAButton("Continue My Story", icon: "arrow.clockwise", action: onPrimaryAction)
                    TextLinkButton(label: "Save and Exit", action: onSecondaryAction)
                }
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Connection error. Your story is saved.")
    }

    private var connectionIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.warning.opacity(0.12))
                .frame(width: 100, height: 100)
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(DesignTokens.warning)
        }
    }
}

// MARK: - 2. TellModerationErrorView

/// Shown when content moderation rejects the user's story.
struct TellModerationErrorView: View {
    let onPrimaryAction: () -> Void   // Edit Story
    let onSecondaryAction: () -> Void  // Start Over

    var body: some View {
        FlowErrorScaffold(
            title: "We can't create this song",
            bodyLines: [
                "Some of the content doesn't meet our guidelines. Try rephrasing your story."
            ],
            icon: { moderationIcon },
            actions: {
                VStack(spacing: DesignTokens.spacing12) {
                    CoralCTAButton("Edit Story", icon: "pencil", action: onPrimaryAction)
                    TextLinkButton(label: "Start Over", action: onSecondaryAction)
                }
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Content moderation. Some content doesn't meet guidelines.")
    }

    private var moderationIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.textSecondary.opacity(0.10))
                .frame(width: 100, height: 100)
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }
}

// MARK: - 3. WaitTimeoutErrorView

/// Shown when song generation takes longer than expected.
/// Features a slower-breathing pulse animation on the icon.
struct WaitTimeoutErrorView: View {
    let onPrimaryAction: () -> Void   // Notify Me
    let onSecondaryAction: () -> Void  // Keep Waiting

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulseScale: CGFloat = 1.0

    var body: some View {
        FlowErrorScaffold(
            title: "This is taking longer than usual",
            bodyLines: [
                "We'll notify you when it's ready."
            ],
            icon: { timeoutIcon },
            actions: {
                VStack(spacing: DesignTokens.spacing12) {
                    CoralCTAButton("Notify Me", icon: "bell.fill", action: onPrimaryAction)
                    TextLinkButton(label: "Keep Waiting", action: onSecondaryAction)
                }
            }
        )
        .task {
            guard !reduceMotion else { return }
            withAnimation(
                .easeInOut(duration: 4.0)
                    .repeatForever(autoreverses: true)
            ) {
                pulseScale = 1.06
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Generation is taking longer than usual.")
    }

    private var timeoutIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.gold.opacity(0.10))
                .frame(width: 100, height: 100)
                .scaleEffect(pulseScale)

            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 40, weight: .medium))
                .foregroundStyle(DesignTokens.gold)
        }
    }
}

// MARK: - 4. WaitFailureErrorView

/// Shown when the music engine fails during generation.
/// Personalizes the message with the recipient's name.
struct WaitFailureErrorView: View {
    let recipientName: String
    let onPrimaryAction: () -> Void   // Create Again
    let onSecondaryAction: () -> Void  // Edit Story First

    var body: some View {
        FlowErrorScaffold(
            title: "Your song needs another try",
            bodyLines: [
                "The music engine hit a snag. Your story for \(recipientName) is safe and ready to go again."
            ],
            icon: { failureIcon },
            actions: {
                VStack(spacing: DesignTokens.spacing12) {
                    CoralCTAButton("Create Again", icon: "arrow.clockwise", action: onPrimaryAction)
                    TextLinkButton(label: "Edit Story First", action: onSecondaryAction)
                }
            }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Song generation failed. Story for \(recipientName) is saved.")
    }

    private var failureIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.error.opacity(0.10))
                .frame(width: 100, height: 100)

            Image(systemName: "music.note")
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)

            // Small failure badge
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 20))
                .foregroundStyle(DesignTokens.error)
                .background(Circle().fill(DesignTokens.background).padding(-2))
                .offset(x: 22, y: 22)
        }
    }
}

// MARK: - 5. RevealPartialErrorView

/// Shown when the preview rendered successfully but the full song had an issue.
/// Three CTAs: listen to preview (primary), try full song (outline), contact support (text link).
struct RevealPartialErrorView: View {
    let onListenToPreview: () -> Void   // Listen to Preview
    let onTryFullSong: () -> Void       // Try Full Song Again
    let onContactSupport: () -> Void    // Contact Support

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.spacing24) {
                Spacer()

                // Icon: partial success (checkmark + warning)
                partialIcon
                    .accessibilityHidden(true)

                VStack(spacing: DesignTokens.spacing12) {
                    Text("Your preview is ready, but the full song had an issue")
                        .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("You can still listen to the preview and share it, or try creating the full version again.")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                }

                // Credits reassurance
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 14))
                    Text("Your credits have not been charged")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                }
                .foregroundStyle(DesignTokens.successDark)

                Spacer()

                // Three-tier CTA stack
                VStack(spacing: DesignTokens.spacing12) {
                    CoralCTAButton("Listen to Preview", icon: "play.fill", action: onListenToPreview)
                    OutlineCTAButton(label: "Try Full Song Again", action: onTryFullSong)
                    TextLinkButton(label: "Contact Support", action: onContactSupport)
                }
                .padding(.bottom, DesignTokens.spacing32)
            }
            .padding(.horizontal, 40)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Preview ready. Full song had an issue. Credits not charged.")
    }

    private var partialIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.warning.opacity(0.10))
                .frame(width: 100, height: 100)

            Image(systemName: "music.note.list")
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(DesignTokens.gold)

            // Warning badge
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 18))
                .foregroundStyle(DesignTokens.warning)
                .background(Circle().fill(DesignTokens.background).padding(-3))
                .offset(x: 24, y: 22)
        }
    }
}

// MARK: - Previews

#Preview("Connection Error") {
    TellConnectionErrorView(
        onPrimaryAction: {},
        onSecondaryAction: {}
    )
}

#Preview("Moderation Error") {
    TellModerationErrorView(
        onPrimaryAction: {},
        onSecondaryAction: {}
    )
}

#Preview("Wait Timeout") {
    WaitTimeoutErrorView(
        onPrimaryAction: {},
        onSecondaryAction: {}
    )
}

#Preview("Wait Failure") {
    WaitFailureErrorView(
        recipientName: "Sarah",
        onPrimaryAction: {},
        onSecondaryAction: {}
    )
}

#Preview("Reveal Partial Error") {
    RevealPartialErrorView(
        onListenToPreview: {},
        onTryFullSong: {},
        onContactSupport: {}
    )
}
