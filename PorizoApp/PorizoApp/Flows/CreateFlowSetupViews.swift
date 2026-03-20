//
//  CreateFlowSetupViews.swift
//  PorizoApp
//
//  Setup and entry composition views for the create flow.
//

import SwiftUI

struct CreateFlowHeaderView: View {
    let currentStepIndex: Int
    let totalStepCount: Int
    let onClose: () -> Void

    var body: some View {
        HStack {
            Color.clear.frame(width: 44, height: 44)

            Spacer()

            HStack(spacing: 8) {
                ForEach(0..<totalStepCount, id: \.self) { index in
                    Circle()
                        .fill(index <= currentStepIndex ? DesignTokens.gold : Color(hex: "#333333"))
                        .frame(width: 8, height: 8)
                }
            }

            Spacer()

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }
}

struct CreateFlowTypeSelectionView: View {
    let onSelectSong: () -> Void
    let onSelectPoem: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("What would you\nlike to create?")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.top, 32)
                    .padding(.bottom, 32)

                CreateTypeCardView(
                    icon: "music.note.list",
                    title: "A Song",
                    description: "Create a personalized song for someone special. Choose an occasion, add a message, and hear it in your voice.",
                    gradientColors: [DesignTokens.gold.opacity(0.3), DesignTokens.gold.opacity(0.05)],
                    action: onSelectSong
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 14)

                CreateTypeCardView(
                    icon: "text.book.closed",
                    title: "A Poem",
                    description: "Craft heartfelt words for any moment. Personalize with their name, occasion, and your feelings.",
                    gradientColors: [DesignTokens.roseGold.opacity(0.2), DesignTokens.roseGold.opacity(0.05)],
                    action: onSelectPoem
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 32)

                Text("Not sure? Start with a song")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textTertiary)

                Spacer(minLength: 120)
            }
        }
    }
}

struct CreateFlowMergedSetupView: View {
    let selectedType: CreateFlowKind?
    @Binding var setup: StorySetup
    @Binding var isInstrumental: Bool
    @Binding var hasOwnLyrics: Bool
    let canContinue: Bool
    let onBack: () -> Void
    let onContinue: () -> Void

    private var mergedOccasionOptions: [Occasion] {
        Occasion.allCases
    }

    @Environment(StyleStore.self) private var styleStore

    private var mergedStyleOptions: [StyleOption] {
        styleStore.styles
    }

    private var mergedToneOptions: [PoemTone] {
        [.heartfelt, .playful, .formal, .poetic, .simple]
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Button(action: onBack) {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    .accessibilityLabel("Back")
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                ScrollView {
                    VStack(spacing: 24) {
                        VStack(spacing: 8) {
                            Text("Create your\n\(selectedType == .poem ? "poem" : "song")")
                                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                                .foregroundStyle(DesignTokens.textPrimary)
                                .multilineTextAlignment(.center)
                            Text("Tell us about your gift")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        .padding(.top, 8)

                        VStack(alignment: .leading, spacing: 8) {
                            Text("For")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)

                            HStack(spacing: 12) {
                                Image(systemName: "person")
                                    .foregroundStyle(DesignTokens.textTertiary)
                                TextField("Their name...", text: $setup.recipientName)
                                    .textFieldStyle(.plain)
                                    .foregroundStyle(DesignTokens.textPrimary)
                                    .textInputAutocapitalization(.words)
                            }
                            .padding(14)
                            .background(DesignTokens.inputBackground)
                            .clipShape(.rect(cornerRadius: 12))
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Occasion")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                ForEach(mergedOccasionOptions) { occasion in
                                    OccasionOptionButton(
                                        occasion: occasion,
                                        isSelected: setup.occasion == occasion,
                                        action: { setup.occasion = occasion }
                                    )
                                }
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text(selectedType == .poem ? "Tone" : "Style")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)

                            ScrollView(.horizontal) {
                                HStack(spacing: 10) {
                                    if selectedType == .poem {
                                        ForEach(mergedToneOptions) { tone in
                                            ToneChipView(
                                                tone: tone,
                                                isSelected: setup.tone == tone,
                                                action: { setup.tone = tone }
                                            )
                                        }
                                    } else {
                                        ForEach(mergedStyleOptions) { option in
                                            StyleChipView(
                                                style: option,
                                                isSelected: setup.style == option.key,
                                                action: { setup.style = option.key }
                                            )
                                        }
                                    }
                                }
                            }
                            .scrollIndicators(.hidden)
                        }

                        if selectedType == .song {
                            SongSetupOptionsView(
                                isInstrumental: $isInstrumental,
                                hasOwnLyrics: $hasOwnLyrics
                            )
                        }

                        VelvetButton("Continue", style: .primary, isDisabled: !canContinue, action: onContinue)
                            .padding(.top, 8)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
            }
        }
    }
}

private struct CreateTypeCardView: View {
    let icon: String
    let title: String
    let description: String
    let gradientColors: [Color]
    let action: () -> Void

    var body: some View {
        Button(action: {
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            action()
        }) {
            HStack(spacing: 16) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(LinearGradient(colors: [DesignTokens.gold, DesignTokens.goldDark], startPoint: .top, endPoint: .bottom))
                    .frame(width: 4, height: 80)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Image(systemName: icon)
                            .font(.system(size: 22))
                            .foregroundStyle(DesignTokens.gold)
                        Text(title)
                            .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                    }
                    Text(description)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineSpacing(3)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .padding(16)
            .frame(height: 120)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                    .fill(LinearGradient(colors: gradientColors, startPoint: .leading, endPoint: .trailing))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(description)
    }
}

private struct OccasionOptionButton: View {
    let occasion: Occasion
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(occasion.emoji)
                    .font(.system(size: 16))
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? .black : DesignTokens.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct StyleChipView: View {
    let style: StyleOption
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(style.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct ToneChipView: View {
    let tone: PoemTone
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(tone.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct SongSetupOptionsView: View {
    @Binding var isInstrumental: Bool
    @Binding var hasOwnLyrics: Bool

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                HStack(spacing: 10) {
                    Image(systemName: "music.note")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.textSecondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Instrumental Only")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("No vocals, just the music")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                Spacer()
                Toggle("", isOn: $isInstrumental)
                    .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                    .labelsHidden()
            }
            .padding(14)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 12))

            if !isInstrumental {
                HStack {
                    HStack(spacing: 10) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 16))
                            .foregroundStyle(DesignTokens.textSecondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("I'll write my own lyrics")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Provide your own words")
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundStyle(DesignTokens.textTertiary)
                        }
                    }
                    Spacer()
                    Toggle("", isOn: $hasOwnLyrics)
                        .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                        .labelsHidden()
                }
                .padding(14)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 12))
            }
        }
    }
}
