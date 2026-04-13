//
//  InlineNamePromptView.swift
//  PorizoApp
//
//  Name entry screen matching Warm Canvas prototype:
//  Occasion chips, Song/Poem toggle, name field, "Next →" CTA.
//

import SwiftUI

struct InlineNamePromptView: View {
    let selectedType: CreateFlowKind?
    var preselectedOccasion: String?
    @Binding var hasOwnLyrics: Bool
    @Binding var isInstrumental: Bool
    let onStart: (String, Occasion?, CreateFlowKind) -> Void
    let onCancel: () -> Void

    @State private var nameInput: String = ""
    @State private var selectedOccasion: String?
    @State private var activeType: CreateFlowKind = .song

    private static let occasions: [(emoji: String, label: String)] = Occasion.allCases
        .filter { $0 != .custom }
        .map { ($0.emoji, $0.displayName) }

    private var trimmedName: String {
        nameInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var heading: String {
        let typeLabel = activeType == .poem ? "poem" : "song"
        if let occ = selectedOccasion {
            return "Create a \(occ) \(typeLabel)"
        }
        return "Create a \(typeLabel)"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Close button
            HStack {
                Spacer()
                Button { onCancel() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(Color.black.opacity(0.05))
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)

            Spacer()

            VStack(spacing: 20) {
                // Sparkle icon
                Image(systemName: "sparkle")
                    .font(.system(size: 36))
                    .foregroundStyle(DesignTokens.gold)

                // Title
                Text(heading)
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                // Name field
                TextField("Their Name", text: $nameInput)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .textInputAutocapitalization(.words)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.border, lineWidth: 1.5)
                    )
                    .padding(.horizontal, 20)
                    .accessibilityIdentifier("name-entry-recipient-field")
                    .onSubmit { submit() }

                // Occasion chips
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Self.occasions, id: \.label) { item in
                            let isSelected = selectedOccasion == item.label
                            Button {
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    selectedOccasion = isSelected ? nil : item.label
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(item.emoji)
                                        .font(.system(size: 14))
                                    Text(item.label)
                                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                }
                                .foregroundStyle(isSelected ? DesignTokens.gold : DesignTokens.textPrimary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(DesignTokens.surface)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(
                                        isSelected ? DesignTokens.gold : DesignTokens.border,
                                        lineWidth: isSelected ? 1.5 : 1
                                    )
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("occasion-chip-\(item.label.lowercased())")
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .scrollIndicators(.hidden)

                // Song / Poem toggle (only when type is not pre-determined)
                if selectedType == nil {
                    HStack(spacing: 0) {
                        typeToggleButton("♪ A Song", type: .song)
                        typeToggleButton("📝 A Poem", type: .poem)
                    }
                    .padding(4)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.border, lineWidth: 1)
                    )
                    .padding(.horizontal, 20)
                }

                // Next button
                Button { submit() } label: {
                    Text("Next →")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(trimmedName.isEmpty)
                .opacity(trimmedName.isEmpty ? 0.5 : 1.0)
                .padding(.horizontal, 20)
            }

            Spacer()
        }
        .onAppear {
            selectedOccasion = preselectedOccasion
            activeType = selectedType ?? .song
        }
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    // MARK: - Helpers

    private func typeToggleButton(_ label: String, type: CreateFlowKind) -> some View {
        let isSelected = activeType == type
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                activeType = type
            }
        } label: {
            Text(label)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(isSelected ? DesignTokens.background : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func submit() {
        guard !trimmedName.isEmpty else { return }
        // Convert selected occasion label to Occasion enum
        let occasion: Occasion? = selectedOccasion.flatMap { label in
            Occasion.allCases.first { $0.displayName == label }
        }
        onStart(trimmedName, occasion, activeType)
    }
}
