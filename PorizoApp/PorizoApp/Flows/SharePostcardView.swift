//
//  SharePostcardView.swift
//  PorizoApp
//
//  Share screen with the per-song artwork as the hero and a 6-tile grid
//  of platform targets. The share URL + PIN are the hard contract for every
//  target; artwork is secondary and only travels on paths that cannot silently
//  drop that text payload.
//

import SwiftUI
import UIKit
import Photos

struct SharePostcardView: View {
    let recipientName: String
    let occasion: String?
    var shareURL: String? = nil
    var claimPIN: String? = nil
    var artworkURL: String? = nil
    let onSend: () -> Void
    let onSaveToPhotos: () -> Void
    let onCopyLink: () -> Void
    let onSkip: () -> Void

    @State private var artworkImage: UIImage? = nil
    @State private var showHowItWorks = false
    @State private var saveToPhotosStatus: SaveStatus = .idle

    private enum SaveStatus: Equatable {
        case idle, saving, saved, failed(String)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                navigationBar

                ScrollView {
                    VStack(spacing: DesignTokens.spacing20) {
                        heroArtwork
                        metaCaption
                        howItWorksSection
                        sectionLabel("SHARE TO")
                        targetsGrid
                        primaryCTA
                        skipLink
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
            }
        }
        .task(id: artworkURL) { await loadArtworkImage() }
    }

    // MARK: - Navigation Bar

    private var navigationBar: some View {
        HStack {
            Button(action: onSkip) {
                ZStack {
                    Circle()
                        .fill(Color.black.opacity(0.05))
                        .frame(width: 44, height: 44)
                    Image(systemName: "arrow.left")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
            }
            .accessibilityLabel("Go back")

            Spacer()

            Text("Your Song")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing12)
    }

    // MARK: - Hero Artwork

    /// Real per-song artwork from the API. Falls back to a coral gradient
    /// placeholder when the URL is missing (legacy tracks) or while loading.
    private var heroArtwork: some View {
        ZStack {
            if let image = artworkImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .transition(.opacity.animation(.easeOut(duration: 0.2)))
            } else if let urlString = artworkURL, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        artworkPlaceholder
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .failure:
                        artworkPlaceholder
                    @unknown default:
                        artworkPlaceholder
                    }
                }
            } else {
                artworkPlaceholder
            }
        }
        .aspectRatio(2.0 / 3.0, contentMode: .fit)
        .frame(maxHeight: 380)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: DesignTokens.gold.opacity(0.20), radius: 32, y: 8)
        .shadow(color: Color.black.opacity(0.06), radius: 8, y: 2)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var artworkPlaceholder: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.roseGold],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                Text(occasion.flatMap { Occasion(rawValue: $0)?.emoji } ?? "🎵")
                    .font(.system(size: 48))
            )
    }

    // MARK: - Meta Caption

    /// Quiet attribution line under the artwork. The image itself carries
    /// "For {Name} / A {Occasion} Song / by {Sender}" so we don't repeat it
    /// with the same visual weight.
    private var metaCaption: some View {
        VStack(spacing: 4) {
            Text("For \(recipientName)")
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)
            if let phrase = occasionDisplay {
                Text(phrase)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .italic()
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var occasionDisplay: String? {
        guard let raw = occasion,
              let occ = Occasion(rawValue: raw) else { return nil }
        return "\(occ.displayName) Song"
    }

    // MARK: - Privacy Chip (kept from original, collapsed by default)

    private var howItWorksSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) { showHowItWorks.toggle() }
            } label: {
                HStack(spacing: DesignTokens.spacing8) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 13))
                        .foregroundStyle(DesignTokens.gold)
                    Text("Shared via private link & PIN")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                    Spacer()
                    Image(systemName: showHowItWorks ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
                .padding(.vertical, DesignTokens.spacing12)
                .padding(.horizontal, DesignTokens.spacing16)
            }
            .buttonStyle(.plain)

            if showHowItWorks {
                VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                    if let pin = claimPIN {
                        HStack(spacing: DesignTokens.spacing8) {
                            Text("Your PIN:")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textTertiary)
                            Text(pin)
                                .font(.system(size: 20, weight: .bold, design: .monospaced))
                                .foregroundStyle(DesignTokens.gold)
                                .accessibilityLabel("PIN: \(pin)")
                        }
                        Text("Share this PIN separately with your recipient for security.")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    } else {
                        Text("They\u{2019}ll get a link to listen and a PIN for security. Works on any device for 30 days.")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(.horizontal, DesignTokens.spacing16)
                .padding(.bottom, DesignTokens.spacing12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium, style: .continuous)
                .stroke(DesignTokens.border, lineWidth: 1)
        )
    }

    // MARK: - Section Label

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(DesignTokens.bodyFont(size: 11, weight: .medium))
            .foregroundStyle(DesignTokens.textTertiary)
            .tracking(1.5)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Targets Grid (3×2)

    private var targetsGrid: some View {
        let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
        return LazyVGrid(columns: cols, spacing: 10) {
            targetTile(.messages)
            targetTile(.whatsapp)
            targetTile(.instagram)
            targetTile(.tiktok)
            targetTile(.twitter)
            targetTile(.copyLink)
        }
    }

    private func targetTile(_ target: ShareTarget) -> some View {
        Button {
            handleTargetTap(target)
        } label: {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(target.iconBackground)
                        .frame(width: 40, height: 40)
                    Image(systemName: target.symbol)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(target.iconForeground)
                }
                Text(target.label)
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Share to \(target.label)")
    }

    // MARK: - Primary CTA + Skip

    private var primaryCTA: some View {
        Button {
            // Self-contained — opens the universal sheet with image + text + URL.
            // We do NOT call onSend() here; that callback fires the parent's
            // legacy presentation path which would race this sheet.
            presentActivitySheet()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 16, weight: .semibold))
                Text("Share via…")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            .shadow(color: DesignTokens.gold.opacity(0.30), radius: 12, y: 6)
        }
        .accessibilityLabel("Share via system share sheet")
    }

    private var skipLink: some View {
        Button(action: onSkip) {
            Text("Skip sharing")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .accessibilityLabel("Skip sharing and go home")
    }

    // MARK: - Artwork download

    private func loadArtworkImage() async {
        guard artworkImage == nil,
              let urlString = artworkURL,
              let url = URL(string: urlString) else { return }
        do {
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = 10
            let (data, _) = try await URLSession.shared.data(for: request)
            if let image = UIImage(data: data) {
                await MainActor.run { self.artworkImage = image }
            }
        } catch {
            #if DEBUG
            print("[SharePostcardView] artwork download failed: \(error.localizedDescription)")
            #endif
        }
    }

    // MARK: - Target Routing

    private func handleTargetTap(_ target: ShareTarget) {
        guard let (url, pin) = resolvedAccessPayload() else {
            onSend()
            return
        }
        // Each tile is self-contained. We deliberately do NOT call onSend() —
        // that callback fires the parent (MySongsView / TrackPlayerFullView)
        // to pop another UIActivityViewController, which races the deep-link
        // / sheet here and causes both to silently fail.

        switch target {
        case .messages:
            let body = shareBodyText(url: url, claimPIN: pin, useFreshSocialPreview: true)
            openOrFallback(
                SongSharePayloadBuilder.nativeURL(for: .messages, body: body),
                textFallback: body
            )
        case .whatsapp:
            let body = shareBodyText(url: url, claimPIN: pin, useFreshSocialPreview: true)
            openOrFallback(
                SongSharePayloadBuilder.nativeURL(for: .whatsapp, body: body),
                textFallback: body
            )
        case .instagram:
            let body = shareBodyText(url: url, claimPIN: pin)
            shareToInstagram(body: body)
        case .tiktok:
            let body = shareBodyText(url: url, claimPIN: pin)
            shareToTikTok(url: url, body: body)
        case .twitter:
            let body = shareBodyText(url: url, claimPIN: pin)
            openOrFallback(
                SongSharePayloadBuilder.nativeURL(for: .x, body: body),
                textFallback: body,
                webFallback: SongSharePayloadBuilder.webURL(for: .x, body: body)
            )
        case .copyLink:
            let body = shareBodyText(url: url, claimPIN: pin)
            UIPasteboard.general.string = body
            let toast = "Share message copied · PIN \(pin)"
            ToastService.shared.success(toast)
        }
    }

    /// Try the native app URL scheme; if the user doesn't have the app
    /// installed (or iOS reports `success=false` from the async open),
    /// fall back to a text-only share sheet so URL + PIN still travel together.
    private func openOrFallback(_ url: URL?, textFallback body: String, webFallback: URL? = nil) {
        guard let url else {
            presentTextActivitySheet(body)
            return
        }
        UIApplication.shared.open(url, options: [:]) { success in
            guard !success else { return }
            Task { @MainActor in
                if let web = webFallback,
                   UIApplication.shared.canOpenURL(web) {
                    UIApplication.shared.open(web)
                } else {
                    self.presentTextActivitySheet(body)
                }
            }
        }
    }

    /// Universal "Share via…" path. Keep this as a single text item so iOS
    /// share extensions and contact suggestions cannot pick the image and drop
    /// the URL/PIN. The URL inside the text still renders as a rich preview in
    /// apps that support it.
    private func presentActivitySheet() {
        guard let (url, pin) = resolvedAccessPayload() else {
            onSend()
            return
        }
        presentTextActivitySheet(shareBodyText(url: url, claimPIN: pin))
    }

    private func presentTextActivitySheet(_ body: String) {
        let activityVC = UIActivityViewController(activityItems: [body], applicationActivities: nil)
        activityVC.completionWithItemsHandler = { _, completed, _, _ in
            guard completed else { return }
            Task { @MainActor in ReviewManager.shared.recordSuccessfulShare() }
        }
        presentFromTopViewController(activityVC)
    }

    private func shareToInstagram(body: String) {
        UIPasteboard.general.string = body
        guard let igURL = URL(string: "instagram://"),
              UIApplication.shared.canOpenURL(igURL) else {
            presentTextActivitySheet(body)
            return
        }
        UIApplication.shared.open(igURL) { success in
            Task { @MainActor in
                if success {
                    ToastService.shared.show("Share message copied — paste it into Instagram", type: .info)
                } else {
                    self.presentTextActivitySheet(body)
                }
            }
        }
    }

    private func shareToTikTok(url: URL, body: String) {
        guard let image = artworkImage else {
            UIPasteboard.general.string = body
            presentTextActivitySheet(body)
            return
        }
        Task { @MainActor in
            let result = await TikTokShareService.shared.shareCardImage(
                image,
                shareURL: url,
                message: body
            )
            switch result {
            case .launched:
                break
            case .fallback(let reason):
                #if DEBUG
                print("[SharePostcardView] TikTok fallback: \(reason)")
                #endif
                presentTextActivitySheet(body)
            }
        }
    }

    private func resolvedAccessPayload() -> (url: URL, pin: String)? {
        guard let urlString = shareURL,
              let url = URL(string: urlString) else { return nil }
        let pin = claimPIN?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !pin.isEmpty else { return nil }
        return (url, pin)
    }

    private func shareBodyText(
        url: URL,
        claimPIN: String,
        useFreshSocialPreview: Bool = false
    ) -> String {
        SongSharePayloadBuilder.message(
            shareURL: url.absoluteString,
            claimPin: claimPIN,
            recipientName: recipientName,
            occasion: occasion,
            socialPreviewToken: useFreshSocialPreview
                ? SongSharePayloadBuilder.freshSocialPreviewToken()
                : nil
        )
    }

    @discardableResult
    private func openExternalURL(_ string: String) -> Bool {
        guard let url = URL(string: string) else { return false }
        guard UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }

    private func presentFromTopViewController(_ vc: UIViewController) {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = windowScene.windows.first?.rootViewController else { return }
        var topVC = root
        while let presented = topVC.presentedViewController { topVC = presented }
        vc.popoverPresentationController?.sourceView = topVC.view
        topVC.present(vc, animated: true)
    }
}

// MARK: - Share targets

private enum ShareTarget {
    case messages, whatsapp, instagram, tiktok, twitter, copyLink

    var label: String {
        switch self {
        case .messages: return "Messages"
        case .whatsapp: return "WhatsApp"
        case .instagram: return "Instagram"
        case .tiktok: return "TikTok"
        case .twitter: return "X"
        case .copyLink: return "Copy Text"
        }
    }

    var symbol: String {
        switch self {
        case .messages: return "message.fill"
        case .whatsapp: return "phone.fill"
        case .instagram: return "camera.fill"
        case .tiktok: return "music.note"
        case .twitter: return "xmark"
        case .copyLink: return "link"
        }
    }

    var iconBackground: AnyShapeStyle {
        switch self {
        case .messages:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [Color(red: 0.31, green: 0.80, blue: 0.33),
                             Color(red: 0.18, green: 0.71, blue: 0.29)],
                    startPoint: .top, endPoint: .bottom
                )
            )
        case .whatsapp:
            return AnyShapeStyle(Color(red: 0.14, green: 0.83, blue: 0.40))
        case .instagram:
            return AnyShapeStyle(
                LinearGradient(
                    colors: [
                        Color(red: 0.99, green: 0.85, blue: 0.46),
                        Color(red: 0.98, green: 0.49, blue: 0.12),
                        Color(red: 0.84, green: 0.16, blue: 0.46),
                        Color(red: 0.59, green: 0.18, blue: 0.75),
                        Color(red: 0.31, green: 0.36, blue: 0.84),
                    ],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            )
        case .tiktok:
            return AnyShapeStyle(Color.black)
        case .twitter:
            return AnyShapeStyle(Color.black)
        case .copyLink:
            return AnyShapeStyle(DesignTokens.surfaceMuted)
        }
    }

    var iconForeground: Color {
        switch self {
        case .copyLink: return DesignTokens.textSecondary
        default: return .white
        }
    }
}

// MARK: - Preview

#Preview("Birthday with artwork") {
    SharePostcardView(
        recipientName: "Sarah",
        occasion: "birthday",
        shareURL: "https://porizo.app/s/abc123",
        claimPIN: "4827",
        artworkURL: nil,
        onSend: {},
        onSaveToPhotos: {},
        onCopyLink: {},
        onSkip: {}
    )
}

#Preview("Mother's Day") {
    SharePostcardView(
        recipientName: "Chioma",
        occasion: "mothers_day",
        shareURL: "https://porizo.app/s/xyz789",
        claimPIN: "1234",
        artworkURL: nil,
        onSend: {},
        onSaveToPhotos: {},
        onCopyLink: {},
        onSkip: {}
    )
}
