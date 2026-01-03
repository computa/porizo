//
//  PorizoWizardTheme.swift
//  PorizoApp
//
//  Custom theme that maps PorizoApp's DesignTokens to StoryCollectionKit's WizardTheme.
//  This ensures the wizard matches the app's rose-accented design system.
//

import SwiftUI
import StoryCollectionKit

/// A WizardTheme implementation using Porizo's rose-accented design tokens.
///
/// Uses the warm stone neutral palette with rose accent colors
/// to match the rest of the PorizoApp experience.
struct PorizoWizardTheme: WizardTheme, @unchecked Sendable {
    // Primary accent - rose (the color of love and warmth)
    var primaryColor: Color { DesignTokens.rose }

    // Backgrounds
    var backgroundColor: Color { DesignTokens.background }
    var cardBackground: Color { DesignTokens.cardBackground }

    // Text colors
    var textPrimary: Color { DesignTokens.textPrimary }
    var textSecondary: Color { DesignTokens.textSecondary }
    var textTertiary: Color { DesignTokens.textTertiary }

    // Border
    var borderColor: Color { DesignTokens.cardBorder }

    // Input field background (subtle background for contrast)
    var inputBackground: Color { DesignTokens.backgroundSubtle }

    // Status colors
    var successColor: Color { DesignTokens.success }
    var warningColor: Color { DesignTokens.warning }
    var errorColor: Color { DesignTokens.error }
}
