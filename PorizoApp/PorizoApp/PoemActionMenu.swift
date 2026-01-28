//
//  PoemActionMenu.swift
//  PorizoApp
//
//  Action sheet menu for poem options.
//  Matches v1.pen "21 - Poem Action Menu" design.
//

import SwiftUI

struct PoemActionMenu: View {
    let poem: Poem
    let onShare: () -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var apiClient: APIClientWrapper

    @State private var showDeleteConfirmation: Bool = false
    @State private var isDeleting: Bool = false

    var body: some View {
        ZStack {
            DesignTokens.cardBackground.ignoresSafeArea()

            VStack(spacing: 16) {
                // Handle Bar
                Capsule()
                    .fill(DesignTokens.gold)
                    .frame(width: 36, height: 4)

                // Poem Preview Row
                poemPreviewRow

                // Divider
                Rectangle()
                    .fill(DesignTokens.border)
                    .frame(height: 1)

                // Actions List
                VStack(spacing: 0) {
                    // Listen Action
                    actionRow(
                        icon: "speaker.wave.2.fill",
                        title: "Listen to Poem",
                        iconColor: DesignTokens.textPrimary
                    ) {
                        // TODO: TTS feature
                        dismiss()
                    }

                    // Share Action
                    actionRow(
                        icon: "square.and.arrow.up",
                        title: "Share Poem",
                        iconColor: DesignTokens.gold,
                        showTopBorder: true
                    ) {
                        onShare()
                    }

                    // Copy Action
                    actionRow(
                        icon: "doc.on.doc",
                        title: "Copy Text",
                        iconColor: DesignTokens.textPrimary,
                        showTopBorder: true
                    ) {
                        copyPoemText()
                        dismiss()
                    }

                    // Delete Action
                    actionRow(
                        icon: "trash",
                        title: "Delete Poem",
                        iconColor: .red,
                        showTopBorder: true
                    ) {
                        showDeleteConfirmation = true
                    }
                }
                .background(DesignTokens.background)
                .clipShape(RoundedRectangle(cornerRadius: 12))

                // Cancel Button
                Button {
                    dismiss()
                } label: {
                    Text("Cancel")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(DesignTokens.background)
                        .clipShape(RoundedRectangle(cornerRadius: 28))
                        .overlay(
                            RoundedRectangle(cornerRadius: 28)
                                .stroke(DesignTokens.border, lineWidth: 1)
                        )
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 34)
        }
        .alert("Delete Poem?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                deletePoem()
            }
        } message: {
            Text("This poem will be permanently deleted. This action cannot be undone.")
        }
    }

    // MARK: - Poem Preview Row

    private var poemPreviewRow: some View {
        HStack(spacing: 12) {
            // Poem Icon
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(DesignTokens.background)
                    .frame(width: 48, height: 48)

                Image(systemName: "text.book.closed.fill")
                    .font(.system(size: 20))
                    .foregroundColor(DesignTokens.gold)
            }

            // Preview Info
            VStack(alignment: .leading, spacing: 4) {
                Text("For \(poem.recipientName)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)

                Text(poem.previewLines)
                    .font(.system(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            // Occasion Badge
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 36, height: 36)

                Text(occasionEmoji)
                    .font(.system(size: 16))
            }
        }
        .padding(.vertical, 12)
    }

    // MARK: - Action Row

    private func actionRow(
        icon: String,
        title: String,
        iconColor: Color,
        showTopBorder: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(iconColor)
                    .frame(width: 24)

                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(iconColor == .red ? .red : DesignTokens.textPrimary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .padding(16)
            .overlay(alignment: .top) {
                if showTopBorder {
                    Rectangle()
                        .fill(DesignTokens.border)
                        .frame(height: 1)
                }
            }
        }
    }

    // MARK: - Helpers

    private var occasionEmoji: String {
        switch poem.occasion.lowercased() {
        case "birthday": return "🎂"
        case "anniversary": return "💑"
        case "thank_you": return "🙏"
        case "i_love_you": return "❤️"
        case "wedding": return "💒"
        case "graduation": return "🎓"
        case "celebration": return "🎉"
        case "apology": return "💐"
        case "encouragement": return "💪"
        default: return "✨"
        }
    }

    private func copyPoemText() {
        let fullText = """
        For \(poem.recipientName)

        \(poem.verses.joined(separator: "\n\n"))

        — Created with Porizo
        """
        UIPasteboard.general.string = fullText
    }

    private func deletePoem() {
        isDeleting = true
        Task {
            do {
                try await apiClient.client.deletePoem(poemId: poem.id)
                await MainActor.run {
                    dismiss()
                    onDelete()
                }
            } catch {
                print("Failed to delete poem: \(error)")
                await MainActor.run {
                    isDeleting = false
                }
            }
        }
    }
}

#Preview {
    PoemActionMenu(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Another year of wonder,\nAnother year of light.",
                "May every dawn bring blessings."
            ],
            createdAt: "2026-01-27",
            updatedAt: "2026-01-27"
        ),
        onShare: { },
        onDelete: { }
    )
    .environmentObject(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
