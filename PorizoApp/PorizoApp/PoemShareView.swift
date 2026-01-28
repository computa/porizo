//
//  PoemShareView.swift
//  PorizoApp
//
//  Share sheet for poems with link, PIN, and social options.
//  Matches v1.pen "22 - Share Poem" design.
//

import SwiftUI

struct PoemShareView: View {
    let poem: Poem
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var apiClient: APIClientWrapper

    @State private var isCreatingShare: Bool = false
    @State private var shareResponse: CreatePoemShareResponse?
    @State private var error: String?
    @State private var hasCopiedLink: Bool = false
    @State private var expiresInDays: Int = 30
    @State private var allowSave: Bool = true

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Content
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Preview Card
                        previewCard

                        if let shareResponse = shareResponse {
                            // Link Section
                            linkSection(shareResponse)

                            // Settings Section
                            settingsSection(shareResponse)

                            // Share Options
                            shareOptionsSection(shareResponse)
                        } else if isCreatingShare {
                            loadingView
                        } else if let error = error {
                            errorView(error)
                        }

                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                }

                // Bottom Button
                if shareResponse != nil {
                    shareButton
                }
            }
        }
        .task {
            await createShare()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            // Close Button
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }

            Spacer()

            Text("Share Poem")
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            // Spacer for balance
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Preview Card

    private var previewCard: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "E8B4B8"), DesignTokens.gold],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 200)
                    .shadow(color: DesignTokens.gold.opacity(0.25), radius: 24, y: 8)

                VStack(spacing: 8) {
                    // Border Frame
                    VStack(spacing: 12) {
                        Image(systemName: "text.book.closed.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)

                        Text("For \(poem.recipientName)")
                            .font(.custom("PlayfairDisplay-SemiBold", size: 20))
                            .foregroundColor(.white)

                        Text(occasionDisplayName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.white.opacity(0.4), lineWidth: 2)
                            .padding(8)
                    )
                }
                .padding(24)
            }
        }
    }

    // MARK: - Link Section

    private func linkSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SHARE LINK")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.textTertiary)

            HStack(spacing: 8) {
                Text(response.shareUrl)
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    UIPasteboard.general.string = response.shareUrl
                    withAnimation(.spring(response: 0.3)) {
                        hasCopiedLink = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation { hasCopiedLink = false }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: hasCopiedLink ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 14))
                        Text(hasCopiedLink ? "Copied" : "Copy")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(hasCopiedLink ? .green : DesignTokens.gold)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        (hasCopiedLink ? Color.green : DesignTokens.gold).opacity(0.15)
                    )
                    .clipShape(Capsule())
                }
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Settings Section

    private func settingsSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(spacing: 0) {
            // PIN Protection Row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PIN Protection")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text("Share this PIN with the recipient")
                        .font(.system(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                Text(response.claimPin)
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundColor(DesignTokens.gold)
            }
            .padding(16)

            // Divider
            Rectangle()
                .fill(DesignTokens.border)
                .frame(height: 1)

            // Expires Row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Expires")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text("Link will expire after this date")
                        .font(.system(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                Text(formatExpiryDate(response.expiresAt))
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(16)
        }
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Share Options

    private func shareOptionsSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(spacing: 12) {
            Text("SHARE VIA")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 24) {
                // Messages
                shareOptionButton(
                    icon: "message.fill",
                    label: "Messages",
                    color: .green
                ) {
                    shareViaMessages(response.shareUrl, pin: response.claimPin)
                }

                // WhatsApp
                shareOptionButton(
                    icon: "phone.fill",
                    label: "WhatsApp",
                    color: Color(hex: "25D366")
                ) {
                    shareViaWhatsApp(response.shareUrl, pin: response.claimPin)
                }

                // Email
                shareOptionButton(
                    icon: "envelope.fill",
                    label: "Email",
                    color: .blue
                ) {
                    shareViaEmail(response.shareUrl, pin: response.claimPin)
                }

                // More
                shareOptionButton(
                    icon: "ellipsis",
                    label: "More",
                    color: DesignTokens.textSecondary
                ) {
                    shareViaSystemSheet(response.shareUrl, pin: response.claimPin)
                }
            }
        }
    }

    private func shareOptionButton(
        icon: String,
        label: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(color)
                        .frame(width: 48, height: 48)

                    Image(systemName: icon)
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                }

                Text(label)
                    .font(.system(size: 11))
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
    }

    // MARK: - Share Button

    private var shareButton: some View {
        Button {
            if let response = shareResponse {
                shareViaSystemSheet(response.shareUrl, pin: response.claimPin)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 18))
                Text("Share Poem")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: 28))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 34)
    }

    // MARK: - Loading & Error States

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                .scaleEffect(1.2)

            Text("Creating share link...")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.red)

            Text(message)
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                Task { await createShare() }
            } label: {
                Text("Try Again")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.gold)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Helpers

    private var occasionDisplayName: String {
        switch poem.occasion.lowercased() {
        case "birthday": return "Birthday"
        case "anniversary": return "Anniversary"
        case "thank_you": return "Thank You"
        case "i_love_you": return "Love"
        case "wedding": return "Wedding"
        case "graduation": return "Graduation"
        case "celebration": return "Celebration"
        case "apology": return "Apology"
        case "encouragement": return "Encouragement"
        default: return "Poem"
        }
    }

    private func formatExpiryDate(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else { return isoString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "MMM d, yyyy"
        return displayFormatter.string(from: date)
    }

    private func createShare() async {
        isCreatingShare = true
        error = nil

        do {
            let response = try await apiClient.client.createPoemShare(
                poemId: poem.id,
                expiresInDays: expiresInDays,
                allowSave: allowSave
            )
            await MainActor.run {
                self.shareResponse = response
                self.isCreatingShare = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isCreatingShare = false
            }
        }
    }

    // MARK: - Share Actions

    private func shareViaMessages(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let smsUrl = URL(string: "sms:&body=\(encoded)") {
            UIApplication.shared.open(smsUrl)
        }
    }

    private func shareViaWhatsApp(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let waUrl = URL(string: "whatsapp://send?text=\(encoded)") {
            UIApplication.shared.open(waUrl)
        }
    }

    private func shareViaEmail(_ url: String, pin: String) {
        let subject = "A Special Poem for You"
        let body = "I wrote a poem for you!\n\nOpen it here: \(url)\n\nUse PIN: \(pin)"
        if let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let encodedBody = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let mailUrl = URL(string: "mailto:?subject=\(encodedSubject)&body=\(encodedBody)") {
            UIApplication.shared.open(mailUrl)
        }
    }

    private func shareViaSystemSheet(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
        let activityVC = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}

#Preview {
    PoemShareView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            tone: "heartfelt",
            status: "complete",
            verses: ["Another year of wonder."],
            createdAt: "2026-01-27",
            updatedAt: "2026-01-27"
        )
    )
    .environmentObject(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
