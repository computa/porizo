import SwiftUI

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
            HStack(spacing: CompactSpacing.inlineSpacing) {
                Text(title)
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(1)

                if let badge = badge {
                    badge
                }

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
