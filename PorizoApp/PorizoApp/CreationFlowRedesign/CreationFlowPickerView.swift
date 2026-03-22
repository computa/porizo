//
//  CreationFlowPickerView.swift
//  PorizoApp
//
//  DEBUG-only picker for 3 creation flow redesign options.
//

import SwiftUI

#if DEBUG

struct CreationFlowPickerView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        UnifiedCreationFlowView()
                    } label: {
                        optionRow(
                            letter: "★",
                            title: "Unified Flow (B+1)",
                            subtitle: "Story Builder chat → All-in-Chat lyrics/render/player.",
                            icon: "sparkles"
                        )
                    }
                } header: {
                    Text("CHOSEN DESIGN")
                        .font(DesignTokens.bodyFont(size: 11, weight: .bold))
                        .foregroundStyle(DesignTokens.gold)
                        .tracking(1)
                }
                .listRowBackground(DesignTokens.gold.opacity(0.08))

                Section {
                    NavigationLink {
                        OptionALetterView()
                    } label: {
                        optionRow(
                            letter: "A",
                            title: "The Letter",
                            subtitle: "Write a heartfelt letter. AI weaves it into a song.",
                            icon: "envelope.open.fill"
                        )
                    }

                    NavigationLink {
                        OptionBConversationView()
                    } label: {
                        optionRow(
                            letter: "B",
                            title: "The Conversation",
                            subtitle: "Chat naturally. Your story builds in real-time.",
                            icon: "bubble.left.and.bubble.right.fill"
                        )
                    }

                    NavigationLink {
                        OptionCCanvasView()
                    } label: {
                        optionRow(
                            letter: "C",
                            title: "The Canvas",
                            subtitle: "Pick a vibe. Add a message. Done.",
                            icon: "square.grid.2x2.fill"
                        )
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Creation Flow Redesign")
                            .font(DesignTokens.displayFont(size: 20))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("3 alternatives for song/poem creation.\nEach shows a realistic multi-turn flow with mock data.")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .textCase(nil)
                    .padding(.bottom, 8)
                }
                .listRowBackground(DesignTokens.surface)

                Section {
                    NavigationLink {
                        PostCreateAllInChatView()
                    } label: {
                        optionRow(
                            letter: "1",
                            title: "All-in-Chat",
                            subtitle: "Lyrics, edits, render & player — all as chat messages.",
                            icon: "text.bubble.fill"
                        )
                    }

                    NavigationLink {
                        PostCreateComposerView()
                    } label: {
                        optionRow(
                            letter: "2",
                            title: "Slide-Up Composer",
                            subtitle: "Lyrics in a half-sheet. Chat dimmed behind.",
                            icon: "rectangle.bottomhalf.inset.filled"
                        )
                    }

                    NavigationLink {
                        PostCreateTransformView()
                    } label: {
                        optionRow(
                            letter: "3",
                            title: "Two-Phase Transform",
                            subtitle: "Chat workspace evolves into lyrics editor.",
                            icon: "arrow.triangle.swap"
                        )
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Post-Create: Lyrics & Render")
                            .font(DesignTokens.displayFont(size: 20))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("What happens after tapping Create.\nLyrics review, editing, rendering, and player.")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .textCase(nil)
                    .padding(.bottom, 8)
                }
                .listRowBackground(DesignTokens.surface)
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background)
            .navigationTitle("Creation Flow")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func optionRow(letter: String, title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 44, height: 44)
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(letter)
                        .font(DesignTokens.bodyFont(size: 11, weight: .bold))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(DesignTokens.gold.opacity(0.15))
                        .clipShape(Capsule())
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                Text(subtitle)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 6)
    }
}

#endif
