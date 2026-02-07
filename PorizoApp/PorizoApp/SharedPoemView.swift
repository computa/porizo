//
//  SharedPoemView.swift
//  PorizoApp
//
//  View for displaying a claimed shared poem with save and social options.
//  Matches v1.pen "24 - Shared Poem" design.
//

import SwiftUI

struct SharedPoemView: View {
    let poem: Poem
    let claimResponse: PoemShareClaimResponse?
    let onDone: () -> Void

    @Environment(\.openURL) private var openURL
    @State private var showSaveConfirmation: Bool = false
    @State private var isSaving: Bool = false

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Poem Card
                ScrollView(showsIndicators: false) {
                    poemCard
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                }

                // Bottom Section
                bottomSection
            }
        }
        .alert("Saved!", isPresented: $showSaveConfirmation) {
            Button("OK") { }
        } message: {
            Text("This poem has been saved to your library.")
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            // Done Button
            Button {
                onDone()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }

            Spacer()

            // Share Forward Button
            Button {
                shareOnSocial()
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(DesignTokens.gold)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .frame(height: 56)
    }

    // MARK: - Poem Card

    private var poemCard: some View {
        VStack(spacing: 0) {
            // Top Flourish
            Text("\u{2726} \u{2500}\u{2500}\u{2500} \u{2726}")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.gold.opacity(0.3))

            Spacer().frame(height: 16)

            // Title
            Text("For \(poem.recipientName)")
                .font(.custom("PlayfairDisplay-SemiBold", size: 26))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            // Occasion
            Text(occasionDisplayName)
                .font(.system(size: 13, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.gold)
                .padding(.top, 4)

            Spacer().frame(height: 16)

            // Top Divider
            goldDivider

            Spacer().frame(height: 16)

            // Verses
            VStack(spacing: 20) {
                ForEach(poem.verses, id: \.self) { verse in
                    Text(verse)
                        .font(.custom("PlayfairDisplay-Regular", size: 16))
                        .italic()
                        .foregroundColor(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(6)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 4)

            Spacer().frame(height: 16)

            // Bottom Divider
            goldDivider

            Spacer().frame(height: 12)

            // Attribution
            Text("With love from the sender")
                .font(.system(size: 13))
                .foregroundColor(DesignTokens.textTertiary)

            // Date
            Text(formattedDate)
                .font(.system(size: 12))
                .foregroundColor(DesignTokens.textTertiary.opacity(0.7))
                .padding(.top, 4)

            // Bottom Flourish
            Text("\u{2726}")
                .font(.system(size: 12))
                .foregroundColor(DesignTokens.gold.opacity(0.3))
                .padding(.top, 8)
        }
        .padding(28)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(DesignTokens.gold.opacity(0.25), lineWidth: 1)
                )
        )
    }

    private var goldDivider: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        DesignTokens.gold.opacity(0),
                        DesignTokens.gold,
                        DesignTokens.gold.opacity(0)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(width: 180, height: 1)
    }

    // MARK: - Bottom Section

    private var bottomSection: some View {
        VStack(spacing: 16) {
            // Action Buttons
            HStack(spacing: 12) {
                // Save Button
                if claimResponse?.allowSave == true {
                    Button {
                        saveToLibrary()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: isSaving ? "checkmark" : "square.and.arrow.down")
                                .font(.system(size: 16))
                            Text(isSaving ? "Saved" : "Save")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundColor(DesignTokens.textPrimary)
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                        .background(DesignTokens.cardBackground)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(DesignTokens.border, lineWidth: 1)
                        )
                    }
                    .disabled(isSaving)
                }

                // Thank Button
                Button {
                    shareThankYou()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 16))
                        Text("Thank")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(DesignTokens.background)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(DesignTokens.gold)
                    .clipShape(Capsule())
                }
            }

            // Social Label
            Text("Share on Social")
                .font(.system(size: 11))
                .foregroundColor(DesignTokens.textTertiary)

            // Social Buttons
            HStack(spacing: 16) {
                // Instagram
                socialButton(
                    icon: "camera.fill",
                    gradient: LinearGradient(
                        colors: [Color(hex: "833AB4"), Color(hex: "E1306C"), Color(hex: "F77737")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                ) {
                    shareToInstagram()
                }

                // Facebook
                socialButton(
                    icon: "f.circle.fill",
                    gradient: LinearGradient(
                        colors: [Color(hex: "1877F2"), Color(hex: "1877F2")],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                ) {
                    shareToFacebook()
                }

                // X/Twitter
                socialButton(
                    icon: "xmark",
                    gradient: LinearGradient(
                        colors: [.black, .black],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    border: true
                ) {
                    shareToTwitter()
                }
            }

            // Branding
            Text("Created with Porizo")
                .font(.system(size: 11))
                .foregroundColor(DesignTokens.textTertiary.opacity(0.7))

            Button {
                reportAbuse()
            } label: {
                Label("Report Abuse", systemImage: "flag.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DesignTokens.warning)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 34)
    }

    private func socialButton(
        icon: String,
        gradient: LinearGradient,
        border: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(gradient)
                    .frame(width: 44, height: 44)

                if border {
                    Circle()
                        .stroke(Color(hex: "333333"), lineWidth: 1)
                        .frame(width: 44, height: 44)
                }

                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
            }
        }
    }

    // MARK: - Helpers

    private var occasionDisplayName: String {
        switch poem.occasion.lowercased() {
        case "birthday": return "Happy Birthday"
        case "anniversary": return "Happy Anniversary"
        case "thank_you": return "Thank You"
        case "i_love_you": return "With Love"
        case "wedding": return "Wedding Wishes"
        case "graduation": return "Congratulations"
        case "celebration": return "Celebration"
        case "apology": return "An Apology"
        case "encouragement": return "Encouragement"
        case "advice": return "Words of Advice"
        case "bereavement": return "In Loving Memory"
        default: return "A Poem"
        }
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM d, yyyy"
        return formatter.string(from: Date())
    }

    private func saveToLibrary() {
        guard !isSaving else { return }
        isSaving = true

        var cachedPoems = LocalCache.shared.loadPoems()?.data ?? []
        if !cachedPoems.contains(where: { $0.id == poem.id }) {
            cachedPoems.insert(poem, at: 0)
            LocalCache.shared.savePoems(cachedPoems)
        }
        showSaveConfirmation = true
    }

    private func shareOnSocial() {
        let text = """
        For \(poem.recipientName)

        \(poem.verses.joined(separator: "\n\n"))

        — Created with Porizo
        """

        let activityVC = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func shareToInstagram() {
        // Instagram Stories requires image, fall back to general share
        shareOnSocial()
    }

    private func shareToFacebook() {
        let text = "Check out this beautiful poem! Created with @Porizo"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let url = URL(string: "fb://composer?text=\(encoded)") {
            UIApplication.shared.open(url)
        } else {
            shareOnSocial()
        }
    }

    private func shareToTwitter() {
        let text = "For \(poem.recipientName) - a beautiful poem created with @Porizo"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let url = URL(string: "twitter://post?text=\(encoded)") {
            UIApplication.shared.open(url)
        } else {
            shareOnSocial()
        }
    }

    private func shareThankYou() {
        let text = "Thank you for the beautiful poem for \(poem.recipientName)."
        let activityVC = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func reportAbuse() {
        let subject = "Report abusive shared poem"
        let body = """
        Poem ID: \(poem.id)
        Recipient: \(poem.recipientName)
        Occasion: \(poem.occasion)

        Please review this shared content.
        """

        let subjectEncoded = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let bodyEncoded = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let url = URL(string: "mailto:abuse@porizo.co?subject=\(subjectEncoded)&body=\(bodyEncoded)") else {
            return
        }
        openURL(url)
    }
}

#Preview {
    SharedPoemView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Another year of wonder,\nAnother year of light,\nMay every dawn bring blessings,\nAnd every dream take flight.",
                "Through laughter shared and stories told,\nThrough moments big and small,\nYou bring such joy to everyone—\nThe brightest gift of all."
            ],
            createdAt: "2026-01-27",
            updatedAt: "2026-01-27"
        ),
        claimResponse: PoemShareClaimResponse(
            status: "claimed",
            poem: nil,
            allowSave: true,
            expiresAt: nil
        ),
        onDone: { }
    )
}
