//
//  SuggestionChipsView.swift
//  PorizoApp
//
//  Contextual suggestion chips that appear below AI questions.
//  Tapping a chip submits it as the user's answer.
//

import SwiftUI

// MARK: - Suggestion Chips View

struct SuggestionChipsView: View {
    let suggestions: [String]
    let onSelect: (String) -> Void
    let isDisabled: Bool

    @State private var selectedSuggestion: String?

    init(suggestions: [String], isDisabled: Bool = false, onSelect: @escaping (String) -> Void) {
        self.suggestions = suggestions
        self.isDisabled = isDisabled
        self.onSelect = onSelect
    }

    var body: some View {
        if !suggestions.isEmpty && selectedSuggestion == nil {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        SuggestionChip(
                            text: suggestion,
                            isDisabled: isDisabled
                        ) {
                            withAnimation(.spring(response: 0.3)) {
                                selectedSuggestion = suggestion
                            }
                            onSelect(suggestion)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }
}

// MARK: - Suggestion Chip

struct SuggestionChip: View {
    let text: String
    let isDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: {
            guard !isDisabled else { return }
            onTap()
        }) {
            Text(text)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .cornerRadius(22)
                .overlay(
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .opacity(isDisabled ? 0.5 : 1.0)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 20) {
            Text("What makes this person special?")
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)

            SuggestionChipsView(
                suggestions: [
                    "A tradition we always have",
                    "The gift that meant the most",
                    "A birthday that didn't go as planned"
                ]
            ) { selected in
                print("Selected: \(selected)")
            }
        }
    }
}
