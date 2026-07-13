import SwiftUI
import UIKit

struct CheckEmailView: View {
    let context: MagicLoginPresentation
    let state: MagicLoginState
    let onResend: () -> Void
    let onUseDifferentEmail: () -> Void
    let onRefresh: @MainActor () async -> Bool

    var body: some View {
        VStack(spacing: DesignTokens.spacing24) {
            VStack(spacing: DesignTokens.spacing16) {
                Image(systemName: "envelope.badge.fill")
                    .font(.system(size: 42, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
                    .accessibilityHidden(true)

                VStack(spacing: DesignTokens.spacing8) {
                    Text(context.purpose == .addEmail ? "Verify your email" : "Check your email")
                        .font(DesignTokens.displayFont(size: 26))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("We sent a secure sign-in link to")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)

                    Text(context.email)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("magicLoginDestination")

                    Text("Open the link on this device. Porizo will finish automatically.")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 2)
                }
            }

            statusPanel

            VStack(spacing: DesignTokens.spacing12) {
                Button {
                    openMail()
                } label: {
                    Label("Open Mail", systemImage: "envelope.open.fill")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.gold)
                .foregroundStyle(DesignTokens.background)
                .accessibilityHint("Opens the Mail app so you can tap the Porizo sign-in link")

                TimelineView(.periodic(from: .now, by: 1)) { timeline in
                    let remaining = resendRemaining(at: timeline.date)
                    Button {
                        onResend()
                    } label: {
                        Text(remaining > 0 ? "Resend in \(remaining)s" : "Resend sign-in link")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .tint(DesignTokens.gold)
                    .disabled(remaining > 0 || isBusy)
                    .accessibilityHint(remaining > 0 ? "Available in \(remaining) seconds" : "Sends a replacement link")
                }

                Button("Use a different email") {
                    onUseDifferentEmail()
                }
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.gold)
                .disabled(isBusy)
            }
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing32)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
        .task(id: context.id) {
            while !Task.isCancelled && !isTerminal {
                let completed = await onRefresh()
                if completed || isTerminal { return }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private var statusPanel: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacing12) {
            if isBusy {
                ProgressView()
                    .tint(DesignTokens.gold)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: statusSymbol)
                    .foregroundStyle(statusColor)
                    .accessibilityHidden(true)
            }

            Text(statusMessage)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(DesignTokens.spacing12)
        .background(statusColor.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("magicLoginStatus")
    }

    private var isBusy: Bool {
        state == .submitting || state == .opening || state == .exchanging
    }

    private var isTerminal: Bool {
        AuthManager.isTerminalMagicState(state)
    }

    private var statusMessage: String {
        switch state {
        case .submitting: "Sending a new secure link."
        case .opening, .exchanging: "Finishing your sign-in securely."
        case .success: context.purpose == .addEmail ? "Email verified." : "Signed in."
        case .expired: "This link expired. Request a new one."
        case .locked: "This request is locked. Use a different email or contact support."
        case .conflict: "This email cannot be added to the current account."
        case .legacyRecovery(let maskedEmail, _): "An existing account already has \(maskedEmail). Recover that account to keep its songs and purchases."
        case .wrongDeviceOrPlatform: "This request belongs to another device or platform. Request a new link here."
        case .offline: "You are offline. We will check again when the connection returns."
        case .serverError: "We could not check the link. You can retry or request a new one."
        case .cancelled: "Sign-in cancelled."
        case .superseded: "A newer request replaced this link."
        case .idle, .sent, .cooldown: "Waiting for you to open the link on this device."
        }
    }

    private var statusSymbol: String {
        switch state {
        case .success: "checkmark.circle.fill"
        case .expired, .locked, .conflict, .legacyRecovery, .wrongDeviceOrPlatform,
             .offline, .serverError, .cancelled, .superseded: "exclamationmark.triangle.fill"
        default: "clock.fill"
        }
    }

    private var statusColor: Color {
        switch state {
        case .success: DesignTokens.success
        case .expired, .locked, .conflict, .legacyRecovery, .wrongDeviceOrPlatform,
             .serverError, .cancelled, .superseded: DesignTokens.error
        case .offline: DesignTokens.gold
        default: DesignTokens.gold
        }
    }

    private func resendRemaining(at date: Date) -> Int {
        max(0, Int(ceil(context.resendAvailableAt.timeIntervalSince(date))))
    }

    private func openMail() {
        guard let url = URL(string: "message://") else { return }
        UIApplication.shared.open(url)
    }
}

#Preview("Check email") {
    ZStack {
        DesignTokens.background.ignoresSafeArea()
        CheckEmailView(
            context: MagicLoginPresentation(
                transactionId: "preview",
                email: "ambrose@example.com",
                purpose: .login,
                expiresAt: .now.addingTimeInterval(900),
                createdAt: .now.addingTimeInterval(-60)
            ),
            state: .sent(email: "ambrose@example.com"),
            onResend: {},
            onUseDifferentEmail: {},
            onRefresh: { false }
        )
    }
}
