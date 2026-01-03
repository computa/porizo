//
//  WizardTheme.swift
//  StoryCollectionKit
//
//  Protocol for customizing the wizard's visual appearance.
//

import SwiftUI

/// Protocol for customizing the wizard's visual theme.
///
/// Implement this protocol to provide custom colors that match your app's design system.
/// If not provided, the wizard uses its default theme.
public protocol WizardTheme: Sendable {
    /// Primary accent color (buttons, active states, highlights)
    var primaryColor: Color { get }

    /// Background color for the main view
    var backgroundColor: Color { get }

    /// Background color for cards and sections
    var cardBackground: Color { get }

    /// Primary text color
    var textPrimary: Color { get }

    /// Secondary/muted text color
    var textSecondary: Color { get }

    /// Tertiary/disabled text color
    var textTertiary: Color { get }

    /// Success state color (completed steps)
    var successColor: Color { get }

    /// Error state color
    var errorColor: Color { get }

    /// Warning state color
    var warningColor: Color { get }

    /// Card border color
    var borderColor: Color { get }
}

/// Default theme using rose accent colors
public struct DefaultWizardTheme: WizardTheme {
    public init() {}

    public var primaryColor: Color { Color(red: 244/255, green: 63/255, blue: 94/255) } // Rose-500
    public var backgroundColor: Color { Color(red: 249/255, green: 250/255, blue: 251/255) } // Gray-50
    public var cardBackground: Color { .white }
    public var textPrimary: Color { Color(red: 17/255, green: 24/255, blue: 39/255) } // Gray-900
    public var textSecondary: Color { Color(red: 107/255, green: 114/255, blue: 128/255) } // Gray-500
    public var textTertiary: Color { Color(red: 156/255, green: 163/255, blue: 175/255) } // Gray-400
    public var successColor: Color { Color(red: 34/255, green: 197/255, blue: 94/255) } // Green-500
    public var errorColor: Color { Color(red: 239/255, green: 68/255, blue: 68/255) } // Red-500
    public var warningColor: Color { Color(red: 245/255, green: 158/255, blue: 11/255) } // Amber-500
    public var borderColor: Color { Color(red: 229/255, green: 231/255, blue: 235/255) } // Gray-200
}
