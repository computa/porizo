//
//  DesignTokens.swift
//  PorizoApp
//
//  Warm Canvas design system — warm light theme with coral and sage accents.
//  Redesigned April 2026 from Velvet & Gold.
//

import SwiftUI

// MARK: - Design Tokens (Warm Canvas)

struct DesignTokens {
    // MARK: - Background Colors

    /// Warm parchment background — adapts to dark mode
    static let background = Color("Colors/Background")

    /// Card/surface background — adapts to dark mode
    static let surface = Color("Colors/Surface")

    /// Slightly warm muted surface for banners, separators
    static let surfaceMuted = Color("Colors/SurfaceMuted")

    /// Elevated surface — adapts to dark mode
    static let surfaceElevated = Color("Colors/SurfaceElevated")

    /// Input field backgrounds
    static let inputBackground = Color("Colors/InputBackground")

    // MARK: - Text Colors

    /// Primary text — adapts to dark mode
    static let textPrimary = Color("Colors/TextPrimary")

    /// Secondary text, labels — adapts to dark mode
    static let textSecondary = Color("Colors/TextSecondary")

    /// Tertiary text, hints, placeholders — adapts to dark mode
    static let textTertiary = Color("Colors/TextTertiary")

    /// Muted text for disabled states — adapts to dark mode
    static let textMuted = Color("Colors/TextMuted")

    // MARK: - Accent Colors (Coral)

    /// Primary coral accent — CTAs, buttons, fills — adapts to dark mode
    static let gold = Color("Colors/Gold")

    /// Warm salmon gradient end — adapts to dark mode
    static let goldGradientEnd = Color("Colors/GoldGradientEnd")

    /// Contrast-safe coral for small text — adapts to dark mode
    static let goldDark = Color("Colors/GoldDark")

    /// Coral glow effect (25% opacity)
    static let goldGlow = gold.opacity(0.25)

    /// Coral soft for backgrounds (20% opacity)
    static let goldSoft = gold.opacity(0.2)

    /// Focus ring color (50% opacity)
    static let focusRing = gold.opacity(0.5)

    /// Warm amber — secondary accent — adapts to dark mode
    static let roseGold = Color("Colors/RoseGold")

    /// Sage green — AI accent, nature tones — adapts to dark mode
    static let sage = Color("Colors/Sage")

    /// AI chat bubble background — soft sage — adapts to dark mode
    static let sageBubble = Color("Colors/SageBubble")

    /// User chat bubble background — soft coral — adapts to dark mode
    static let coralBubble = Color("Colors/CoralBubble")

    // MARK: - Border Colors

    /// Warm light border — adapts to dark mode
    static let border = Color("Colors/Border")

    /// Subtle border for inputs — adapts to dark mode
    static let borderSubtle = Color("Colors/BorderSubtle")

    // MARK: - Status Colors

    /// Success green — adapts to dark mode
    static let success = Color("Colors/SuccessColor")

    /// Success green darker variant — adapts to dark mode
    static let successDark = Color("Colors/SuccessDark")

    /// Warning orange — adapts to dark mode
    static let warning = Color("Colors/WarningColor")

    /// Error red — adapts to dark mode
    static let error = Color("Colors/ErrorColor")

    /// Bright green for status badges — adapts to dark mode
    static let statusSuccess = Color("Colors/StatusSuccess")

    /// Light green background for success badges — adapts to dark mode
    static let statusSuccessBg = Color("Colors/StatusSuccessBg")

    /// Blue for informational status badges — adapts to dark mode
    static let statusInfo = Color("Colors/StatusInfo")

    /// Light blue background for info badges — adapts to dark mode
    static let statusInfoBg = Color("Colors/StatusInfoBg")

    /// Spotify green (for music connection)
    static let spotifyGreen = Color(hex: "#1DB954")

    // MARK: - Legacy Compatibility

    /// Backward-compat aliases (gold = coral accent)
    static let coral = gold
    static let coralText = goldDark
    static let amber = roseGold
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
    /// 6pt - Inline spacing between label + badge elements
    static let spacing6: CGFloat = 6
    /// 8pt - Component internal padding (small)
    static let spacing8: CGFloat = 8
    /// 12pt - Component internal padding (medium)
    static let spacing12: CGFloat = 12
    /// 16pt - Item-to-item spacing, standard padding
    static let spacing16: CGFloat = 16
    /// 20pt - Section padding 
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
    /// 8pt - Artwork thumbnails, small containers
    static let radiusXSmall: CGFloat = 8
    /// 12pt - Medium elements, buttons, standard cards
    static let radiusMedium: CGFloat = 12
    /// 14pt - CTA buttons, full-width action buttons
    static let radiusCTA: CGFloat = 14
    /// 16pt - Large cards, containers
    static let radiusLarge: CGFloat = 16
    /// 20pt - Overlay cards, album art, NowPlaying
    static let radiusOverlay: CGFloat = 20
    /// 22pt - Chip buttons, occasion tags
    static let radiusChip: CGFloat = 22
    /// 24pt - Premium cards (poem detail, featured content)
    static let radiusPremium: CGFloat = 24
    /// 25pt - Pill buttons (action bar)
    static let radiusPill: CGFloat = 25
    /// Full circle
    static let radiusCircle: CGFloat = 999

    // MARK: - Typography

    /// Font family name for Fraunces variable font
    private static let displayFontFamily = "Fraunces"

    /// Fraunces display/title text (variable font with weight control).
    /// The `relativeTo` parameter enables Dynamic Type scaling for the custom font.
    static func displayFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(displayFontFamily, size: size, relativeTo: style).weight(weight)
    }

    /// Fraunces semibold - convenience for common weight
    static func displayFontSemibold(size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        displayFont(size: size, weight: .semibold, relativeTo: style)
    }

    /// Title font - Fraunces at specific size.
    /// The `relativeTo` parameter enables Dynamic Type scaling for the custom font.
    static func titleFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(displayFontFamily, size: size, relativeTo: style).weight(weight)
    }

    /// Body font - SF Pro Text (system default) with Dynamic Type scaling
    static func bodyFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let uiWeight = weight.uiFontWeight
        let baseFont = UIFont.systemFont(ofSize: size, weight: uiWeight)
        let scaledFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: baseFont)
        return Font(scaledFont)
    }

    /// System font (SF Pro) for UI text with Dynamic Type scaling
    static func systemFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let uiWeight = weight.uiFontWeight
        let baseFont = UIFont.systemFont(ofSize: size, weight: uiWeight)
        let scaledFont = UIFontMetrics(forTextStyle: .body).scaledFont(for: baseFont)
        return Font(scaledFont)
    }

    // MARK: - Component Sizes

    /// Artwork thumbnail size (song cards, list items)
    static let artworkSize: CGFloat = 56

    /// Standard icon button size
    static let iconButtonSize: CGFloat = 40

    /// Large button height
    static let buttonHeightLarge: CGFloat = 54

    /// Medium button height
    static let buttonHeightMedium: CGFloat = 44

    /// Tab bar height
    static let tabBarHeight: CGFloat = 83

    /// MiniPlayer bar height (used for bottom content padding when MiniPlayer is visible)
    static let miniPlayerHeight: CGFloat = 80

    /// Header height
    static let headerHeight: CGFloat = 56
}

// MARK: - Font Weight Conversion

private extension Font.Weight {
    var uiFontWeight: UIFont.Weight {
        switch self {
        case .ultraLight: return .ultraLight
        case .thin: return .thin
        case .light: return .light
        case .regular: return .regular
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
        case .black: return .black
        default: return .regular
        }
    }
}

// MARK: - Chip Style Modifier

/// Bold chip treatment: coral border, subtle shadow, surface background.
/// Apply to any interactive capsule chip for consistent presence.
struct BoldChipModifier: ViewModifier {
    var isSelected: Bool = false

    func body(content: Content) -> some View {
        content
            .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
            .foregroundStyle(isSelected ? .white : DesignTokens.textPrimary)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(
                        isSelected ? DesignTokens.gold.opacity(0.4) : DesignTokens.border,
                        lineWidth: 0.5
                    )
            )
            .shadow(color: DesignTokens.gold.opacity(isSelected ? 0.08 : 0.04), radius: 5, y: 2)
    }
}

// MARK: - Chat Bubble Style Modifiers

/// User chat bubble: soft coral background, dark text, coral-tinted stroke.
struct UserBubbleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(DesignTokens.bodyFont(size: 15))
            .foregroundStyle(DesignTokens.textPrimary)
            .lineSpacing(2)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.coralBubble)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
            )
            .shadow(color: DesignTokens.gold.opacity(0.08), radius: 6, y: 2)
    }
}

/// AI chat bubble: soft sage background, dark text, sage-tinted stroke.
struct AIBubbleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(DesignTokens.bodyFont(size: 15))
            .foregroundStyle(DesignTokens.textPrimary)
            .lineSpacing(3)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.sageBubble)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.sage.opacity(0.15), lineWidth: 0.5)
            )
            .shadow(color: DesignTokens.sage.opacity(0.06), radius: 6, y: 2)
    }
}

/// Gold gradient border overlay for full-screen containers.
struct GoldBorderOverlay: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay(
            RoundedRectangle(cornerRadius: 38, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            DesignTokens.gold.opacity(0.7),
                            DesignTokens.gold.opacity(0.3),
                            DesignTokens.gold.opacity(0.7)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1.5
                )
                .padding(8)
                .ignoresSafeArea()
        )
    }
}

extension View {
    /// Applies the standard bold chip style (coral border + shadow) to a capsule chip.
    func boldChipStyle(isSelected: Bool = false) -> some View {
        modifier(BoldChipModifier(isSelected: isSelected))
    }

    /// Applies user chat bubble styling (soft coral background, dark text).
    func userBubbleStyle() -> some View {
        modifier(UserBubbleModifier())
    }

    /// Applies AI chat bubble styling (sage background, dark text).
    func aiBubbleStyle() -> some View {
        modifier(AIBubbleModifier())
    }

    /// Applies the accent gradient border overlay around the full-screen container.
    func goldBorderOverlay() -> some View {
        modifier(GoldBorderOverlay())
    }
}

// MARK: - Elevation System (Warm Canvas Light Theme)

/// Semantic elevation levels for consistent shadow depth across the app.
/// For light themes, we use warm-tinted shadows with lower opacity.
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
        Color("Colors/TextPrimary")
    }

    var shadowOpacity: Double {
        switch self {
        case .level0: return 0
        case .level1: return 0.06
        case .level2: return 0.10
        case .level3: return 0.15
        case .level4: return 0.20
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
            .shadow(color: color.opacity(0.15), radius: radius, y: y)
    }
}

extension View {
    /// Apply a semantic elevation shadow to the view.
    func elevation(_ elevation: Elevation) -> some View {
        modifier(ElevationModifier(elevation: elevation))
    }

    /// Apply an accent-colored shadow (coral glow effect).
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

    /// Coral glow effect for primary CTAs (subtler on light theme)
    func goldGlow(radius: CGFloat = 12) -> some View {
        shadow(color: DesignTokens.gold.opacity(0.12), radius: radius, x: 0, y: 4)
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

// MARK: - Static Waveform Bars

/// Reusable static waveform visualization used on postcard and share screens.
/// For animated waveforms, see RevealBloomView which manages its own phase state.
struct StaticWaveformBars: View {
    var heights: [CGFloat] = [8, 14, 20, 24, 20, 14, 8]
    var barWidth: CGFloat = 4
    var spacing: CGFloat = 4
    var cornerRadius: CGFloat = 2
    var color: Color = .white

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(Array(heights.enumerated()), id: \.offset) { item in
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(color)
                    .frame(width: barWidth, height: item.element)
            }
        }
        .frame(height: heights.max() ?? 24)
        .accessibilityHidden(true)
    }
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

/// Returns the gradient colors for a given occasion (Warm Canvas themed)
func occasionGradient(for occasion: String?) -> LinearGradient {
    let colors: [Color]
    switch occasion {
    case "birthday":
        colors = [DesignTokens.gold, DesignTokens.roseGold]
    case "anniversary":
        colors = [Color(hex: "#E8A0A8"), Color(hex: "#D4786A")]
    case "thank_you":
        colors = [DesignTokens.roseGold, DesignTokens.gold]
    case "i_love_you":
        colors = [Color(hex: "#E8A0A8"), Color(hex: "#C4707A")]
    case "wedding":
        colors = [Color(hex: "#E8D4C8"), Color(hex: "#D4B8A8")]
    case "graduation":
        colors = [Color(hex: "#7B8CDE"), Color(hex: "#5A6BC8")]
    case "friendship":
        colors = [DesignTokens.sage, Color(hex: "#5AB88A")]
    case "encouragement":
        colors = [DesignTokens.gold, DesignTokens.roseGold]
    case "advice":
        colors = [Color(hex: "#7FA8C9"), Color(hex: "#5D7FA8")]
    case "bereavement":
        colors = [Color(hex: "#8C8FA6"), Color(hex: "#6C7088")]
    case "apology":
        colors = [Color(hex: "#B2B2FF"), Color(hex: "#8A8AE8")]
    case "get_well":
        colors = [Color(hex: "#7DD3D3"), Color(hex: "#5ABABA")]
    default:
        colors = [DesignTokens.gold, DesignTokens.roseGold]
    }
    return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// Returns the background gradient colors for full-screen player views (Warm Canvas themed)
func occasionBackgroundGradient(for occasion: String?) -> LinearGradient {
    let baseColors: [Color]
    switch occasion {
    case "birthday":
        baseColors = [Color(hex: "#FFF5E8"), DesignTokens.background, DesignTokens.background]
    case "anniversary":
        baseColors = [Color(hex: "#FFF0F0"), DesignTokens.background, DesignTokens.background]
    case "thank_you":
        baseColors = [Color(hex: "#FFF5E8"), DesignTokens.background, DesignTokens.background]
    case "i_love_you":
        baseColors = [Color(hex: "#FFF0F0"), DesignTokens.background, DesignTokens.background]
    case "wedding":
        baseColors = [Color(hex: "#FFF8F4"), DesignTokens.background, DesignTokens.background]
    case "graduation":
        baseColors = [Color(hex: "#F0F0FF"), DesignTokens.background, DesignTokens.background]
    case "friendship":
        baseColors = [Color(hex: "#F0F8F0"), DesignTokens.background, DesignTokens.background]
    case "encouragement":
        baseColors = [Color(hex: "#FFF5E8"), DesignTokens.background, DesignTokens.background]
    case "advice":
        baseColors = [Color(hex: "#F0F5FC"), DesignTokens.background, DesignTokens.background]
    case "bereavement":
        baseColors = [Color(hex: "#F0F0F8"), DesignTokens.background, DesignTokens.background]
    case "apology":
        baseColors = [Color(hex: "#F0F0FA"), DesignTokens.background, DesignTokens.background]
    case "get_well":
        baseColors = [Color(hex: "#F0F8F8"), DesignTokens.background, DesignTokens.background]
    default:
        baseColors = [Color(hex: "#FFF5E8"), DesignTokens.background, DesignTokens.background]
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
