//
//  PostCreateAllInChatView.swift
//  PorizoApp
//
//  Option 1: "All-in-Chat" — Lyrics, editing, rendering, and player
//  all appear as messages in the same conversation thread.
//
//  Flow: Create tapped → "Writing lyrics..." → Lyrics card message →
//  Quick replies (Love it / Change chorus / Edit) → Revised lyrics →
//  "Rendering..." progress → Song player card as final message.
//

import SwiftUI

#if DEBUG

struct PostCreateAllInChatView: View {
    @State private var inputText = ""
    @State private var selectedStyle: String? = "Acoustic"

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Chat + lyrics + player all in one scroll
                ScrollView {
                    VStack(spacing: 12) {
                        // Previous chat context (last 2 messages)
                        previousChat

                        // AI: "Writing your lyrics..."
                        aiMessage("Writing Sarah's birthday lyrics in Acoustic style...")

                        // Lyrics card
                        lyricsCard

                        // Quick reply chips
                        quickReplies

                        // User chose to change chorus
                        userMessage("Can you make the chorus more emotional? Mention the fog on the Golden Gate")

                        // AI revised
                        aiMessage("Here's the updated chorus with the Golden Gate imagery:")

                        // Revised lyrics card (just chorus)
                        revisedChorusCard

                        // User approves
                        userMessage("Love it! Let's go with this")

                        // Rendering progress
                        renderingCard

                        // Final player
                        playerCard

                        Spacer().frame(height: 16)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                }

                // Input bar
                storyInputBar(text: $inputText)
            }
        }
        .navigationBarHidden(true)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .frame(width: 32, height: 32)
                Image(systemName: "music.note")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(DesignTokens.gold)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("Song for Sarah")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Birthday  ·  Acoustic")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.gold)
            }
            Spacer()
            Button {} label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Previous chat (context)

    private var previousChat: some View {
        VStack(spacing: 8) {
            userMessage("Here's to 30 more years of her dragging me up mountains.")
            aiMessage("That's beautiful. I have everything I need. Ready to create?")
        }
    }

    // MARK: - Lyrics Card (full)

    private var lyricsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "music.note.list")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("Generated Lyrics")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
                Spacer()
                Text("Acoustic")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DesignTokens.border.opacity(0.5))
                    .clipShape(Capsule())
            }

            ForEach(mockLyrics) { section in
                VStack(alignment: .leading, spacing: 4) {
                    Text(section.type.rawValue.uppercased())
                        .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .tracking(1)

                    ForEach(section.lines, id: \.self) { line in
                        Text(line)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(2)
                    }
                }
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5)
        )
    }

    // MARK: - Quick Replies

    private var quickReplies: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                quickReplyChip("Love it ✓", isPrimary: true)
                quickReplyChip("Change the chorus")
                quickReplyChip("Make it funnier")
                quickReplyChip("Edit a line")
            }
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quickReplyChip(_ text: String, isPrimary: Bool = false) -> some View {
        Button {} label: {
            Text(text)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isPrimary ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
                .foregroundStyle(isPrimary ? DesignTokens.gold : DesignTokens.textSecondary)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(isPrimary ? DesignTokens.gold.opacity(0.3) : DesignTokens.border, lineWidth: 0.5))
        }
    }

    // MARK: - Revised Chorus Card

    private var revisedChorusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.gold)
                Text("CHORUS — REVISED")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold)
                    .tracking(1)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text("Here's to you, here's to thirty more")
                Text("Of fog on the Golden Gate we'll explore")
                Text("You're the one who picks up at 3 AM")
                Text("Sarah, I'd climb every mountain again")
            }
            .font(DesignTokens.bodyFont(size: 14))
            .foregroundStyle(DesignTokens.textPrimary)
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.trailing, 50)
    }

    // MARK: - Rendering Card (sheet-style inline)

    private var renderingCard: some View {
        VStack(spacing: 0) {
            // Sheet handle
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            // Waveform
            HStack(spacing: 3) {
                ForEach(0..<20, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold.opacity(Double(i % 3 == 0 ? 0.8 : 0.3)))
                        .frame(width: 4, height: CGFloat.random(in: 8...32))
                }
            }
            .frame(height: 36)
            .padding(.bottom, 20)

            // Progress card
            RenderingProgressCard(progress: 0.62, statusText: "Composing acoustic arrangement...")
                .padding(.horizontal, 16)
                .padding(.bottom, 20)

            // Steps
            VStack(alignment: .leading, spacing: 14) {
                renderStep("Lyrics finalized", done: true)
                renderStep("Melody composed", done: true)
                renderStep("Acoustic arrangement", done: false, active: true)
                renderStep("Vocal synthesis", done: false)
                renderStep("Final mix & master", done: false)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    private func renderStep(_ text: String, done: Bool, active: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : (active ? "circle.dotted" : "circle"))
                .font(.system(size: 18))
                .foregroundStyle(done ? DesignTokens.success : (active ? DesignTokens.gold : DesignTokens.textTertiary))
            Text(text)
                .font(DesignTokens.bodyFont(size: 15, weight: active ? .bold : .regular))
                .foregroundStyle(done ? DesignTokens.textSecondary : (active ? DesignTokens.textPrimary : DesignTokens.textTertiary))
        }
    }

    // MARK: - Player Card (sheet-style inline)

    private var playerCard: some View {
        VStack(spacing: 0) {
            // Sheet handle
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 16)

            // Success badge
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.success)
                Text("Song Created!")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            .padding(.bottom, 16)

            // Shared player card
            SongPlayerCard()
                .padding(.horizontal, 16)

            // View Lyrics button
            Button {} label: {
                HStack(spacing: 6) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 12))
                    Text("View Lyrics")
                }
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(DesignTokens.surface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
            }
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    // MARK: - Message Helpers

    private func aiMessage(_ text: String) -> some View {
        HStack {
            Text(text)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textPrimary)
                .lineSpacing(3)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(DesignTokens.border.opacity(0.5), lineWidth: 0.5)
                )
            Spacer(minLength: 60)
        }
    }

    private func userMessage(_ text: String) -> some View {
        HStack {
            Spacer(minLength: 60)
            Text(text)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(.black)
                .lineSpacing(3)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: 18))
        }
    }
}

#endif
