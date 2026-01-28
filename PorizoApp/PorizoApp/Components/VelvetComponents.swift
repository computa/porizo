//
//  VelvetComponents.swift
//  PorizoApp
//
//  Shared UI components matching v1.pen Velvet & Gold design system.
//  These components implement the luxurious dark theme with warm gold accents.
//

import SwiftUI

// MARK: - VelvetButton

/// Primary gold CTA button with pill shape.
/// Used for main actions like "Begin Creating", "Use my phone number", etc.
struct VelvetButton: View {
    let title: String
    let icon: String?
    let action: () -> Void
    let style: VelvetButtonStyle
    var isLoading: Bool = false
    var isDisabled: Bool = false

    enum VelvetButtonStyle {
        case primary    // Gold background, dark text
        case secondary  // Dark background, light text, border
        case ghost      // Transparent, gold text
    }

    init(
        _ title: String,
        icon: String? = nil,
        style: VelvetButtonStyle = .primary,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.style = style
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.spacing12) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: textColor))
                        .scaleEffect(0.9)
                } else {
                    if let icon = icon {
                        Image(systemName: icon)
                            .font(.system(size: 20, weight: .medium))
                    }
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                }
            }
            .foregroundColor(textColor)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(backgroundColor)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(borderColor, lineWidth: style == .secondary ? 1 : 0)
            )
        }
        .disabled(isDisabled || isLoading)
        .opacity(isDisabled ? 0.5 : 1.0)
    }

    private var backgroundColor: Color {
        switch style {
        case .primary: return DesignTokens.gold
        case .secondary: return DesignTokens.surface
        case .ghost: return .clear
        }
    }

    private var textColor: Color {
        switch style {
        case .primary: return DesignTokens.background
        case .secondary: return DesignTokens.textPrimary
        case .ghost: return DesignTokens.gold
        }
    }

    private var borderColor: Color {
        switch style {
        case .secondary: return DesignTokens.borderSubtle
        default: return .clear
        }
    }
}

// MARK: - VelvetIconButton

/// Circular icon button used for back navigation, close, etc.
struct VelvetIconButton: View {
    let icon: String
    let action: () -> Void
    var size: CGFloat = 44
    var style: VelvetIconButtonStyle = .filled

    enum VelvetIconButtonStyle {
        case filled     // Dark background
        case ghost      // Transparent
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: size, height: size)
                .background(style == .filled ? DesignTokens.surface : .clear)
                .clipShape(Circle())
        }
    }
}

// MARK: - VelvetHeader

/// Navigation header with optional back button and title.
struct VelvetHeader: View {
    let title: String?
    let showBackButton: Bool
    let onBack: (() -> Void)?
    let trailingContent: AnyView?

    init(
        title: String? = nil,
        showBackButton: Bool = true,
        onBack: (() -> Void)? = nil,
        @ViewBuilder trailing: () -> some View = { EmptyView() }
    ) {
        self.title = title
        self.showBackButton = showBackButton
        self.onBack = onBack
        self.trailingContent = AnyView(trailing())
    }

    var body: some View {
        HStack {
            if showBackButton {
                VelvetIconButton(icon: "arrow.left") {
                    onBack?()
                }
            }

            if let title = title {
                Spacer()
                Text(title)
                    .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                Spacer()
            } else {
                Spacer()
            }

            if let trailing = trailingContent {
                trailing
            } else if showBackButton {
                // Invisible spacer to balance the back button
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing8)
    }
}

// MARK: - DividerWithText

/// Horizontal divider with centered text (e.g., "or").
struct DividerWithText: View {
    let text: String

    init(_ text: String = "or") {
        self.text = text
    }

    var body: some View {
        HStack(spacing: DesignTokens.spacing16) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)

            Text(text)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textTertiary)

            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }
}

// MARK: - WaveformVisualizer

/// Animated gold waveform bars for audio visualization.
struct WaveformVisualizer: View {
    @State private var animating = false
    let barCount: Int
    let maxHeight: CGFloat
    let animated: Bool

    init(barCount: Int = 9, maxHeight: CGFloat = 110, animated: Bool = true) {
        self.barCount = barCount
        self.maxHeight = maxHeight
        self.animated = animated
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<barCount, id: \.self) { index in
                WaveformBar(
                    index: index,
                    totalBars: barCount,
                    maxHeight: maxHeight,
                    isAnimating: animating && animated
                )
            }
        }
        .frame(height: maxHeight)
        .onAppear {
            if animated {
                animating = true
            }
        }
    }
}

private struct WaveformBar: View {
    let index: Int
    let totalBars: Int
    let maxHeight: CGFloat
    let isAnimating: Bool

    @State private var height: CGFloat = 0

    // Heights from v1.pen design (symmetric pattern)
    private var baseHeight: CGFloat {
        let center = (totalBars - 1) / 2
        let distance = abs(index - center)
        let heights: [CGFloat] = [1.0, 0.82, 0.59, 0.36, 0.18] // normalized
        let normalizedHeight = distance < heights.count ? heights[distance] : 0.18
        return maxHeight * normalizedHeight
    }

    // Opacity from v1.pen (decreases towards edges)
    private var barOpacity: Double {
        let center = (totalBars - 1) / 2
        let distance = abs(index - center)
        let opacities: [Double] = [1.0, 1.0, 0.56, 0.44, 0.31]
        return distance < opacities.count ? opacities[distance] : 0.31
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold.opacity(barOpacity))
            .frame(width: 4, height: isAnimating ? height : baseHeight)
            .onAppear {
                height = baseHeight
                if isAnimating {
                    startAnimation()
                }
            }
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startAnimation()
                }
            }
    }

    private func startAnimation() {
        // Staggered animation based on position
        let delay = Double(index) * 0.1
        withAnimation(
            .easeInOut(duration: 0.6)
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            height = baseHeight * (0.3 + Double.random(in: 0...0.7))
        }
    }
}

// MARK: - VelvetTextField

/// Dark-themed text field with label.
struct VelvetTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var isSecure: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            if !label.isEmpty {
                Text(label)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
            }

            Group {
                if isSecure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                }
            }
            .font(DesignTokens.bodyFont(size: 16))
            .foregroundColor(DesignTokens.textPrimary)
            .padding(.horizontal, DesignTokens.spacing16)
            .padding(.vertical, DesignTokens.spacing12)
            .background(DesignTokens.inputBackground)
            .cornerRadius(DesignTokens.radiusMedium)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
    }
}

// MARK: - VelvetCard

/// Card component with proper elevation and styling.
struct VelvetCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.radiusMedium)
            .elevation(.level2)
    }
}

// MARK: - SocialAuthButton

/// Social authentication button (Apple, Google, etc.).
struct SocialAuthButton: View {
    let provider: SocialProvider
    let action: () -> Void

    enum SocialProvider {
        case apple
        case google
        case twitter
        case facebook

        var icon: String {
            switch self {
            case .apple: return "apple.logo"
            case .google: return "g.circle.fill"
            case .twitter: return "at"
            case .facebook: return "f.circle.fill"
            }
        }

        var label: String {
            switch self {
            case .apple: return "Apple"
            case .google: return "Google"
            case .twitter: return "X"
            case .facebook: return "Facebook"
            }
        }
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: provider.icon)
                .font(.system(size: 24))
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: 56, height: 56)
                .background(DesignTokens.surface)
                .cornerRadius(DesignTokens.radiusMedium)
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
    }
}

// MARK: - GoldLinkButton

/// Text button with gold color, typically used for "Sign in" links.
struct GoldLinkButton: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundColor(DesignTokens.gold)
        }
    }
}

// MARK: - Previews

#Preview("VelvetButton") {
    VStack(spacing: 16) {
        VelvetButton("Begin Creating", icon: nil, style: .primary) {}
        VelvetButton("Use my phone number", icon: "phone.fill", style: .primary) {}
        VelvetButton("Sign in with Google", icon: "g.circle.fill", style: .secondary) {}
        VelvetButton("Skip", style: .ghost) {}
        VelvetButton("Loading...", isLoading: true) {}
    }
    .padding()
    .background(DesignTokens.background)
}

#Preview("WaveformVisualizer") {
    WaveformVisualizer()
        .padding()
        .background(DesignTokens.background)
}

#Preview("VelvetTextField") {
    VStack(spacing: 16) {
        VelvetTextField(label: "Phone Number", placeholder: "+1 (555) 000-0000", text: .constant(""))
        VelvetTextField(label: "Email", placeholder: "you@example.com", text: .constant(""), keyboardType: .emailAddress)
    }
    .padding()
    .background(DesignTokens.background)
}

#Preview("DividerWithText") {
    DividerWithText("or")
        .padding()
        .background(DesignTokens.background)
}

#Preview("SocialAuthButtons") {
    HStack(spacing: 12) {
        SocialAuthButton(provider: .apple) {}
        SocialAuthButton(provider: .google) {}
        SocialAuthButton(provider: .twitter) {}
        SocialAuthButton(provider: .facebook) {}
    }
    .padding()
    .background(DesignTokens.background)
}
