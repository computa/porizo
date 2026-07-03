//
//  FrauncesTitle.swift
//  PorizoSkipSpike (Android via Skip Fuse)
//
//  KTD-F5 native escape hatch for the Fraunces display font.
//
//  WHY: SkipUI's `Font.custom("fraunces_regular")` resolves the res/font resource (no warning)
//  but Compose still renders the system font — a Skip 1.9.4 limitation where FontFamily(Typeface)
//  from Resources.getFont() is not honored by the text renderer. Verified across variable-file,
//  font-family-XML (crashes getFont), and static-file approaches: all load, none render serif.
//
//  This view drops to raw Jetpack Compose (via ComposeView) and builds the FontFamily directly
//  from R.font.fraunces_regular, which Compose DOES honor. On non-SKIP (iOS) it falls back to the
//  normal SwiftUI Font.custom path, which already works there.
//

import SwiftUI
#if SKIP
import SkipUI
#endif

/// Which display color a Fraunces title uses. Kept as an enum so the SKIP branch can map to a
/// literal ARGB long without comparing SwiftUI Color values (which don't bridge cleanly).
enum FrauncesTitleColor {
    case primary       // DesignTokens.textPrimary  #2C2420
    case onAccent      // white, for titles over the coral hero
}

/// Renders display/title text in Fraunces serif. Use in place of `Text(...).font(displayFont)`
/// for headline text that must match the iOS Fraunces treatment.
struct FrauncesTitle: View {
    let text: String
    var size: CGFloat = 34
    var weight: Font.Weight = .bold
    var color: FrauncesTitleColor = .primary
    var isHeading = false

    var body: some View {
        #if SKIP
        ComposeView { FrauncesTextComposer(
            text: text,
            fontSizeSp: Double(size),
            weightValue: weightValue,
            colorArgb: colorArgb,
            isHeading: isHeading
        ) }
        #else
        Text(text)
            .font(.custom("Fraunces", size: size).weight(weight))
            .foregroundStyle(color == .onAccent ? DesignTokens.onAccent : DesignTokens.textPrimary)
            .accessibilityAddTraits(isHeading ? .isHeader : [])
        #endif
    }

    private var weightValue: Int {
        switch weight {
        case .thin: return 100
        case .ultraLight: return 200
        case .light: return 300
        case .regular: return 400
        case .medium: return 500
        case .semibold: return 600
        case .bold: return 700
        case .heavy: return 800
        case .black: return 900
        default: return 400
        }
    }

    // ARGB as a signed 64-bit value Kotlin can accept directly (no bitPattern initializer needed).
    private var colorArgb: Int64 {
        switch color {
        case .onAccent: return 0xFFFFFFFF   // white
        case .primary: return 0xFF2C2420    // textPrimary
        }
    }
}
