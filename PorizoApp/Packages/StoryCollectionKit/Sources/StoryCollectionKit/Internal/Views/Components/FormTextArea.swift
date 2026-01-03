//
//  FormTextArea.swift
//  StoryCollectionKit
//
//  A styled multi-line text area for form inputs.
//

import SwiftUI

/// Multiline text area for form sections - full width with good contrast
struct FormTextArea: View {
    let placeholder: String
    @Binding var text: String
    var minHeight: CGFloat = 80
    let theme: WizardTheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(.body)
                .foregroundColor(theme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: minHeight)
                .padding(12)
                .scrollContentBackground(.hidden)
                .background(Color.white)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(theme.borderColor, lineWidth: 1)
                )

            if text.isEmpty {
                Text(placeholder)
                    .font(.body)
                    .foregroundColor(Color(red: 156/255, green: 163/255, blue: 175/255)) // Gray-400
                    .padding(.horizontal, 16)
                    .padding(.vertical, 20)
                    .allowsHitTesting(false)
            }
        }
    }
}
