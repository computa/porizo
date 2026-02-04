//
//  CompactComponents.swift
//  PorizoApp
//
//  Reusable compact UI components that enforce the v1.1 compaction patterns.
//  These components encode spacing, sizing, and layout conventions so they're
//  enforced by structure rather than convention.
//

import SwiftUI

// MARK: - Compact Spacing Constants

enum CompactSpacing {
    static let cardPadding: CGFloat = 12
    static let listSpacing: CGFloat = 12
    static let sectionSpacing: CGFloat = 16
    static let chipSpacing: CGFloat = 8
    static let inlineSpacing: CGFloat = 6
    static let tightSpacing: CGFloat = 2

    static let artworkSize: CGFloat = 56
    static let artworkCornerRadius: CGFloat = 8
    static let cardCornerRadius: CGFloat = 12
    static let chipCornerRadius: CGFloat = 22
    static let settingsRowHeight: CGFloat = 44
}

// MARK: - Compact Card

/// A compact card component for displaying items like songs or poems.
/// Enforces 56x56 artwork, 12px padding, and 2-line content layout.
struct CompactCard<Artwork: View, Content: View, Accessory: View>: View {
    let artwork: Artwork
    let content: Content
    let accessory: Accessory
    var onTap: (() -> Void)?

    init(
        @ViewBuilder artwork: () -> Artwork,
        @ViewBuilder content: () -> Content,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() },
        onTap: (() -> Void)? = nil
    ) {
        self.artwork = artwork()
        self.content = content()
        self.accessory = accessory()
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: CompactSpacing.listSpacing) {
                artwork
                    .frame(width: CompactSpacing.artworkSize, height: CompactSpacing.artworkSize)
                    .cornerRadius(CompactSpacing.artworkCornerRadius)

                content

                accessory
            }
            .padding(CompactSpacing.cardPadding)
            .background(DesignTokens.surface)
            .cornerRadius(CompactSpacing.cardCornerRadius)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Compact Card Content

/// Standard 2-line content layout for compact cards.
struct CompactCardContent: View {
    let title: String
    let subtitle: String
    var badge: AnyView?
    var trailingText: String?
    var trailingSubtext: String?

    init(
        title: String,
        subtitle: String,
        badge: AnyView? = nil,
        trailingText: String? = nil,
        trailingSubtext: String? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.badge = badge
        self.trailingText = trailingText
        self.trailingSubtext = trailingSubtext
    }

    var body: some View {
        VStack(alignment: .leading, spacing: CompactSpacing.tightSpacing) {
            // Line 1: Title + Badge + Trailing
            HStack(spacing: CompactSpacing.inlineSpacing) {
                Text(title)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)

                if let badge = badge {
                    badge
                }

                Spacer()

                if let trailing = trailingText {
                    Text(trailing)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            // Line 2: Subtitle + Trailing Subtext
            HStack {
                Text(subtitle)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)

                Spacer()

                if let subtext = trailingSubtext {
                    Text(subtext)
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
        }
    }
}

// MARK: - Compact Chip

/// A compact chip for horizontal scroll selection (categories, occasions, etc.)
struct CompactChip: View {
    let label: String
    var emoji: String?
    var icon: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: CompactSpacing.inlineSpacing) {
                if let emoji = emoji {
                    Text(emoji)
                        .font(.system(size: 14))
                }

                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 14))
                }

                Text(label)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            }
            .foregroundColor(isSelected ? .black : DesignTokens.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
            .cornerRadius(CompactSpacing.chipCornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: CompactSpacing.chipCornerRadius)
                    .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Compact Chip Scroll

/// A horizontal scrolling container for chips with proper padding.
struct CompactChipScroll<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CompactSpacing.chipSpacing) {
                content
            }
            .padding(.horizontal, 16)
        }
    }
}

// MARK: - Compact Settings Row

/// A 44px settings row following Apple HIG touch target guidelines.
struct CompactSettingsRow<Accessory: View>: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    let accessory: Accessory
    var onTap: (() -> Void)?

    init(
        icon: String,
        label: String,
        iconColor: Color = DesignTokens.textSecondary,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() },
        onTap: (() -> Void)? = nil
    ) {
        self.icon = icon
        self.label = label
        self.iconColor = iconColor
        self.accessory = accessory()
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(iconColor)
                    .frame(width: 24)

                Text(label)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                accessory
            }
            .frame(height: CompactSpacing.settingsRowHeight)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Compact Settings Row with Chevron

/// A settings row with a trailing chevron for navigation.
struct CompactSettingsNavRow: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    let onTap: () -> Void

    var body: some View {
        CompactSettingsRow(
            icon: icon,
            label: label,
            iconColor: iconColor,
            accessory: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.textTertiary)
            },
            onTap: onTap
        )
    }
}

// MARK: - Compact Settings Row with Toggle

/// A settings row with a toggle switch.
struct CompactSettingsToggleRow: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    @Binding var isOn: Bool

    var body: some View {
        CompactSettingsRow(
            icon: icon,
            label: label,
            iconColor: iconColor,
            accessory: {
                Toggle("", isOn: $isOn)
                    .labelsHidden()
                    .tint(DesignTokens.gold)
            }
        )
    }
}

// MARK: - Compact Section Header

/// A compact section header with consistent styling.
struct CompactSectionHeader: View {
    let title: String
    var action: (() -> Void)?
    var actionLabel: String?

    var body: some View {
        HStack {
            Text(title.uppercased())
                .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                .foregroundColor(DesignTokens.textTertiary)
                .tracking(0.5)

            Spacer()

            if let action = action, let label = actionLabel {
                Button(action: action) {
                    Text(label)
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

// MARK: - Compact Card List

/// A vertically scrolling list of compact cards with proper spacing.
struct CompactCardList<Data: RandomAccessCollection, Content: View>: View where Data.Element: Identifiable {
    let data: Data
    let content: (Data.Element) -> Content

    init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data
        self.content = content
    }

    var body: some View {
        LazyVStack(spacing: CompactSpacing.listSpacing) {
            ForEach(data) { item in
                content(item)
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Preview

#Preview("Compact Chip") {
    VStack(spacing: 20) {
        CompactChipScroll {
            CompactChip(label: "Birthday", emoji: "🎂", isSelected: true) {}
            CompactChip(label: "Anniversary", emoji: "💕", isSelected: false) {}
            CompactChip(label: "Graduation", emoji: "🎓", isSelected: false) {}
            CompactChip(label: "Holiday", emoji: "🎄", isSelected: false) {}
        }
    }
    .background(DesignTokens.background)
}

#Preview("Compact Settings Row") {
    VStack(spacing: 0) {
        CompactSectionHeader(title: "General")
        CompactSettingsNavRow(icon: "person.circle", label: "Profile") {}
        CompactSettingsNavRow(icon: "bell", label: "Notifications") {}
        CompactSettingsToggleRow(icon: "moon", label: "Dark Mode", isOn: .constant(true))
    }
    .background(DesignTokens.background)
}
