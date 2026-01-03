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
