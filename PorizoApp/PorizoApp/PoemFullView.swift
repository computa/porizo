//
//  PoemFullView.swift
//  PorizoApp
//
//  Full-screen poem display matching v1.pen "20 - Poem Full View".
//

import SwiftUI

struct PoemFullView: View {
    let poem: Poem
    var onBack: (() -> Void)?
    var onMenu: (() -> Void)?
    var onListen: (() -> Void)?
    var onShare: (() -> Void)?

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                ScrollView(showsIndicators: false) {
                    poemCard
                        .padding(.vertical, 16)
                }

                if onListen != nil || onShare != nil {
                    actionBar
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                        .accessibilityLabel("Go back")
                }
            } else {
                Color.clear.frame(width: 44, height: 44)
            }

            Spacer()

            if let onMenu {
                Button(action: onMenu) {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                        .accessibilityLabel("Poem options")
                }
            } else {
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Poem Card

    private var poemCard: some View {
        VStack {
            VStack(spacing: 16) {
                Text("✦ ─── ✦")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.gold.opacity(0.5))
                    .frame(maxWidth: .infinity)

                Text("For \(poem.recipientName)")
                    .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)

                Text("A \(occasionTitle) Poem")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.gold)
                    .tracking(1)

                dividerLine

                VStack(spacing: 20) {
                    ForEach(poem.verses.indices, id: \.self) { index in
                        let verse = poem.verses[index]
                        if verse.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Spacer().frame(height: 8)
                        } else {
                            Text(verse)
                                .font(DesignTokens.displayFont(size: 18))
                                .italic()
                                .foregroundColor(DesignTokens.textPrimary)
                                .multilineTextAlignment(.center)
                                .lineSpacing(6)
                                .frame(maxWidth: .infinity)
                                .accessibilityLabel(verse)
                        }
                    }
                }
                .padding(.horizontal, 8)

                dividerLine

                Text("With love, from you")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textTertiary)

                Text("✦")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.gold.opacity(0.5))
            }
            .padding(32)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.radiusPremium)
                    .fill(DesignTokens.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusPremium)
                            .stroke(
                                LinearGradient(
                                    colors: [
                                        DesignTokens.gold.opacity(0.7),
                                        DesignTokens.gold.opacity(0.2),
                                        DesignTokens.gold.opacity(0.7)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                lineWidth: 1
                            )
                    )
                    .shadow(color: DesignTokens.gold.opacity(0.12), radius: 40, y: 8)
            )
            .padding(.horizontal, 20)
        }
    }

    private var dividerLine: some View {
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
            .frame(width: 200, height: 1)
    }

    // MARK: - Action Bar

    private var actionBar: some View {
        HStack(spacing: 12) {
            if let onListen {
                Button(action: onListen) {
                    HStack(spacing: 8) {
                        Image(systemName: "speaker.wave.2.fill")
                            .font(.system(size: 14))
                        Text("Listen")
                            .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    }
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DesignTokens.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusPill)
                            .stroke(DesignTokens.border, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusPill))
                    .accessibilityLabel("Listen to poem")
                }
            }

            if let onShare {
                Button(action: onShare) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14))
                        Text("Share")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    }
                    .foregroundColor(DesignTokens.background)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusPill))
                    .accessibilityLabel("Share poem")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 34)
    }

    private var occasionTitle: String {
        if let occasion = Occasion(rawValue: poem.occasion) {
            return occasion.displayName
        }
        return "Poem"
    }
}

#Preview {
    PoemFullView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            tone: "heartfelt",
            status: "generated",
            verses: [
                "Another year of wonder,",
                "Another year of light,",
                "May every dawn bring blessings,",
                "And every dream take flight."
            ],
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01"
        ),
        onBack: {},
        onMenu: {},
        onListen: {},
        onShare: {}
    )
}
