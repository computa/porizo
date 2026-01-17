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

// MARK: - Shared Formatting Helpers

/// Format a time interval as "M:SS" (e.g., "1:23")
func formatTime(_ time: TimeInterval) -> String {
    guard time.isFinite && !time.isNaN else { return "0:00" }
    let minutes = Int(time) / 60
    let seconds = Int(time) % 60
    return String(format: "%d:%02d", minutes, seconds)
}

/// Format a lyrics section name from snake_case to Title Case
func formatSectionName(_ name: String) -> String {
    name.replacingOccurrences(of: "_", with: " ")
        .split(separator: " ")
        .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
        .joined(separator: " ")
}

// MARK: - Occasion Visual Helpers

/// Returns the SF Symbol icon name for a given occasion
func occasionIcon(for occasion: String?) -> String {
    switch occasion {
    case "birthday": return "birthday.cake.fill"
    case "anniversary": return "heart.circle.fill"
    case "thank_you": return "hands.clap.fill"
    case "i_love_you": return "heart.fill"
    case "wedding": return "bell.fill"
    case "graduation": return "graduationcap.fill"
    case "friendship": return "person.2.fill"
    case "encouragement": return "star.fill"
    case "apology": return "hand.raised.fill"
    case "get_well": return "cross.case.fill"
    default: return "music.note"
    }
}

/// Returns the gradient colors for a given occasion
func occasionGradient(for occasion: String?) -> LinearGradient {
    let colors: [Color]
    switch occasion {
    case "birthday":
        colors = [Color(hex: "#ec4899"), Color(hex: "#f472b6")]
    case "anniversary":
        colors = [Color(hex: "#f43f5e"), Color(hex: "#fb7185")]
    case "thank_you":
        colors = [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
    case "i_love_you":
        colors = [Color(hex: "#ef4444"), Color(hex: "#f87171")]
    case "wedding":
        colors = [Color(hex: "#a855f7"), Color(hex: "#c084fc")]
    case "graduation":
        colors = [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
    case "friendship":
        colors = [Color(hex: "#06b6d4"), Color(hex: "#22d3ee")]
    case "encouragement":
        colors = [Color(hex: "#10b981"), Color(hex: "#34d399")]
    default:
        colors = [DesignTokens.rose, DesignTokens.roseLight]
    }
    return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// Returns the background gradient colors for full-screen player views
func occasionBackgroundGradient(for occasion: String?) -> LinearGradient {
    let baseColors: [Color]
    switch occasion {
    case "birthday":
        baseColors = [Color(hex: "#831843"), Color(hex: "#be185d"), Color(hex: "#ec4899")]
    case "anniversary":
        baseColors = [Color(hex: "#881337"), Color(hex: "#be123c"), Color(hex: "#f43f5e")]
    case "thank_you":
        baseColors = [Color(hex: "#78350f"), Color(hex: "#b45309"), Color(hex: "#f59e0b")]
    case "i_love_you":
        baseColors = [Color(hex: "#7f1d1d"), Color(hex: "#b91c1c"), Color(hex: "#ef4444")]
    default:
        baseColors = [Color(hex: "#881337"), Color(hex: "#be123c"), Color(hex: "#f43f5e")]
    }
    return LinearGradient(colors: baseColors, startPoint: .topLeading, endPoint: .bottomTrailing)
}

// MARK: - Audio URL Helpers

/// Transform audio URLs from backend format to client-accessible URLs.
/// Handles localhost, 127.0.0.1, 0.0.0.0, IPv6 loopback, and relative paths.
/// - Parameters:
///   - urlString: The URL string from the backend
///   - baseURL: The API base URL to use for transformations
/// - Returns: The transformed URL string
func transformAudioUrl(_ urlString: String, baseURL: String) -> String {
    // Handle relative paths (just /preview/...)
    if urlString.hasPrefix("/") {
        return baseURL + urlString
    }

    guard let storedUrl = URL(string: urlString) else { return urlString }

    // List of hosts that should be rewritten to baseURL
    let localHosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",           // IPv6 loopback
        "[::1]",         // IPv6 loopback in bracket notation
        "[::]"           // IPv6 any address
    ]

    guard let host = storedUrl.host else {
        // No host - might be a relative URL
        let path = storedUrl.path
        return path.isEmpty ? urlString : baseURL + path
    }

    // If host is NOT a local address, return unchanged
    if !localHosts.contains(host.lowercased()) {
        return urlString
    }

    // Rewrite local URLs to use baseURL
    let path = storedUrl.path
    if path.isEmpty {
        return urlString
    }

    // Include query string if present
    if let query = storedUrl.query {
        return baseURL + path + "?" + query
    }
    return baseURL + path
}
