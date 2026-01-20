//
//  PoemPreviewView.swift
//  PorizoApp
//
//  Displays the generated poem for review.
//

import SwiftUI

struct PoemPreviewView: View {
    let poem: Poem
    let onRegenerate: () -> Void
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        VStack(spacing: 8) {
                            Image(systemName: "text.book.closed")
                                .font(.system(size: 36))
                                .foregroundColor(DesignTokens.rose)

                            Text("Your Poem")
                                .font(.title2.bold())
                                .foregroundColor(DesignTokens.textPrimary)

                            Text(poem.title)
                                .font(.headline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                        .padding(.top, 16)

                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(poem.verses.indices, id: \.self) { index in
                                Text(poem.verses[index])
                                    .font(.body)
                                    .foregroundColor(DesignTokens.textPrimary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(16)
                        .background(DesignTokens.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .elevation(.level2)
                        .padding(.horizontal, 16)

                        Spacer(minLength: 80)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Button {
                        onRegenerate()
                    } label: {
                        Text("Try Different Version")
                            .font(.headline)
                            .foregroundColor(DesignTokens.rose)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(DesignTokens.roseMuted)
                            .cornerRadius(12)
                    }

                    Button {
                        onDone()
                    } label: {
                        Text("Done")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.rose)
                            .cornerRadius(12)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(DesignTokens.cardBackground)
            }
            .navigationTitle("Poem Preview")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

#Preview {
    PoemPreviewView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Chioma",
            recipientName: "Chioma",
            occasion: "birthday",
            tone: "heartfelt",
            status: "generated",
            verses: [
                "You are the morning light,",
                "Soft as the dawn we found together.",
                "Every step, a quiet blessing.",
            ],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        ),
        onRegenerate: { },
        onDone: { }
    )
}
