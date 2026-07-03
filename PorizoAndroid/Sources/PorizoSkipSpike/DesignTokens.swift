//
//  DesignTokens.swift
//  PorizoSkipSpike (Android via Skip Fuse)
//
//  Warm Canvas design system — ported to Android for pixel/behavior parity with iOS.
//  Source of truth: PorizoApp/PorizoApp/DesignTokens.swift + Assets.xcassets/Colors/*.colorset.
//
//  WHY THIS EXISTS (UF1, docs/plans/2026-07-01-001-feat-android-design-replica-fidelity-plan.md):
//  iOS resolves its palette from an asset catalog (Color("Colors/Gold")). Skip's Android runtime
//  does NOT read iOS asset catalogs, so the resolved hex values are ported here as literals.
//  Both light and dark appearances are captured; `light` is the active base until a dark-mode
//  pass wires appearance switching. The prior `PorizoAndroidTheme` values were hand-approximated
//  and hue-wrong (its "gold" was a mustard ~#C79438; the real Warm Canvas accent is coral #E07850).
//

import SwiftUI

// MARK: - Design Tokens (Warm Canvas — resolved from iOS asset catalog)

enum DesignTokens {

    // MARK: Backgrounds
    static let background = Color(hex: "#FBF7F2")        // dark: #1A1614
    static let surface = Color(hex: "#FFFFFF")           // dark: #252220
    static let surfaceMuted = Color(hex: "#F5F0EB")      // dark: #1E1B19
    static let surfaceElevated = Color(hex: "#FFFFFF")   // dark: #2E2A28
    static let inputBackground = Color(hex: "#FFFFFF")   // dark: #2E2A28
    static let cardBackground = surface

    // MARK: Text
    static let textPrimary = Color(hex: "#2C2420")       // dark: #F5F0EB
    static let textSecondary = Color(hex: "#6B6560")     // dark: #9E9890
    static let textTertiary = Color(hex: "#716B65")      // dark: #7A7470
    static let textMuted = Color(hex: "#9E9890")         // dark: #5A5450
    /// On-accent foreground (text/icons rendered over `gold`). iOS uses .white here.
    static let onAccent = Color.white

    // MARK: Accent (Coral)
    static let gold = Color(hex: "#E07850")              // dark: #E88A65
    static let goldGradientEnd = Color(hex: "#E8966E")   // dark: #EC9E7E
    static let goldDark = Color(hex: "#C06030")          // dark: #E07850
    static let goldGlow = gold.opacity(0.25)
    static let goldSoft = gold.opacity(0.2)
    static let focusRing = gold.opacity(0.5)
    static let roseGold = Color(hex: "#D4894A")          // dark: #DCA060
    static let sage = Color(hex: "#7B8F6B")              // dark: #8DA07D
    static let sageBubble = Color(hex: "#E8F0E5")        // dark: #1E2B1A
    static let coralBubble = Color(hex: "#FDE8E0")       // dark: #3A2018

    // MARK: Borders
    static let border = Color(hex: "#E8E2DC")            // dark: #3A3530
    static let borderSubtle = Color(hex: "#E8E2DC")      // dark: #3A3530
    /// Boundary color for interactive controls on Warm Canvas backgrounds.
    /// Equivalent to textTertiary at 75% over the light background, giving ~3.04:1
    /// non-text contrast while staying softer than full textTertiary.
    static let accessibleControlBorder = Color(hex: "#948E88")

    // MARK: Status
    static let success = Color(hex: "#7DD3A6")
    static let successDark = Color(hex: "#059669")       // dark: #10B981
    static let warning = Color(hex: "#FF8400")           // dark: #FF9520
    static let error = Color(hex: "#EF4444")             // dark: #EF5555
    static let statusSuccess = Color(hex: "#4ADE80")
    static let statusSuccessBg = Color(hex: "#E8F5E8")   // dark: #1A2E1A
    static let statusInfo = Color(hex: "#60A5FA")
    static let statusInfoBg = Color(hex: "#E8EFF8")      // dark: #1A2030

    // MARK: Spacing Scale (multiples of 4)
    static let spacing2: CGFloat = 2
    static let spacing4: CGFloat = 4
    static let spacing6: CGFloat = 6
    static let spacing8: CGFloat = 8
    static let spacing12: CGFloat = 12
    static let spacing16: CGFloat = 16
    static let spacing20: CGFloat = 20
    static let spacing24: CGFloat = 24
    static let spacing28: CGFloat = 28
    static let spacing32: CGFloat = 32

    // MARK: Corner Radius
    static let radiusSmall: CGFloat = 4
    static let radiusXSmall: CGFloat = 8
    static let radiusMedium: CGFloat = 12
    static let radiusCTA: CGFloat = 14
    static let radiusLarge: CGFloat = 16
    static let radiusOverlay: CGFloat = 20
    static let radiusChip: CGFloat = 22
    static let radiusPremium: CGFloat = 24
    static let radiusPill: CGFloat = 25
    static let radiusCircle: CGFloat = 999

    // MARK: Typography
    //
    // Font.custom resolves the family name differently per platform:
    //  - iOS: the font's PostScript name ("Fraunces"), registered via UIAppFonts in Info.plist.
    //  - Android (Skip): ctx.resources.getIdentifier(name, "font", pkg) then getFont(fid) — must
    //    match a res/font resource. We point directly at the single static file
    //    res/font/fraunces_regular.ttf (resource id "fraunces_regular"). NOTE: an XML <font-family>
    //    mapping the 4 weight files to one variable .ttf crashes getFont() with
    //    Resources$NotFoundException on API 36, so we resolve one concrete .ttf instead. Weight
    //    variation on Android is deferred (the UF2 open question); regular renders correctly.
    #if SKIP
    private static let displayFontFamily = "fraunces_regular"
    #else
    private static let displayFontFamily = "Fraunces"
    #endif

    /// Fraunces display/title text. `relativeTo` enables Dynamic Type scaling for the custom font.
    static func displayFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(displayFontFamily, size: size, relativeTo: style).weight(weight)
    }

    static func displayFontSemibold(size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        displayFont(size: size, weight: .semibold, relativeTo: style)
    }

    static func titleFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom(displayFontFamily, size: size, relativeTo: style).weight(weight)
    }

    /// Body font — system (SF Pro on iOS, Roboto on Android). Dynamic-Type-relative via `relativeTo`.
    static func bodyFont(size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .system(size: size, weight: weight)
    }

    // MARK: Component Sizes
    static let artworkSize: CGFloat = 56
    static let iconButtonSize: CGFloat = 40
    static let buttonHeightLarge: CGFloat = 54
    static let buttonHeightMedium: CGFloat = 44
    static let tabBarHeight: CGFloat = 83
    static let miniPlayerHeight: CGFloat = 80
    static let headerHeight: CGFloat = 56
}

// MARK: - Elevation / Shadow Tokens
//
// iOS fragments shadows across three systems (.elevation(.level0-4), .cardShadow()/.subtleShadow(),
// .goldGlow()). Per UF1, they are normalized here into one named set rather than porting the
// fragmentation. Warm Canvas uses warm-tinted, low-opacity shadows (shadowColor == textPrimary).

enum Elevation: CaseIterable {
    case level0, level1, level2, level3, level4

    var shadowColor: Color { DesignTokens.textPrimary }

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

extension View {
    /// Apply a semantic elevation shadow.
    func elevation(_ elevation: Elevation) -> some View {
        shadow(color: elevation.shadowColor.opacity(elevation.shadowOpacity),
               radius: elevation.shadowRadius, y: elevation.shadowY)
    }

    /// Card elevation (level2).
    func cardShadow() -> some View { elevation(.level2) }

    /// Small-item elevation (level1).
    func subtleShadow() -> some View { elevation(.level1) }

    /// Coral glow for primary CTAs (subtler on the light theme).
    func goldGlow(radius: CGFloat = 12) -> some View {
        shadow(color: DesignTokens.gold.opacity(0.12), radius: radius, x: 0, y: 4)
    }
}

// MARK: - Bold Chip Style (matches iOS boldChipStyle)

extension View {
    /// Coral-fill-when-selected / surface-fill-when-unselected capsule chip, matching iOS.
    func boldChipStyle(isSelected: Bool = false) -> some View {
        self
            .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
            .foregroundStyle(isSelected ? DesignTokens.onAccent : DesignTokens.textPrimary)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(
                    isSelected ? DesignTokens.gold.opacity(0.4) : DesignTokens.border,
                    lineWidth: 0.5
                )
            )
            .shadow(color: DesignTokens.gold.opacity(isSelected ? 0.08 : 0.04), radius: 5, y: 2)
    }
}

// MARK: - Color Hex Init

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}
