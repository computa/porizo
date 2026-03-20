import SwiftUI

struct AppVersionFooter: View {
    var body: some View {
        VStack(spacing: DesignTokens.spacing4) {
            Text("Version \(appVersion)")
                .font(.caption)
                .foregroundStyle(DesignTokens.textTertiary)

            HStack(spacing: DesignTokens.spacing4) {
                Text("Made with")
                Image(systemName: "heart.fill")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.gold)
                Text("in Perth")
            }
            .font(.caption)
            .foregroundStyle(DesignTokens.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DesignTokens.spacing16)
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}
