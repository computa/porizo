import SwiftUI

struct AccountProfileHeader: View {
    let user: AuthUser?
    let emailContact: ContactInfo?
    let onEditName: (AuthUser) -> Void

    private var displayName: String {
        user?.trimmedDisplayName ?? "User"
    }

    private var initials: String {
        displayName.split(separator: " ")
            .prefix(2)
            .compactMap { $0.first }
            .map(String.init)
            .joined()
    }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 64, height: 64)
                Text(initials.isEmpty ? "?" : initials)
                    .font(DesignTokens.bodyFont(size: 22, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(spacing: 4) {
                Text(displayName)
                    .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                if let user {
                    Button(
                        user.isDisplayNameMissing ? "Add name" : "Edit name",
                        action: { onEditName(user) }
                    )
                    .font(.callout)
                    .foregroundStyle(DesignTokens.goldDark)
                    .accessibilityIdentifier("account.editNameButton")
                }

                contactDetails
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
    }

    @ViewBuilder
    private var contactDetails: some View {
        if let emailContact {
            HStack(spacing: 4) {
                Text(emailContact.valueDisplay ?? "No email")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)

                if emailContact.isRelay {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.warning)
                        .accessibilityLabel("Relay address")
                } else if emailContact.verified {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.success)
                        .accessibilityLabel("Verified")
                } else {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.warning)
                        .accessibilityLabel("Unverified")
                }
            }
        } else if let email = user?.primaryEmail ?? user?.email {
            Text(email)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }
}
