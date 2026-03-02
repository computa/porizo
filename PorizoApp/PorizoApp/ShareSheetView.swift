//
//  ShareSheetView.swift
//  PorizoApp
//
//  Share sheet for creating and managing share links.
//  Velvet & Gold design system.
//

import SwiftUI

struct ShareSheetView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let trackTitle: String
    let recipientName: String
    @Environment(\.dismiss) private var dismiss

    // Share state
    @State private var shareState: ShareState = .loading
    @State private var shareResponse: CreateShareResponse?
    @State private var shareStats: ShareStats?
    @State private var qrCodeData: QRCodeDataResponse?
    @State private var ogState = OGVariantPickerState()

    // UI state
    @State private var showingRevokeConfirmation = false
    @State private var copiedToClipboard = false
    @State private var imageSavedToast = false

    enum ShareState {
        case loading
        case noShare
        case hasShare
        case creating
        case error(String)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        switch shareState {
                        case .loading:
                            loadingView
                        case .noShare:
                            createShareView
                        case .hasShare:
                            shareDetailsView
                        case .creating:
                            creatingView
                        case .error(let message):
                            errorView(message: message)
                        }
                    }
                    .padding()
                }

                // "Saved to Photos" toast
                if imageSavedToast {
                    VStack {
                        Spacer()
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                            Text("Saved to Photos")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(.ultraThinMaterial)
                        .clipShape(Capsule())
                        .padding(.bottom, 40)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationTitle("Share Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .alert("Revoke Share?", isPresented: $showingRevokeConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Revoke", role: .destructive) {
                    revokeShare()
                }
            } message: {
                Text("This will permanently disable the share link. The recipient will no longer be able to listen to this song.")
            }
        }
        .onAppear {
            checkShareStatus()
            loadSongOgPreviews()
        }
    }

    // MARK: - Views

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
            Text("Loading share status...")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    private var createShareView: some View {
        VStack(spacing: 24) {
            // Gift icon
            Image(systemName: "gift.fill")
                .font(.system(size: 60))
                .foregroundColor(DesignTokens.gold)
                .padding(.top, 20)

            VStack(spacing: 8) {
                Text("Share Your Song")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Create a private link so \(recipientName) can listen to their personalized song.")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // How it works
            VStack(alignment: .leading, spacing: 12) {
                Text("How it works")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                howItWorksItem(number: "1", text: "We'll create a private link and secret PIN")
                howItWorksItem(number: "2", text: "Share the link with your recipient")
                howItWorksItem(number: "3", text: "Tell them the PIN separately (for security)")
                howItWorksItem(number: "4", text: "They can listen on any device for 30 days")
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(12)

            OGVariantPicker(state: ogState, showApplyButton: false)

            // Create button
            Button {
                createShare()
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "link.badge.plus")
                    Text("Create Share Link")
                    Spacer()
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding()
                .background(DesignTokens.gold)
                .cornerRadius(12)
            }
            .padding(.top, 8)
        }
    }

    private var creatingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
            Text("Creating share link...")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    private var shareDetailsView: some View {
        VStack(spacing: 24) {
            // QR Code
            if let qrData = qrCodeData, let image = qrCodeImage(from: qrData.qrDataUrl) {
                VStack(spacing: 12) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 200, height: 200)
                        .background(Color.white)
                        .cornerRadius(12)

                    Text("Scan to listen")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            // PIN display — from createShare response or stats
            if let pin = shareResponse?.claimPin ?? shareStats?.claimPin {
                VStack(spacing: 8) {
                    Text("Secret PIN")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(pin)
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .foregroundColor(DesignTokens.gold)
                        .tracking(8)

                    Text("Share this PIN separately with your recipient")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(DesignTokens.surface)
                .cornerRadius(12)
            }

            OGVariantPicker(state: ogState, showApplyButton: true, onApply: applyOgVariantSelection)

            // Share options grid — use response URL, or stats URL, or QR data URL
            if let url = shareResponse?.shareUrl ?? shareStats?.shareUrl ?? qrCodeData?.shareUrl,
               let pin = shareResponse?.claimPin ?? shareStats?.claimPin {
                shareOptionsSection(url: url, pin: pin)
            }

            // Share stats
            if let stats = shareStats {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Share Status")
                        .font(.headline)
                        .foregroundColor(DesignTokens.textPrimary)

                    HStack {
                        statItem(
                            icon: stats.isClaimed ? "checkmark.circle.fill" : "clock",
                            title: stats.isClaimed ? "Claimed" : "Unclaimed",
                            color: stats.isClaimed ? DesignTokens.success : DesignTokens.textSecondary
                        )

                        Spacer()

                        statItem(
                            icon: "eye",
                            title: "\(stats.totalEvents) views",
                            color: DesignTokens.textSecondary
                        )

                        Spacer()

                        if let expiresDate = ISO8601DateFormatter().date(from: stats.expiresAt) {
                            let daysLeft = Calendar.current.dateComponents([.day], from: Date(), to: expiresDate).day ?? 0
                            statItem(
                                icon: "calendar",
                                title: "\(max(0, daysLeft))d left",
                                color: daysLeft < 7 ? DesignTokens.warning : DesignTokens.textSecondary
                            )
                        }
                    }
                }
                .padding()
                .background(DesignTokens.surface)
                .cornerRadius(12)
            }

            // Share Song CTA
            if let url = shareResponse?.shareUrl ?? shareStats?.shareUrl ?? qrCodeData?.shareUrl,
               let pin = shareResponse?.claimPin ?? shareStats?.claimPin {
                Button {
                    shareViaSystemSheet(url, pin: pin)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 18))
                        Text("Share Song")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundColor(DesignTokens.background)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }

            // Revoke button
            Button {
                showingRevokeConfirmation = true
            } label: {
                Text("Revoke Share")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.error)
            }
            .padding(.top, 8)
        }
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 50))
                .foregroundColor(DesignTokens.warning)

            Text("Something went wrong")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text(message)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                checkShareStatus()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundColor(DesignTokens.gold)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(DesignTokens.gold.opacity(0.15))
                .cornerRadius(20)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    // MARK: - Helper Views

    private func howItWorksItem(number: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 20, height: 20)
                .background(DesignTokens.gold)
                .clipShape(Circle())

            Text(text)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    private func statItem(icon: String, title: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
            Text(title)
                .font(.caption)
        }
        .foregroundColor(color)
    }


    // MARK: - Share Options

    private func shareOptionsSection(url: String, pin: String) -> some View {
        VStack(spacing: 12) {
            Text("SHARE VIA")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 16) {
                shareOptionButton(icon: "message.fill", label: "Messages", color: .green) {
                    shareViaMessages(url, pin: pin)
                }

                shareOptionButton(icon: "f.circle.fill", label: "Facebook", color: Color(hex: "1877F2")) {
                    shareViaFacebook(url)
                }

                shareOptionButton(icon: "xmark", label: "X", color: .black) {
                    shareViaX(url)
                }

                shareOptionButton(icon: "camera.fill", label: "Instagram", color: Color(hex: "E1306C")) {
                    shareViaInstagram(url)
                }

                shareOptionButton(icon: "music.note", label: "TikTok", color: Color(hex: "111111")) {
                    shareViaTikTok(url)
                }

                shareOptionButton(icon: "phone.fill", label: "WhatsApp", color: Color(hex: "25D366")) {
                    shareViaWhatsApp(url, pin: pin)
                }

                shareOptionButton(icon: "envelope.fill", label: "Email", color: .blue) {
                    shareViaEmail(url, pin: pin)
                }

                shareOptionButton(icon: "link", label: copiedToClipboard ? "Copied!" : "Copy Link", color: DesignTokens.gold) {
                    copyToClipboard(url)
                }

                shareOptionButton(icon: "square.and.arrow.down", label: "Save Image", color: .purple) {
                    saveImageToPhotos()
                }

                shareOptionButton(icon: "ellipsis", label: "More", color: DesignTokens.textSecondary) {
                    shareViaSystemSheet(url, pin: pin)
                }
            }
        }
    }

    private func shareOptionButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(color)
                        .frame(width: 48, height: 48)
                    Image(systemName: icon)
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                }
                Text(label)
                    .font(.system(size: 11))
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
    }

    // MARK: - Share Actions

    private func shareViaMessages(_ url: String, pin: String) {
        let text = "I made you a personalized song! Listen here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let smsUrl = URL(string: "sms:&body=\(encoded)") {
            UIApplication.shared.open(smsUrl)
        }
    }

    private func shareViaWhatsApp(_ url: String, pin: String) {
        let text = "I made you a personalized song! Listen here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let waUrl = URL(string: "whatsapp://send?text=\(encoded)") {
            UIApplication.shared.open(waUrl)
        }
    }

    private func shareViaEmail(_ url: String, pin: String) {
        let subject = "\(trackTitle) \u{2013} A Song for \(recipientName)"
        let body = """
        I made a personalized song for you!

        \u{266B} \(trackTitle) \u{266B}
        For \(recipientName)

        Listen here: \(url)
        PIN: \(pin)
        """
        if let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let encodedBody = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let mailUrl = URL(string: "mailto:?subject=\(encodedSubject)&body=\(encodedBody)") {
            UIApplication.shared.open(mailUrl)
        }
    }

    private func shareViaFacebook(_ url: String) {
        // Facebook's direct URL-scheme handoff can open app home without the share payload.
        // Use iOS share sheet with URL-only payload, which reliably passes the link to Facebook.
        if let shareURL = buildSocialCacheBustURL(from: url, channel: "facebook") ?? URL(string: url) {
            presentActivityVC(items: [shareURL])
        } else {
            presentActivityVC(items: [url])
        }
    }

    private func shareViaX(_ url: String) {
        guard let shareURL = buildSocialCacheBustURL(from: url, channel: "x") ?? URL(string: url) else {
            presentActivityVC(items: [url])
            return
        }
        guard let encodedURL = shareURL.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            presentActivityVC(items: [shareURL])
            return
        }

        if let xAppURL = URL(string: "twitter://post?message=\(encodedURL)") {
            UIApplication.shared.open(xAppURL, options: [:]) { success in
                if success { return }
                if let webURL = URL(string: "https://x.com/intent/tweet?url=\(encodedURL)") {
                    UIApplication.shared.open(webURL, options: [:]) { webSuccess in
                        if !webSuccess {
                            presentActivityVC(items: [shareURL])
                        }
                    }
                } else {
                    presentActivityVC(items: [shareURL])
                }
            }
            return
        }

        presentActivityVC(items: [shareURL])
    }

    private func shareViaInstagram(_ url: String) {
        guard let shareURL = buildSocialCacheBustURL(from: url, channel: "instagram") ?? URL(string: url) else {
            presentActivityVC(items: [url])
            return
        }
        let sourceApplication = {
            if let configured = Bundle.main.object(forInfoDictionaryKey: "PORIZO_FACEBOOK_APP_ID") as? String,
               !configured.isEmpty {
                return configured
            }
            return Bundle.main.bundleIdentifier ?? "co.porizo.app"
        }()

        guard let backgroundImageData = renderSongShareImage()?.pngData(),
              let encodedSource = sourceApplication.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let instagramURL = URL(string: "instagram-stories://share?source_application=\(encodedSource)") else {
            presentActivityVC(items: [shareURL])
            return
        }

        let payload: [String: Any] = [
            "com.instagram.sharedSticker.backgroundImage": backgroundImageData,
            "com.instagram.sharedSticker.contentURL": shareURL.absoluteString,
        ]
        let options: [UIPasteboard.OptionsKey: Any] = [
            .expirationDate: Date().addingTimeInterval(60 * 5),
        ]
        UIPasteboard.general.setItems([payload], options: options)
        UIApplication.shared.open(instagramURL, options: [:]) { success in
            if !success {
                presentActivityVC(items: [shareURL])
            }
        }
    }

    private func shareViaTikTok(_ url: String) {
        guard let shareURL = buildSocialCacheBustURL(from: url, channel: "tiktok") ?? URL(string: url) else {
            presentActivityVC(items: [url])
            return
        }
        guard let shareImage = renderSongShareImage() else {
            presentActivityVC(items: [shareURL])
            return
        }

        Task { @MainActor in
            let result = await TikTokShareService.shared.shareCardImage(shareImage, shareURL: shareURL)
            if case .fallback(let reason) = result {
                print("[Share][TikTok] Falling back to activity sheet: \(reason)")
                presentActivityVC(items: [shareURL])
            }
        }
    }

    private func shareViaSystemSheet(_ url: String, pin: String) {
        let text = "I made you a personalized song! Listen here: \(url)\n\nUse PIN: \(pin)"
        let items: [Any] = [text]
        presentActivityVC(items: items)
    }

    private func buildSocialCacheBustURL(from urlString: String, channel: String) -> URL? {
        guard var components = URLComponents(string: urlString) else { return nil }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll(where: {
            ["fbv", "smv", "sp"].contains($0.name.lowercased())
        })
        queryItems.append(URLQueryItem(name: "smv", value: String(Int(Date().timeIntervalSince1970))))
        queryItems.append(URLQueryItem(name: "sp", value: channel))
        components.queryItems = queryItems
        return components.url
    }

    private func saveImageToPhotos() {
        guard let image = renderSongShareImage() else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        withAnimation(.spring(response: 0.3)) {
            imageSavedToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation { imageSavedToast = false }
        }
    }

    @MainActor
    private func renderSongShareImage() -> UIImage? {
        let card = SongShareCard(title: trackTitle, recipientName: recipientName)
        let renderer = ImageRenderer(content: card.frame(width: 1080))
        renderer.scale = 2.0
        return renderer.uiImage
    }

    private func presentActivityVC(items: [Any]) {
        let activityVC = UIActivityViewController(activityItems: items, applicationActivities: nil)
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
              let keyWindow = windowScene.windows.first(where: { $0.isKeyWindow })
                ?? windowScene.windows.first else { return }
        var topVC: UIViewController? = keyWindow.rootViewController
        while let presented = topVC?.presentedViewController {
            topVC = presented
        }
        guard let presenter = topVC else { return }
        activityVC.popoverPresentationController?.sourceView = presenter.view
        activityVC.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 100,
            width: 0, height: 0
        )
        presenter.present(activityVC, animated: true)
    }

    // MARK: - Actions

    private func loadSongOgPreviews() {
        ogState.isLoading = true
        ogState.error = nil

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadSongOgPreviews") {
                    try await apiClient.getTrackOgPreviews(trackId: trackId)
                }
                await MainActor.run {
                    ogState.previews = response.variants
                    ogState.currentVariant = response.currentVariant
                    if let selected = ogState.selectedVariant,
                       response.variants.contains(where: { $0.name == selected }) {
                        // Keep explicit user selection when still valid.
                    } else {
                        ogState.selectedVariant = response.currentVariant ?? response.variants.first?.name
                    }
                    ogState.isLoading = false
                }
            } catch {
                await MainActor.run {
                    ogState.isLoading = false
                    ogState.error = error.localizedDescription
                }
            }
        }
    }

    private func applyOgVariantSelection() {
        guard let selectedVariant = ogState.selectedVariant, !selectedVariant.isEmpty else { return }
        ogState.isApplying = true

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "applySongOgVariant") {
                    try await apiClient.createShare(
                        trackId: trackId,
                        versionNum: versionNum,
                        ogVariant: selectedVariant
                    )
                }
                await MainActor.run {
                    self.shareResponse = response
                    ogState.currentVariant = selectedVariant
                    ogState.isApplying = false
                    self.shareState = .hasShare
                    loadQRCode()
                    loadStats()
                }
            } catch {
                await MainActor.run {
                    ogState.isApplying = false
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func checkShareStatus() {
        shareState = .loading

        Task {
            do {
                let stats = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkShareStatus") {
                    try await apiClient.getShareStats(trackId: trackId)
                }
                await MainActor.run {
                    self.shareStats = stats
                    self.shareState = .hasShare
                    // Try to get QR code data
                    loadQRCode()
                }
            } catch let error as APIClientError {
                await MainActor.run {
                    // 404 or "no share exists" means no share created yet
                    switch error {
                    case .httpError(let statusCode, _) where statusCode == 404:
                        self.shareState = .noShare
                    case .serverError(let message):
                        let msg = message.lowercased()
                        // Match: "No share exists", "share not found", etc.
                        if msg.contains("no share") || msg.contains("share") && msg.contains("not found") {
                            self.shareState = .noShare
                        } else {
                            self.shareState = .error(error.localizedDescription)
                        }
                    default:
                        self.shareState = .error(error.localizedDescription)
                    }
                }
            } catch {
                await MainActor.run {
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func createShare() {
        shareState = .creating

        Task {
            do {
                let selectedVariant = ogState.selectedVariant
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createShare") {
                    try await apiClient.createShare(
                        trackId: trackId,
                        versionNum: versionNum,
                        ogVariant: selectedVariant
                    )
                }
                await MainActor.run {
                    self.shareResponse = response
                    ogState.currentVariant = selectedVariant
                    self.shareState = .hasShare
                    // Load QR code and stats
                    loadQRCode()
                    loadStats()
                    loadSongOgPreviews()
                }
            } catch {
                await MainActor.run {
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func loadQRCode() {
        Task {
            do {
                let qrData = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadQRCode") {
                    try await apiClient.getQRCodeData(trackId: trackId, size: 300)
                }
                await MainActor.run {
                    self.qrCodeData = qrData
                }
            } catch {
                print("[Share] Failed to load QR code: \(error)")
            }
        }
    }

    private func loadStats() {
        Task {
            do {
                let stats = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadShareStats") {
                    try await apiClient.getShareStats(trackId: trackId)
                }
                await MainActor.run {
                    self.shareStats = stats
                }
            } catch {
                print("[Share] Failed to load stats: \(error)")
            }
        }
    }

    private func revokeShare() {
        Task {
            do {
                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "revokeShare") {
                    try await apiClient.revokeShare(trackId: trackId)
                }
                await MainActor.run {
                    self.shareResponse = nil
                    self.shareStats = nil
                    self.qrCodeData = nil
                    self.shareState = .noShare
                }
            } catch {
                await MainActor.run {
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
        copiedToClipboard = true

        // Reset after 2 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copiedToClipboard = false
        }
    }

    private func qrCodeImage(from dataUrl: String) -> UIImage? {
        // Parse data URL: data:image/png;base64,<data>
        guard let commaIndex = dataUrl.firstIndex(of: ",") else { return nil }
        let base64String = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64String) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Song Share Card (rendered as image for sharing)

private struct SongShareCard: View {
    let title: String
    let recipientName: String

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 48)

            // Top ornament
            Text("\u{266B} \u{2500}\u{2500}\u{2500} \u{266B}")
                .font(.system(size: 20))
                .foregroundColor(Color(hex: "D4A574").opacity(0.6))

            // Music note icon
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "D4A574"), Color(hex: "8B7355")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 100, height: 100)

                Image(systemName: "music.note")
                    .font(.system(size: 44, weight: .light))
                    .foregroundColor(.white)
            }

            // Title
            Text(title)
                .font(.system(size: 32, weight: .bold, design: .serif))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            // Divider
            Rectangle()
                .fill(Color(hex: "D4A574").opacity(0.3))
                .frame(width: 120, height: 1)

            // "A song for [Name]"
            Text("A song for \(recipientName)")
                .font(.system(size: 22, design: .serif))
                .italic()
                .foregroundColor(.white.opacity(0.8))

            Spacer(minLength: 32)

            // Bottom ornament
            Text("\u{266B}")
                .font(.system(size: 18))
                .foregroundColor(Color(hex: "D4A574").opacity(0.4))

            // Branding
            Text("porizo.co")
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.3))

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 630)
        .background(
            ZStack {
                Color(hex: "0A0A0A")

                // Subtle radial glow
                RadialGradient(
                    colors: [Color(hex: "D4A574").opacity(0.08), .clear],
                    center: .center,
                    startRadius: 50,
                    endRadius: 400
                )
            }
        )
    }
}

#Preview {
    ShareSheetView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        trackId: "test-track-id",
        versionNum: 1,
        trackTitle: "Happy Birthday Song",
        recipientName: "Mom"
    )
}
