//
//  ShareSheetView.swift
//  PorizoApp
//
//  Share sheet for creating and managing share links.
//  Velvet & Gold design system.
//

import SwiftUI

struct ShareSheetView: View {
    var shareController: ShareController
    let trackId: String
    let versionNum: Int
    let trackTitle: String
    let recipientName: String
    @Environment(\.dismiss) private var dismiss

    // UI state (pure view-layer, not share logic)
    @State private var showingRevokeConfirmation = false
    @State private var copiedToClipboard = false
    @State private var imageSavedToast = false
    @State private var copiedResetTask: Task<Void, Never>?
    @State private var imageToastTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        switch shareController.phase {
                        case .idle, .loading:
                            loadingView
                        case .noShare:
                            createShareView
                        case .hasShare:
                            shareDetailsView
                        case .creating:
                            creatingView
                        case .failed(let message):
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
                        .foregroundStyle(.white)
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
                    shareController.revokeShare(trackId: trackId)
                }
            } message: {
                Text("This will permanently disable the share link. The recipient will no longer be able to listen to this song.")
            }
        }
        .onAppear {
            shareController.checkShareStatus(trackId: trackId)
            shareController.loadOgPreviews(trackId: trackId)
        }
        .onDisappear {
            copiedResetTask?.cancel()
            imageToastTask?.cancel()
        }
    }

    // MARK: - Views

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
            Text("Loading share status...")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    private var createShareView: some View {
        VStack(spacing: 24) {
            // Gift icon
            Image(systemName: "gift.fill")
                .font(.system(size: 60))
                .foregroundStyle(DesignTokens.gold)
                .padding(.top, 20)

            VStack(spacing: 8) {
                Text("Share Your Song")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Create a private link so \(recipientName) can listen to their personalized song.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // How it works
            VStack(alignment: .leading, spacing: 12) {
                Text("How it works")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                howItWorksItem(number: "1", text: "We'll create a private link and secret PIN")
                howItWorksItem(number: "2", text: "Share the link with your recipient")
                howItWorksItem(number: "3", text: "Tell them the PIN separately (for security)")
                howItWorksItem(number: "4", text: "They can listen on any device for 30 days")
            }
            .padding()
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 12))

            OGVariantPicker(state: shareController.ogState, showApplyButton: false)

            // Create button
            Button {
                shareController.generateShareLink(trackId: trackId, versionNum: versionNum)
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "link.badge.plus")
                    Text("Create Share Link")
                    Spacer()
                }
                .font(.headline)
                .foregroundStyle(.white)
                .padding()
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 12))
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
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    private var shareDetailsView: some View {
        VStack(spacing: 24) {
            // QR Code
            if let qrData = shareController.qrCodeData, let image = qrCodeImage(from: qrData.qrDataUrl) {
                VStack(spacing: 12) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 200, height: 200)
                        .background(Color.white)
                        .clipShape(.rect(cornerRadius: 12))

                    Text("Scan to listen")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            // PIN display
            if let pin = shareController.claimPin {
                VStack(spacing: 8) {
                    Text("Secret PIN")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)

                    Text(pin)
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .foregroundStyle(DesignTokens.gold)
                        .tracking(8)

                    Text("Share this PIN separately with your recipient")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 12))
            }

            OGVariantPicker(state: shareController.ogState, showApplyButton: true) {
                shareController.applyOgVariant(trackId: trackId, versionNum: versionNum)
            }

            // Share options grid
            if let url = shareController.shareURLString,
               let pin = shareController.claimPin {
                shareOptionsSection(url: url, pin: pin)
            }

            // Share stats
            if let stats = shareController.stats {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Share Status")
                        .font(.headline)
                        .foregroundStyle(DesignTokens.textPrimary)

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

                        if let expiresDate = try? Date(stats.expiresAt, strategy: .iso8601) {
                            let daysLeft = Calendar.current.dateComponents([.day], from: Date.now, to: expiresDate).day ?? 0
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
                .clipShape(.rect(cornerRadius: 12))
            }

            // Share Song CTA
            if let url = shareController.shareURLString,
               let pin = shareController.claimPin {
                Button {
                    shareViaSystemSheet(url, pin: pin)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 18))
                        Text("Share Song")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(DesignTokens.background)
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
                    .foregroundStyle(DesignTokens.error)
            }
            .padding(.top, 8)
        }
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 50))
                .foregroundStyle(DesignTokens.warning)

            Text("Something went wrong")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                shareController.checkShareStatus(trackId: trackId)
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundStyle(DesignTokens.gold)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(DesignTokens.gold.opacity(0.15))
                .clipShape(.rect(cornerRadius: 20))
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
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(DesignTokens.gold)
                .clipShape(Circle())

            Text(text)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }

    private func statItem(icon: String, title: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
            Text(title)
                .font(.caption)
        }
        .foregroundStyle(color)
    }


    // MARK: - Share Options

    private func shareOptionsSection(url: String, pin: String) -> some View {
        VStack(spacing: 12) {
            Text("SHARE VIA")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundStyle(DesignTokens.textTertiary)
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
                        .foregroundStyle(.white)
                }
                Text(label)
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.textSecondary)
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
            .expirationDate: Date.now.addingTimeInterval(60 * 5),
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
        queryItems.append(URLQueryItem(name: "smv", value: String(Int(Date.now.timeIntervalSince1970))))
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
        scheduleImageSavedToastReset()
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

    // MARK: - View Helpers

    private func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
        copiedToClipboard = true
        scheduleCopiedReset()
    }

    private func qrCodeImage(from dataUrl: String) -> UIImage? {
        // Parse data URL: data:image/png;base64,<data>
        guard let commaIndex = dataUrl.firstIndex(of: ",") else { return nil }
        let base64String = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64String) else { return nil }
        return UIImage(data: data)
    }

    private func scheduleCopiedReset() {
        copiedResetTask?.cancel()
        copiedResetTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                copiedToClipboard = false
            }
        }
    }

    private func scheduleImageSavedToastReset() {
        imageToastTask?.cancel()
        imageToastTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation {
                    imageSavedToast = false
                }
            }
        }
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
                .foregroundStyle(Color(hex: "D4A574").opacity(0.6))

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
                    .foregroundStyle(.white)
            }

            // Title
            Text(title)
                .font(.system(size: 32, weight: .bold, design: .serif))
                .foregroundStyle(.white)
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
                .foregroundStyle(.white.opacity(0.8))

            Spacer(minLength: 32)

            // Bottom ornament
            Text("\u{266B}")
                .font(.system(size: 18))
                .foregroundStyle(Color(hex: "D4A574").opacity(0.4))

            // Branding
            Text("porizo.co")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.3))

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
        shareController: ShareController(apiClient: APIClient(baseURL: AppConfig.apiBaseURL)),
        trackId: "test-track-id",
        versionNum: 1,
        trackTitle: "Happy Birthday Song",
        recipientName: "Mom"
    )
}
