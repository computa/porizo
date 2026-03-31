//
//  InlineNamePromptView.swift
//  PorizoApp
//
//  Extracted from UnifiedCreateFlowView — inline name prompt shown
//  before the conversation starts. Owns the text field @State so
//  keystrokes don't re-evaluate the entire parent body.
//

import SwiftUI

struct InlineNamePromptView: View {
    let selectedType: CreateFlowKind?
    var preselectedOccasion: String?
    @Binding var hasOwnLyrics: Bool
    @Binding var isInstrumental: Bool
    let onStart: (String) -> Void
    let onCancel: () -> Void

    @State private var nameInput: String = ""

    private var trimmedName: String {
        nameInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with close button
            HStack {
                Spacer()
                Button { onCancel() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            Spacer()

            VStack(spacing: 20) {
                Image(systemName: "sparkles")
                    .font(.system(size: 40))
                    .foregroundStyle(DesignTokens.gold)

                if let occasion = preselectedOccasion {
                    // Occasion chip confirming the preselection
                    Text(occasion)
                        .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(DesignTokens.gold.opacity(0.12))
                        .clipShape(Capsule())
                }

                Text(occasionHeading)
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Enter their name to get started")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)

                TextField("Their name...", text: $nameInput)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .textInputAutocapitalization(.words)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.border, lineWidth: 0.5)
                    )
                    .padding(.horizontal, 32)
                    .onSubmit { submit() }

                // Optional mode toggles
                if selectedType == .song {
                    HStack(spacing: 10) {
                        setupToggleChip(
                            "I'll write my own lyrics",
                            icon: "text.quote",
                            isOn: hasOwnLyrics
                        ) {
                            hasOwnLyrics.toggle()
                            if hasOwnLyrics { isInstrumental = false }
                        }
                        setupToggleChip(
                            "Instrumental",
                            icon: "waveform",
                            isOn: isInstrumental
                        ) {
                            isInstrumental.toggle()
                            if isInstrumental { hasOwnLyrics = false }
                        }
                    }
                    .padding(.horizontal, 32)
                }

                Button {
                    submit()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.right")
                        Text("Start")
                    }
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .disabled(trimmedName.isEmpty)
                .opacity(trimmedName.isEmpty ? 0.5 : 1.0)
                .padding(.horizontal, 32)
            }

            Spacer()
        }
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    // MARK: - Private

    private var occasionHeading: String {
        let typeLabel = selectedType == .poem ? "poem" : "song"
        if let occasion = preselectedOccasion {
            return "Create a \(occasion) \(typeLabel)"
        } else if selectedType != nil {
            return "Who is this \(typeLabel) for?"
        } else {
            return "Who is this for?"
        }
    }

    private func submit() {
        guard !trimmedName.isEmpty else { return }
        onStart(trimmedName)
    }

    private func setupToggleChip(_ label: String, icon: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isOn ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
            .foregroundStyle(isOn ? DesignTokens.gold : DesignTokens.textTertiary)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(isOn ? DesignTokens.gold.opacity(0.3) : DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}
