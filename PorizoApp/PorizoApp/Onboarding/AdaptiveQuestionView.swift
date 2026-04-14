//
//  AdaptiveQuestionView.swift
//  PorizoApp
//
//  Screens 7-8: Renders any single_select_or_text or single_select node.
//  Emotional seed nodes use chips + optional free text.
//  Occasion picker uses chips only with auto-advance.
//

import SwiftUI

struct AdaptiveQuestionView: View {
    let resolvedQuestion: String
    let options: [GraphNodeOption]
    let allowFreeText: Bool
    var preselectedValue: String? = nil
    let onContinue: (String) -> Void

    @State private var selectedValue: String?
    @State private var hasCommitted = false
    @State private var showFreeText = false
    @State private var freeTextInput = ""
    @FocusState private var freeTextFocused: Bool

    private var trimmedFreeText: String {
        freeTextInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 60)

                        VStack(spacing: DesignTokens.spacing24) {
                            Text(resolvedQuestion)
                                .font(DesignTokens.displayFont(size: 28))
                                .foregroundStyle(DesignTokens.textPrimary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, DesignTokens.spacing20)

                            // Chip options
                            VStack(spacing: DesignTokens.spacing12) {
                                ForEach(options) { option in
                                    let optionValue = option.value ?? ""
                                    let isSelected = selectedValue == optionValue && !showFreeText
                                    Button {
                                        guard !hasCommitted || showFreeText else { return }
                                        showFreeText = false
                                        freeTextFocused = false
                                        withAnimation(.easeInOut(duration: 0.15)) {
                                            selectedValue = optionValue
                                        }
                                        hasCommitted = true
                                        if !allowFreeText {
                                            // Auto-advance for single_select (occasion picker)
                                            Task { @MainActor in
                                                try? await Task.sleep(for: .milliseconds(300))
                                                onContinue(optionValue)
                                            }
                                        } else {
                                            // For single_select_or_text, tap selects but needs Continue
                                            onContinue(optionValue)
                                        }
                                    } label: {
                                        HStack(spacing: DesignTokens.spacing8) {
                                            if let emoji = option.emoji {
                                                Text(emoji).font(.system(size: 18))
                                            }
                                            Text(option.label)
                                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                            Spacer()
                                        }
                                        .padding(.horizontal, DesignTokens.spacing16)
                                        .padding(.vertical, DesignTokens.spacing12)
                                    }
                                    .boldChipStyle(isSelected: isSelected)
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("onboarding-adaptive-\(optionValue)")
                                }

                                // "Write your own" expandable
                                if allowFreeText {
                                    Button {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            showFreeText = true
                                            selectedValue = nil
                                        }
                                        freeTextFocused = true
                                    } label: {
                                        HStack(spacing: DesignTokens.spacing8) {
                                            Image(systemName: "pencil")
                                                .font(.system(size: 14))
                                            Text("Write your own")
                                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                            Spacer()
                                        }
                                        .foregroundStyle(showFreeText ? DesignTokens.gold : DesignTokens.textSecondary)
                                        .padding(.horizontal, DesignTokens.spacing16)
                                        .padding(.vertical, DesignTokens.spacing12)
                                        .background(DesignTokens.surface)
                                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusChip))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: DesignTokens.radiusChip)
                                                .stroke(
                                                    showFreeText ? DesignTokens.gold : DesignTokens.border,
                                                    lineWidth: showFreeText ? 1.5 : 0.5
                                                )
                                        )
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("onboarding-adaptive-write-own")
                                    .accessibilityLabel("Write your own")
                                    .accessibilityHint("Opens a text field to type your own message")

                                    if showFreeText {
                                        TextField("Type your message...", text: $freeTextInput, axis: .vertical)
                                            .font(DesignTokens.bodyFont(size: 15))
                                            .foregroundStyle(DesignTokens.textPrimary)
                                            .focused($freeTextFocused)
                                            .lineLimit(3...6)
                                            .padding(.horizontal, DesignTokens.spacing16)
                                            .padding(.vertical, DesignTokens.spacing12)
                                            .background(DesignTokens.surface)
                                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                                    .stroke(DesignTokens.border, lineWidth: 1)
                                            )
                                            .transition(.opacity.combined(with: .move(edge: .top)))
                                            .accessibilityIdentifier("onboarding-adaptive-free-text")
                                    }
                                }

                                // Skip button for optional single-select (e.g. occasion picker)
                                if !allowFreeText {
                                    Button {
                                        hasCommitted = true
                                        // Send empty string — caller converts to nil occasion ("Just Because")
                                        onContinue("")
                                    } label: {
                                        Text("Continue")
                                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                            .foregroundStyle(DesignTokens.textSecondary)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 16)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("onboarding-adaptive-skip-continue")
                                    .accessibilityLabel("Continue without selecting")
                                }
                            }
                            .padding(.horizontal, DesignTokens.spacing20)
                        }

                        Spacer(minLength: 60)
                    }
                }
                .scrollDismissesKeyboard(.interactively)

                // Pinned free-text Continue button — outside ScrollView so it stays visible with keyboard
                if showFreeText && trimmedFreeText.count >= 2 {
                    Button {
                        freeTextFocused = false
                        onContinue(trimmedFreeText)
                    } label: {
                        Text("Continue")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, 40)
                    .accessibilityIdentifier("onboarding-adaptive-free-continue")
                }
            }
        }
        .accessibilityIdentifier("onboarding-adaptive-question")
        .onAppear {
            // Pre-highlight from engine state (e.g. goal_intent → occasion) or is_default flag
            if selectedValue == nil {
                if let preselected = preselectedValue {
                    selectedValue = preselected
                } else if let defaultOption = options.first(where: { $0.isDefault == true }) {
                    selectedValue = defaultOption.value ?? ""
                }
            }
        }
    }
}
