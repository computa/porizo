//
//  PostCreateComposerView.swift
//  PorizoApp
//
//  Option 2: "Slide-Up Composer" — Lyrics appear in a half-sheet overlay.
//  Chat is dimmed in background. Lyrics get dedicated editing space.
//  On approve, sheet transforms into render progress → player.
//

import SwiftUI


struct PostCreateComposerView: View {
    @State private var inputText = ""
    @State private var phase: ComposerPhase = .lyrics

    enum ComposerPhase {
        case lyrics, rendering, player
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Song for Sarah")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text(phaseSubtitle)
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.gold)
                    }

                    Spacer()

                    // Phase dots
                    HStack(spacing: 6) {
                        ForEach(0..<3) { i in
                            Circle()
                                .fill(i <= phaseIndex ? DesignTokens.gold : DesignTokens.border)
                                .frame(width: 6, height: 6)
                        }
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

                // Dimmed chat background (previous conversation)
                ZStack {
                    VStack(spacing: 8) {
                        dimmedBubble("She makes the WORST puns...", isUser: true)
                        dimmedBubble("Sarah sounds irreplaceable. Last one: what would you want her to hear?", isUser: false)
                        dimmedBubble("Here's to 30 more years of mountains.", isUser: true)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .opacity(0.3)
                    DesignTokens.background.opacity(0.6)
                }
                .frame(height: phase == .player ? 80 : 140)

                // Phase content
                switch phase {
                case .lyrics:
                    composerSheet
                case .rendering:
                    renderingSheet
                case .player:
                    playerSheet
                }
            }
        }
        .navigationBarHidden(true)
    }

    private var phaseSubtitle: String {
        switch phase {
        case .lyrics: return "Lyrics Review"
        case .rendering: return "Rendering..."
        case .player: return "Song Ready!"
        }
    }

    private var phaseIndex: Int {
        switch phase {
        case .lyrics: return 0
        case .rendering: return 1
        case .player: return 2
        }
    }

    // MARK: - Rendering Sheet

    private var renderingSheet: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 20)

            VStack(spacing: 24) {
                // Waveform animation placeholder
                HStack(spacing: 3) {
                    ForEach(0..<20, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(DesignTokens.gold.opacity(Double(i % 3 == 0 ? 0.8 : 0.3)))
                            .frame(width: 4, height: CGFloat.random(in: 8...32))
                    }
                }
                .frame(height: 36)

                RenderingProgressCard(progress: 0.62, statusText: "Composing acoustic arrangement...")

                // Steps
                VStack(alignment: .leading, spacing: 12) {
                    renderStep("Lyrics finalized", done: true)
                    renderStep("Melody composed", done: true)
                    renderStep("Acoustic arrangement", done: false, active: true)
                    renderStep("Vocal synthesis", done: false)
                    renderStep("Final mix & master", done: false)
                }
                .padding(.horizontal, 4)

                Spacer()

                // Skip / wait
                Button {
                    withAnimation { phase = .player }
                } label: {
                    Text("See completed song →")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                }
                .padding(.bottom, 20)
            }
            .padding(.horizontal, 20)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func renderStep(_ text: String, done: Bool, active: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : (active ? "circle.dotted" : "circle"))
                .font(.system(size: 16))
                .foregroundStyle(done ? DesignTokens.success : (active ? DesignTokens.gold : DesignTokens.textTertiary))
            Text(text)
                .font(DesignTokens.bodyFont(size: 14, weight: active ? .semibold : .regular))
                .foregroundStyle(done ? DesignTokens.textSecondary : (active ? DesignTokens.textPrimary : DesignTokens.textTertiary))
        }
    }

    // MARK: - Player Sheet

    private var playerSheet: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 16)

            ScrollView {
                VStack(spacing: 16) {
                    // Success badge
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(DesignTokens.success)
                        Text("Song Created!")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                    }

                    SongPlayerCard()

                    // Back to lyrics
                    Button {
                        withAnimation { phase = .lyrics }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "music.note.list")
                                .font(.system(size: 12))
                            Text("View Lyrics")
                        }
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(DesignTokens.background)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    // MARK: - Composer Sheet

    private var composerSheet: some View {
        VStack(spacing: 0) {
            // Sheet handle
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Title
                    HStack {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 14))
                            .foregroundStyle(DesignTokens.gold)
                        Text("Your Lyrics")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        Text("Acoustic")
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(DesignTokens.border.opacity(0.5))
                            .clipShape(Capsule())
                    }

                    // Lyrics with line numbers
                    ForEach(mockLyrics) { section in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(section.type.rawValue.uppercased())
                                .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                                .foregroundStyle(section.type == .chorus ? DesignTokens.gold : DesignTokens.textTertiary)
                                .tracking(1)

                            ForEach(Array(section.lines.enumerated()), id: \.offset) { i, line in
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(i + 1)")
                                        .font(DesignTokens.bodyFont(size: 11))
                                        .foregroundStyle(DesignTokens.textTertiary)
                                        .frame(width: 16, alignment: .trailing)
                                    Text(line)
                                        .font(DesignTokens.bodyFont(size: 14))
                                        .foregroundStyle(DesignTokens.textPrimary)
                                        .lineSpacing(2)
                                }
                            }
                        }
                        .padding(12)
                        .background(DesignTokens.background.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }

            // Bottom actions
            VStack(spacing: 10) {
                Divider().background(DesignTokens.border)

                // Quick actions
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        composerAction(icon: "arrow.triangle.2.circlepath", label: "Reroll All")
                        composerAction(icon: "music.note", label: "Change Chorus")
                        composerAction(icon: "face.smiling", label: "Funnier")
                        composerAction(icon: "heart", label: "More Emotional")
                    }
                    .padding(.horizontal, 16)
                }
                .scrollIndicators(.hidden)

                // Approve button
                Button { withAnimation { phase = .rendering } } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark")
                        Text("Approve & Render")
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
                HStack {
                    TextField("Suggest a change...", text: $inputText)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Button {} label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(DesignTokens.border, lineWidth: 0.5))
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func composerAction(icon: String, label: String) -> some View {
        Button {} label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
            }
            .foregroundStyle(DesignTokens.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(DesignTokens.background)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
        }
    }

    private func dimmedBubble(_ text: String, isUser: Bool) -> some View {
        HStack {
            if isUser { Spacer(minLength: 80) }
            Text(text)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(isUser ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isUser ? DesignTokens.gold : DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .lineLimit(2)
            if !isUser { Spacer(minLength: 80) }
        }
    }
}

