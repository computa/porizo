//
//  DesignTokens.swift
//  PorizoApp
//
//  Design system tokens extracted from MainTabView for reuse across the app.
//  Light mode with rose accent - conveying love and friendship.
//

import SwiftUI

// MARK: - Design Tokens (matching product/design-system)

struct DesignTokens {
    // Colors (Tailwind stone palette - warm neutrals for light mode)
    static let background = Color(hex: "#ffffff")      // white
    static let backgroundSubtle = Color(hex: "#fafaf9") // stone-50
    static let cardBackground = Color(hex: "#ffffff")  // white
    static let cardBorder = Color(hex: "#e7e5e4")      // stone-200
    static let textPrimary = Color(hex: "#1c1917")     // stone-900
    static let textSecondary = Color(hex: "#78716c")   // stone-500
    static let textTertiary = Color(hex: "#a8a29e")    // stone-400

    // Accent color - rose (the color of love and warmth)
    static let rose = Color(hex: "#f43f5e")            // rose-500
    static let roseDark = Color(hex: "#e11d48")        // rose-600
    static let roseLight = Color(hex: "#fda4af")       // rose-300
    static let roseMuted = Color(hex: "#fff1f2")       // rose-50

    // Status colors
    static let success = Color(hex: "#22c55e")         // green-500
    static let warning = Color(hex: "#f59e0b")         // amber-500
    static let error = Color(hex: "#ef4444")           // red-500
}

// MARK: - Elevation System

/// Semantic elevation levels for consistent shadow depth across the app.
/// Higher levels = more prominent shadows = visually closer to user.
enum Elevation: CaseIterable {
    /// No shadow - flat elements, backgrounds
    case level0

    /// Subtle shadow - small cards, list items, inactive states
    /// radius: 4, y: 2, opacity: 0.04
    case level1

    /// Standard shadow - cards, sections, content containers
    /// radius: 8, y: 2, opacity: 0.05
    case level2

    /// Raised shadow - toasts, tooltips, dropdowns
    /// radius: 8, y: 4, opacity: 0.10
    case level3

    /// Elevated shadow - modals, dialogs, popovers
    /// radius: 12, y: 6, opacity: 0.15
    case level4

    var shadowColor: Color {
        Color.black
    }

    var shadowOpacity: Double {
        switch self {
        case .level0: return 0
        case .level1: return 0.04
        case .level2: return 0.05
        case .level3: return 0.10
        case .level4: return 0.15
        }
    }

    var shadowRadius: CGFloat {
        switch self {
        case .level0: return 0
        case .level1: return 4
        case .level2: return 8
        case .level3: return 8
        case .level4: return 12
        }
    }

    var shadowY: CGFloat {
        switch self {
        case .level0: return 0
        case .level1: return 2
        case .level2: return 2
        case .level3: return 4
        case .level4: return 6
        }
    }
}

// MARK: - Shadow View Modifier

struct ElevationModifier: ViewModifier {
    let elevation: Elevation

    func body(content: Content) -> some View {
        content
            .shadow(
                color: elevation.shadowColor.opacity(elevation.shadowOpacity),
                radius: elevation.shadowRadius,
                y: elevation.shadowY
            )
    }
}

struct AccentShadowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat
    let y: CGFloat

    init(color: Color = DesignTokens.rose, radius: CGFloat = 8, y: CGFloat = 4) {
        self.color = color
        self.radius = radius
        self.y = y
    }

    func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(0.3), radius: radius, y: y)
    }
}

extension View {
    /// Apply a semantic elevation shadow to the view.
    /// - Parameter elevation: The elevation level (level0-level4)
    /// - Returns: View with appropriate shadow applied
    func elevation(_ elevation: Elevation) -> some View {
        modifier(ElevationModifier(elevation: elevation))
    }

    /// Apply an accent-colored shadow for FABs, CTAs, and primary actions.
    /// - Parameters:
    ///   - color: The accent color (defaults to rose)
    ///   - radius: Shadow blur radius (defaults to 8)
    ///   - y: Vertical offset (defaults to 4)
    /// - Returns: View with colored shadow applied
    func accentShadow(color: Color = DesignTokens.rose, radius: CGFloat = 8, y: CGFloat = 4) -> some View {
        modifier(AccentShadowModifier(color: color, radius: radius, y: y))
    }

    /// Convenience for card elevation (level2)
    func cardShadow() -> some View {
        elevation(.level2)
    }

    /// Convenience for small item elevation (level1)
    func subtleShadow() -> some View {
        elevation(.level1)
    }

    /// Convenience for toast/tooltip elevation (level3)
    func raisedShadow() -> some View {
        elevation(.level3)
    }
}

// MARK: - Color Extension for Hex

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
