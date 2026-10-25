import SwiftUI

struct SettingsAccountSection: View {
    let user: AuthUser?
    let onAccount: () -> Void
    let onSignIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ACCOUNT")
                .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                .foregroundStyle(DesignTokens.textTertiary)
                .tracking(1.5)

            if let user {
                let name = user.trimmedDisplayName ?? "User"
                accountRow(
                    title: name,
                    subtitle: user.email ?? "",
                    initials: initials(for: name),
                    action: onAccount
                )
            } else {
                accountRow(
                    title: "Sign In",
                    subtitle: "Sync your songs across devices",
                    initials: nil,
                    action: onSignIn
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    private func initials(for name: String) -> String? {
        let value = name.split(separator: " ")
            .prefix(2)
            .compactMap { $0.first }
            .map(String.init)
            .joined()
        return value.isEmpty ? nil : value
    }

    private func accountRow(
        title: String,
        subtitle: String,
        initials: String?,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                avatar(initials: initials)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func avatar(initials: String?) -> some View {
        if let initials {
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 40, height: 40)
                Text(initials)
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }
        } else {
            ZStack {
                Circle()
                    .fill(DesignTokens.borderSubtle)
                    .frame(width: 40, height: 40)
                Image(systemName: "person.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }
}
