import SwiftUI

struct CompactCardContent<Badge: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let badge: Badge
    var trailingText: String?
    var trailingSubtext: String?

    init(
        title: String,
        subtitle: String,
        trailingText: String? = nil,
        trailingSubtext: String? = nil,
        @ViewBuilder badge: () -> Badge
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailingText = trailingText
        self.trailingSubtext = trailingSubtext
        self.badge = badge()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
            HStack(spacing: DesignTokens.spacing6) {
                Text(title)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(1)

                badge

                Spacer()

                if let trailing = trailingText {
                    Text(trailing)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            HStack {
                Text(subtitle)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(1)

                Spacer()

                if let subtext = trailingSubtext {
                    Text(subtext)
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
            }
        }
    }
}

extension CompactCardContent where Badge == EmptyView {
    init(
        title: String,
        subtitle: String,
        trailingText: String? = nil,
        trailingSubtext: String? = nil
    ) {
        self.init(
            title: title,
            subtitle: subtitle,
            trailingText: trailingText,
            trailingSubtext: trailingSubtext
        ) {
            EmptyView()
        }
    }
}
