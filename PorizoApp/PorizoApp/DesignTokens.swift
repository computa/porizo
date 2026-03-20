//
//  DesignTokens.swift
//  PorizoApp
//
//  Velvet & Gold design system - luxurious dark theme with warm gold accents.
//  Colors extracted from v1.pen Penpot design file.
//

import SwiftUI

// MARK: - Design Tokens (Velvet & Gold)

struct DesignTokens {
    // MARK: - Background Colors

    /// Deep velvet black - primary background
    static let background = Color(hex: "#0A0A0A")

    /// Card/surface background
    static let surface = Color(hex: "#161616")

    /// Muted surface for banners, separators
    static let surfaceMuted = Color(hex: "#1A1A1A")

    /// Elevated surface
    static let surfaceElevated = Color(hex: "#1E1E1E")

    /// Input field backgrounds
    static let inputBackground = Color(hex: "#2E2E2E")

    // MARK: - Text Colors

    /// Warm white - primary text
    static let textPrimary = Color(hex: "#F5F5F0")

    /// Medium gray - secondary text, labels
    static let textSecondary = Color(hex: "#8A8A8A")

    /// Dark gray - tertiary text, hints, placeholders
    static let textTertiary = Color(hex: "#666666")

    /// Muted text for disabled states
    static let textMuted = Color(hex: "#B3B3B3")

    // MARK: - Accent Colors (Gold)

    /// Primary gold accent - CTAs, highlights
    static let gold = Color(hex: "#D4A574")

    /// Darker gold for gradients, pressed states
    static let goldDark = Color(hex: "#8B7355")

    /// Gold with glow effect (v1.pen --gold-glow: 25% opacity)
    static let goldGlow = Color(hex: "#D4A574").opacity(0.25)

    /// Gold soft for backgrounds (v1.pen --primary-soft: 20% opacity)
    static let goldSoft = Color(hex: "#D4A574").opacity(0.2)

    /// Focus ring color (v1.pen --focus-ring: 50% opacity)
    static let focusRing = Color(hex: "#D4A574").opacity(0.5)

    /// Rose gold - secondary accent
    static let roseGold = Color(hex: "#E8B4B8")

    // MARK: - Border Colors

    /// Primary border color
    static let border = Color(hex: "#2A2A2A")

    /// Subtle border for inputs
    static let borderSubtle = Color(hex: "#333333")

    /// Light border for separators
    static let borderLight = Color(hex: "#E5E5E0")

    // MARK: - Status Colors

    /// Success green (matches v1.pen --success)
    static let success = Color(hex: "#7DD3A6")

    /// Success green darker variant
    static let successDark = Color(hex: "#059669")

    /// Warning orange
    static let warning = Color(hex: "#FF8400")

    /// Error red
    static let error = Color(hex: "#EF4444")

    /// Bright green for status badges (e.g., "Ready", "Complete")
    static let statusSuccess = Color(hex: "#4ADE80")

    /// Dark green background for success badges
    static let statusSuccessBg = Color(hex: "#1A3D1A")

    /// Blue for informational status badges (e.g., "Lyrics Ready")
    static let statusInfo = Color(hex: "#60A5FA")

    /// Dark blue background for info badges
    static let statusInfoBg = Color(hex: "#1E3A5F")

    /// Spotify green (for music connection)
    static let spotifyGreen = Color(hex: "#1DB954")

    // MARK: - Legacy Compatibility (mapped to new system)

    /// Maps to gold for backwards compatibility
    static let rose = gold
    static let roseDark = goldDark
    static let roseLight = roseGold
    static let roseMuted = surfaceMuted

    /// Legacy card colors
    static let cardBackground = surface
    static let cardBorder = border
    static let backgroundSubtle = surfaceMuted

    // MARK: - Spacing Scale (multiples of 4)

    /// 2pt - Text line spacing, tight gaps
    static let spacing2: CGFloat = 2
    /// 4pt - Minimal spacing, icon margins
    static let spacing4: CGFloat = 4
    /// 8pt - Component internal padding (small)
    static let spacing8: CGFloat = 8
    /// 12pt - Component internal padding (medium)
    static let spacing12: CGFloat = 12
    /// 16pt - Item-to-item spacing, standard padding
    static let spacing16: CGFloat = 16
    /// 20pt - Section padding (from v1.pen)
    static let spacing20: CGFloat = 20
    /// 24pt - Large spacing between sections
    static let spacing24: CGFloat = 24
    /// 28pt - Section-to-section spacing
    static let spacing28: CGFloat = 28
    /// 32pt - Premium card internal padding (poem detail, featured)
    static let spacing32: CGFloat = 32

    // MARK: - Corner Radius

    /// 4pt - Small elements, badges, pills
    static let radiusSmall: CGFloat = 4
    /// 12pt - Medium elements, buttons, standard cards
    static let radiusMedium: CGFloat = 12
    /// 14pt - CTA buttons, full-width action buttons
    static let radiusCTA: CGFloat = 14
    /// 16pt - Large cards, containers
    static let radiusLarge: CGFloat = 16
    /// 20pt - Overlay cards, album art, NowPlaying
    static let radiusOverlay: CGFloat = 20
    /// 24pt - Premium cards (poem detail, featured content)
    static let radiusPremium: CGFloat = 24
    /// 25pt - Pill buttons (action bar)
    static let radiusPill: CGFloat = 25
    /// Full circle
    static let radiusCircle: CGFloat = 999

    // MARK: - Typography

    /// Font family name for Playfair variable font
    private static let playfairFamily = "Playfair"

    /// Playfair Display for display/title text (variable font with weight control).
    /// The `relativeTo` parameter enables Dynamic Type scaling for the custom font.
    static func displayFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(playfairFamily, size: size, relativeTo: style).weight(weight)
    }

    /// Playfair Display semibold - convenience for common weight
    static func displayFontSemibold(size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        displayFont(size: size, weight: .semibold, relativeTo: style)
    }

    /// Title font - Playfair Display at specific size.
    /// The `relativeTo` parameter enables Dynamic Type scaling for the custom font.
    static func titleFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(playfairFamily, size: size, relativeTo: style).weight(weight)
    }

    /// Body font - SF Pro Text (system default)
    static func bodyFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }

    /// Inter font for UI text (falls back to system if not available)
    static func interFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }

    // MARK: - Component Sizes

    /// Standard icon button size
    static let iconButtonSize: CGFloat = 40

    /// Large button height
    static let buttonHeightLarge: CGFloat = 54

    /// Medium button height
    static let buttonHeightMedium: CGFloat = 44

    /// Tab bar height
    static let tabBarHeight: CGFloat = 83

    /// Header height
    static let headerHeight: CGFloat = 56
}

// MARK: - Elevation System (Dark Theme Optimized)

/// Semantic elevation levels for consistent shadow depth across the app.
/// For dark themes, we use lighter shadows with lower opacity.
enum Elevation: CaseIterable {
    /// No shadow - flat elements, backgrounds
    case level0

    /// Subtle shadow - small cards, list items
    case level1

    /// Standard shadow - cards, sections
    case level2

    /// Raised shadow - toasts, tooltips
    case level3

    /// Elevated shadow - modals, dialogs
    case level4

    var shadowColor: Color {
        Color.black
    }

    var shadowOpacity: Double {
        switch self {
        case .level0: return 0
        case .level1: return 0.20
        case .level2: return 0.30
        case .level3: return 0.40
        case .level4: return 0.50
        }
    }

    var shadowRadius: CGFloat {
        switch self {
        case .level0: return 0
        case .level1: return 4
        case .level2: return 8
        case .level3: return 12
        case .level4: return 16
        }
    }

    var shadowY: CGFloat {
        switch self {
        case .level0: return 0
        case .level1: return 2
        case .level2: return 4
        case .level3: return 6
        case .level4: return 8
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

    init(color: Color = DesignTokens.gold, radius: CGFloat = 12, y: CGFloat = 4) {
        self.color = color
        self.radius = radius
        self.y = y
    }

    func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(0.4), radius: radius, y: y)
    }
}

extension View {
    /// Apply a semantic elevation shadow to the view.
    func elevation(_ elevation: Elevation) -> some View {
        modifier(ElevationModifier(elevation: elevation))
    }

    /// Apply an accent-colored shadow (gold glow effect).
    func accentShadow(color: Color = DesignTokens.gold, radius: CGFloat = 12, y: CGFloat = 4) -> some View {
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

    /// Gold glow effect for primary CTAs
    func goldGlow(radius: CGFloat = 12) -> some View {
        shadow(color: DesignTokens.gold.opacity(0.4), radius: radius, x: 0, y: 4)
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
    name.replacing("_", with: " ")
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
    case "advice": return "compass.drawing"
    case "bereavement": return "feather.fill"
    case "apology": return "hand.raised.fill"
    case "get_well": return "cross.case.fill"
    default: return "music.note"
    }
}

/// Returns the gradient colors for a given occasion (Velvet & Gold themed)
func occasionGradient(for occasion: String?) -> LinearGradient {
    let colors: [Color]
    switch occasion {
    case "birthday":
        colors = [DesignTokens.gold, DesignTokens.goldDark]
    case "anniversary":
        colors = [DesignTokens.roseGold, Color(hex: "#C49A9A")]
    case "thank_you":
        colors = [Color(hex: "#F5D0A9"), DesignTokens.gold]
    case "i_love_you":
        colors = [DesignTokens.roseGold, Color(hex: "#D48A9A")]
    case "wedding":
        colors = [Color(hex: "#E8D4C8"), Color(hex: "#C9B8A8")]
    case "graduation":
        colors = [Color(hex: "#7B8CDE"), Color(hex: "#5A6BC8")]
    case "friendship":
        colors = [Color(hex: "#7DD3A6"), Color(hex: "#5AB88A")]
    case "encouragement":
        colors = [DesignTokens.gold, Color(hex: "#E8C49A")]
    case "advice":
        colors = [Color(hex: "#7FA8C9"), Color(hex: "#5D7FA8")]
    case "bereavement":
        colors = [Color(hex: "#8C8FA6"), Color(hex: "#6C7088")]
    case "apology":
        colors = [Color(hex: "#B2B2FF"), Color(hex: "#8A8AE8")]
    case "get_well":
        colors = [Color(hex: "#7DD3D3"), Color(hex: "#5ABABA")]
    default:
        colors = [DesignTokens.gold, DesignTokens.goldDark]
    }
    return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// Returns the background gradient colors for full-screen player views (Velvet themed)
func occasionBackgroundGradient(for occasion: String?) -> LinearGradient {
    let baseColors: [Color]
    switch occasion {
    case "birthday":
        baseColors = [Color(hex: "#1A1408"), DesignTokens.background, DesignTokens.background]
    case "anniversary":
        baseColors = [Color(hex: "#1A0F10"), DesignTokens.background, DesignTokens.background]
    case "thank_you":
        baseColors = [Color(hex: "#1A1408"), DesignTokens.background, DesignTokens.background]
    case "i_love_you":
        baseColors = [Color(hex: "#1A0F10"), DesignTokens.background, DesignTokens.background]
    case "wedding":
        baseColors = [Color(hex: "#1A1614"), DesignTokens.background, DesignTokens.background]
    case "graduation":
        baseColors = [Color(hex: "#0F101A"), DesignTokens.background, DesignTokens.background]
    case "friendship":
        baseColors = [Color(hex: "#0F1A14"), DesignTokens.background, DesignTokens.background]
    case "encouragement":
        baseColors = [Color(hex: "#1A1408"), DesignTokens.background, DesignTokens.background]
    case "advice":
        baseColors = [Color(hex: "#10151C"), DesignTokens.background, DesignTokens.background]
    case "bereavement":
        baseColors = [Color(hex: "#0F1118"), DesignTokens.background, DesignTokens.background]
    case "apology":
        baseColors = [Color(hex: "#10101A"), DesignTokens.background, DesignTokens.background]
    case "get_well":
        baseColors = [Color(hex: "#0F1A1A"), DesignTokens.background, DesignTokens.background]
    default:
        baseColors = [Color(hex: "#1A1408"), DesignTokens.background, DesignTokens.background]
    }
    return LinearGradient(colors: baseColors, startPoint: .topLeading, endPoint: .bottomTrailing)
}

// MARK: - Audio URL Helpers

/// Transform audio URLs from backend format to client-accessible URLs.
/// Handles localhost, 127.0.0.1, 0.0.0.0, IPv6 loopback, and relative paths.
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
        "::1",
        "[::1]",
        "[::]"
    ]

    guard let host = storedUrl.host else {
        let path = storedUrl.path
        return path.isEmpty ? urlString : baseURL + path
    }

    if !localHosts.contains(host.lowercased()) {
        return urlString
    }

    let path = storedUrl.path
    if path.isEmpty {
        return urlString
    }

    if let query = storedUrl.query {
        return baseURL + path + "?" + query
    }
    return baseURL + path
}
