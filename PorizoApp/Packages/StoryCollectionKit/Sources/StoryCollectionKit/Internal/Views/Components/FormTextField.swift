//
//  FormTextField.swift
//  StoryCollectionKit
//
//  A styled text field for form inputs.
//

import SwiftUI

/// Styled text field for form sections - full width with good contrast
struct FormTextField: View {
    let placeholder: String
    @Binding var text: String
    let theme: WizardTheme

    var body: some View {
        TextField(placeholder, text: $text)
            .font(.body)
            .foregroundColor(theme.textPrimary)
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.white)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(theme.borderColor, lineWidth: 1)
            )
    }
}
