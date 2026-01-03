//
//  FormSectionCard.swift
//  StoryCollectionKit
//
//  A card container for form sections with title and optional helpers.
//

import SwiftUI

/// Card container for form sections with title, optional character count, and helper button
struct FormSectionCard<Content: View>: View {
    let title: String
    var characterCount: Int? = nil
    var maxCharacters: Int? = nil
    var helperButtonTitle: String? = nil
    var helperButtonAction: (() -> Void)? = nil
    let theme: WizardTheme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header row
            HStack {
                Text(title)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.textPrimary)

                Spacer()

                // Character count
                if let count = characterCount, let max = maxCharacters {
                    Text("\(count)/\(max)")
                        .font(.caption)
                        .foregroundColor(count > max ? theme.errorColor : theme.textTertiary)
                }
            }

            // Helper button if provided
            if let buttonTitle = helperButtonTitle, let action = helperButtonAction {
                Button(action: action) {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.caption)
                        Text(buttonTitle)
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(theme.primaryColor)
                }
            }

            content
        }
        .padding(16)
        .background(theme.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(theme.borderColor, lineWidth: 1)
        )
    }
}
