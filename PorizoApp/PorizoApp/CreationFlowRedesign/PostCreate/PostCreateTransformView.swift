//
//  PostCreateTransformView.swift
//  PorizoApp
//
//  Option 3: "Two-Phase Transform" — The chat workspace transforms into
//  a lyrics workspace. Same space, evolved purpose. Header changes,
//  story elements collapse, main area becomes lyrics view.
//

import SwiftUI


struct PostCreateTransformView: View {
    @State private var inputText = ""
    @State private var selectedSection: Int? = 1 // chorus selected
    @State private var phase: TransformPhase = .lyrics

    enum TransformPhase {
        case lyrics, rendering, player
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Transformed header
                headerBar

                // Story summary pill (collapsed context)
                storySummaryPill

                switch phase {
                case .lyrics:
                    lyricsContent
                case .rendering:
                    renderingContent
                case .player:
                    playerContent
                }
            }
        }
        .navigationBarHidden(true)
    }

    // MARK: - Lyrics Content

    private var lyricsContent: some View {
        VStack(spacing: 0) {
            // Lyrics workspace
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Status
                    HStack(spacing: 8) {
                            Image(systemName: "sparkle")
                                .font(.system(size: 10))
                                .foregroundStyle(DesignTokens.gold)
                            Text("AI generated · tap any section to edit")
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }
                        .padding(.horizontal, 4)

                        // Lyrics sections (tappable)
                        ForEach(Array(mockLyrics.enumerated()), id: \.element.id) { index, section in
                            lyricsSectionCard(section, index: index, isSelected: selectedSection == index)
                        }

                        // AI suggestion
                        aiSuggestion

                        Spacer().frame(height: 100)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                }

                // Bottom bar
                bottomBar
            }
        }


    // MARK: - Rendering Content

    private var renderingContent: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    Spacer().frame(height: 20)

                    // Waveform
                    HStack(spacing: 3) {
                        ForEach(0..<24, id: \.self) { i in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(DesignTokens.gold.opacity(Double(i % 4 == 0 ? 0.9 : 0.25)))
                                .frame(width: 4, height: CGFloat.random(in: 10...36))
                        }
                    }
                    .frame(height: 40)

                    RenderingProgressCard(progress: 0.74, statusText: "Composing acoustic arrangement...")

                    // Steps
                    VStack(alignment: .leading, spacing: 14) {
                        transformRenderStep("Lyrics finalized", done: true)
                        transformRenderStep("Melody composed", done: true)
                        transformRenderStep("Acoustic arrangement", done: true)
                        transformRenderStep("Vocal synthesis", done: false, active: true)
                        transformRenderStep("Final mix & master", done: false)
                    }

                    Spacer().frame(height: 40)
                }
                .padding(.horizontal, 20)
            }

            // See result button
            Button { withAnimation { phase = .player } } label: {
                Text("See completed song →")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
            .background(DesignTokens.background)
        }
    }

    private func transformRenderStep(_ text: String, done: Bool, active: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : (active ? "circle.dotted" : "circle"))
                .font(.system(size: 16))
                .foregroundStyle(done ? DesignTokens.success : (active ? DesignTokens.gold : DesignTokens.textTertiary))
            Text(text)
                .font(DesignTokens.bodyFont(size: 14, weight: active ? .semibold : .regular))
                .foregroundStyle(done ? DesignTokens.textSecondary : (active ? DesignTokens.textPrimary : DesignTokens.textTertiary))
        }
    }

    // MARK: - Player Content

    private var playerContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Success
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.success)
                    Text("Song Created!")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .padding(.top, 12)

                SongPlayerCard()

                // Back to lyrics / chat
                HStack(spacing: 12) {
                    Button { withAnimation { phase = .lyrics } } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "music.note.list")
                                .font(.system(size: 11))
                            Text("Lyrics")
                        }
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(DesignTokens.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                    }

                    Button {} label: {
                        HStack(spacing: 5) {
                            Image(systemName: "bubble.left.fill")
                                .font(.system(size: 11))
                            Text("Back to Chat")
                        }
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(DesignTokens.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                    }
                }

                Spacer().frame(height: 20)
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Transformed Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            // Mode indicator
            HStack(spacing: 6) {
                Image(systemName: phase == .lyrics ? "music.note.list" : (phase == .rendering ? "waveform" : "checkmark.seal.fill"))
                    .font(.system(size: 12))
                    .foregroundStyle(phase == .player ? DesignTokens.success : DesignTokens.gold)
                Text(phase == .lyrics ? "Lyrics" : (phase == .rendering ? "Rendering" : "Ready"))
                    .font(DesignTokens.bodyFont(size: 11, weight: .bold))
                    .foregroundStyle(phase == .player ? DesignTokens.success : DesignTokens.gold)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(DesignTokens.gold.opacity(0.12))
            .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 1) {
                Text("Sarah's Birthday Song")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Acoustic  ·  4 sections")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Spacer()

            Button {} label: {
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

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

    // MARK: - Story Summary Pill

    private var storySummaryPill: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text.fill")
                .font(.system(size: 10))
                .foregroundStyle(DesignTokens.gold)
            Text("Sarah · 30th Birthday · Mt. Tam · 10yr friendship")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textSecondary)
                .lineLimit(1)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(DesignTokens.textTertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(DesignTokens.border, lineWidth: 0.5))
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    // MARK: - Lyrics Section Card

    private func lyricsSectionCard(_ section: MockLyricsSection, index: Int, isSelected: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            HStack {
                Text(section.type.rawValue.uppercased())
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(isSelected ? DesignTokens.gold : DesignTokens.textTertiary)
                    .tracking(1)
                Spacer()
                if isSelected {
                    HStack(spacing: 8) {
                        miniAction(icon: "arrow.triangle.2.circlepath", label: "Reroll")
                        miniAction(icon: "pencil", label: "Edit")
                    }
                }
            }

            // Lines
            ForEach(section.lines, id: \.self) { line in
                Text(line)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(3)
            }
        }
        .padding(14)
        .background(isSelected ? DesignTokens.gold.opacity(0.05) : DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? DesignTokens.gold.opacity(0.3) : DesignTokens.border.opacity(0.5), lineWidth: isSelected ? 1 : 0.5)
        )
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedSection = selectedSection == index ? nil : index
            }
        }
        .accessibilityAddTraits(.isButton)
    }

    private func miniAction(icon: String, label: String) -> some View {
        Button {} label: {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 9))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 10, weight: .medium))
            }
            .foregroundStyle(DesignTokens.gold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(DesignTokens.gold.opacity(0.1))
            .clipShape(Capsule())
        }
    }

    // MARK: - AI Suggestion

    private var aiSuggestion: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkle")
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.gold)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 6) {
                Text("The chorus could hit harder if you reference the Golden Gate fog. Want me to try?")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .italic()

                HStack(spacing: 8) {
                    Button {} label: {
                        Text("Yes, try it")
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(DesignTokens.gold.opacity(0.12))
                            .clipShape(Capsule())
                    }
                    Button {} label: {
                        Text("No, keep it")
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(DesignTokens.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                    }
                }
            }
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.gold.opacity(0.1), lineWidth: 0.5))
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        VStack(spacing: 8) {
            // Approve
            Button { withAnimation { phase = .rendering } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark")
                    Text("Approve & Render Song")
                }
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
            .padding(.horizontal, 16)

            // Feedback input
            storyInputBar(text: $inputText)
        }
        .background(DesignTokens.background)
    }
}

