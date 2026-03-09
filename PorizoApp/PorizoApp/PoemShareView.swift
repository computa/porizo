//
//  PoemShareView.swift
//  PorizoApp
//
//  Share sheet for poems with link, PIN, and social options.
//  Matches v1.pen "22 - Share Poem" design.
//

import SwiftUI

struct PoemShareView: View {
    let poem: Poem
    @Environment(\.dismiss) private var dismiss
    @Environment(APIClientWrapper.self) private var apiClient

    @State private var isCreatingShare: Bool = false
    @State private var shareResponse: CreatePoemShareResponse?
    @State private var error: String?
    @State private var hasCopiedLink: Bool = false
    @State private var expiresInDays: Int = 30
    @State private var allowSave: Bool = true
    @State private var imageSavedToast: Bool = false
    @State private var ogState = OGVariantPickerState()

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Content
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Preview Card
                        previewCard

                        OGVariantPicker(state: ogState, showApplyButton: shareResponse != nil, onApply: applyOgVariantSelection)

                        if let shareResponse = shareResponse {
                            // Link Section
                            linkSection(shareResponse)

                            // Settings Section
                            settingsSection(shareResponse)

                            // Share Options
                            shareOptionsSection(shareResponse)
                        } else if isCreatingShare {
                            loadingView
                        } else if let error = error {
                            errorView(error)
                        } else {
                            createPromptView
                        }

                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                }

                // Bottom Button
                if shareResponse != nil {
                    shareButton
                } else {
                    createShareButton
                }
            }

            // Image saved toast
            if imageSavedToast {
                VStack {
                    Spacer()
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Saved to Photos")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textPrimary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(DesignTokens.surface)
                    .clipShape(Capsule())
                    .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
                    .padding(.bottom, 100)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task {
            await loadPoemOgPreviews()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            // Close Button
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }

            Spacer()

            Text("Share Poem")
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            // Spacer for balance
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Preview Card

    private var previewCard: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "E8B4B8"), DesignTokens.gold],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 200)
                    .shadow(color: DesignTokens.gold.opacity(0.25), radius: 24, y: 8)

                VStack(spacing: 8) {
                    // Border Frame
                    VStack(spacing: 12) {
                        Image(systemName: "text.book.closed.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)

                        Text("For \(poem.recipientName)")
                            .font(.custom("PlayfairDisplay-SemiBold", size: 20))
                            .foregroundColor(.white)

                        Text(occasionDisplayName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(.white.opacity(0.4), lineWidth: 2)
                            .padding(8)
                    )
                }
                .padding(24)
            }
        }
    }

    // MARK: - Link Section

    private func linkSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SHARE LINK")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.textTertiary)

            HStack(spacing: 8) {
                Text(response.shareUrl)
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    UIPasteboard.general.string = response.shareUrl
                    withAnimation(.spring(response: 0.3)) {
                        hasCopiedLink = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation { hasCopiedLink = false }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: hasCopiedLink ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 14))
                        Text(hasCopiedLink ? "Copied" : "Copy")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(hasCopiedLink ? .green : DesignTokens.gold)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        (hasCopiedLink ? Color.green : DesignTokens.gold).opacity(0.15)
                    )
                    .clipShape(Capsule())
                }
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Settings Section

    private func settingsSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(spacing: 0) {
            // PIN Protection Row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PIN Protection")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text("Share this PIN with the recipient")
                        .font(.system(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                Text(response.claimPin)
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundColor(DesignTokens.gold)
            }
            .padding(16)

            // Divider
            Rectangle()
                .fill(DesignTokens.border)
                .frame(height: 1)

            // Expires Row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Expires")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text("Link will expire after this date")
                        .font(.system(size: 13))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                Text(formatExpiryDate(response.expiresAt))
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(16)
        }
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Share Options

    private func shareOptionsSection(_ response: CreatePoemShareResponse) -> some View {
        VStack(spacing: 12) {
            Text("SHARE VIA")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundColor(DesignTokens.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 16) {
                // Messages
                shareOptionButton(
                    icon: "message.fill",
                    label: "Messages",
                    color: .green
                ) {
                    shareViaMessages(response.shareUrl, pin: response.claimPin)
                }

                // Facebook
                shareOptionButton(
                    icon: "f.circle.fill",
                    label: "Facebook",
                    color: Color(hex: "1877F2")
                ) {
                    shareViaFacebook(response.shareUrl)
                }

                // X
                shareOptionButton(
                    icon: "xmark",
                    label: "X",
                    color: .black
                ) {
                    shareViaX(response.shareUrl)
                }

                // Instagram
                shareOptionButton(
                    icon: "camera.fill",
                    label: "Instagram",
                    color: Color(hex: "E1306C")
                ) {
                    shareViaInstagram(response.shareUrl)
                }

                // TikTok
                shareOptionButton(
                    icon: "music.note",
                    label: "TikTok",
                    color: Color(hex: "111111")
                ) {
                    shareViaTikTok(response.shareUrl)
                }

                // WhatsApp
                shareOptionButton(
                    icon: "phone.fill",
                    label: "WhatsApp",
                    color: Color(hex: "25D366")
                ) {
                    shareViaWhatsApp(response.shareUrl, pin: response.claimPin)
                }

                // Email
                shareOptionButton(
                    icon: "envelope.fill",
                    label: "Email",
                    color: .blue
                ) {
                    shareViaEmail(response.shareUrl, pin: response.claimPin)
                }

                // Copy Link
                shareOptionButton(
                    icon: "link",
                    label: "Copy Link",
                    color: DesignTokens.gold
                ) {
                    UIPasteboard.general.string = response.shareUrl
                    withAnimation(.spring(response: 0.3)) {
                        hasCopiedLink = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation { hasCopiedLink = false }
                    }
                }

                // Save Image
                shareOptionButton(
                    icon: "square.and.arrow.down",
                    label: "Save Image",
                    color: .purple
                ) {
                    saveImageToPhotos()
                }

                // More
                shareOptionButton(
                    icon: "ellipsis",
                    label: "More",
                    color: DesignTokens.textSecondary
                ) {
                    shareViaSystemSheet(response.shareUrl, pin: response.claimPin)
                }
            }
        }
    }

    private func shareOptionButton(
        icon: String,
        label: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
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


    // MARK: - Share Button

    private var createPromptView: some View {
        VStack(spacing: 12) {
            Image(systemName: "link.badge.plus")
                .font(.system(size: 30))
                .foregroundColor(DesignTokens.gold)
            Text("Pick a card style, then create your private share link.")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private var createShareButton: some View {
        Button {
            Task { await createShare() }
        } label: {
            HStack(spacing: 8) {
                if isCreatingShare {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(DesignTokens.background)
                        .scaleEffect(0.9)
                } else {
                    Image(systemName: "link.badge.plus")
                        .font(.system(size: 18))
                }
                Text(isCreatingShare ? "Creating Link..." : "Create Share Link")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: 28))
        }
        .disabled(isCreatingShare)
        .padding(.horizontal, 20)
        .padding(.bottom, 34)
    }

    // MARK: - Share Button

    private var shareButton: some View {
        Button {
            if let response = shareResponse {
                shareViaSystemSheet(response.shareUrl, pin: response.claimPin)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 18))
                Text("Share Poem")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: 28))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 34)
    }

    // MARK: - Loading & Error States

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                .scaleEffect(1.2)

            Text("Creating share link...")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.red)

            Text(message)
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                Task { await createShare() }
            } label: {
                Text("Try Again")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.gold)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Poem Share Card (for ImageRenderer)

    @MainActor
    private func renderPoemImage() -> UIImage? {
        let shareCard = PoemShareCard(poem: poem)
        let renderer = ImageRenderer(content: shareCard.frame(width: 1080))
        renderer.scale = 2.0
        return renderer.uiImage
    }

    // MARK: - Helpers

    private var occasionDisplayName: String {
        switch poem.occasion.lowercased() {
        case "birthday": return "Birthday"
        case "anniversary": return "Anniversary"
        case "thank_you": return "Thank You"
        case "i_love_you": return "Love"
        case "wedding": return "Wedding"
        case "graduation": return "Graduation"
        case "celebration": return "Celebration"
        case "apology": return "Apology"
        case "encouragement": return "Encouragement"
        case "advice": return "Advice"
        case "bereavement": return "Bereavement"
        default: return "Poem"
        }
    }

    private func formatExpiryDate(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else { return isoString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "MMM d, yyyy"
        return displayFormatter.string(from: date)
    }

    private func loadPoemOgPreviews() async {
        await MainActor.run {
            ogState.isLoading = true
            ogState.error = nil
        }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadPoemOgPreviews") {
                try await apiClient.client.getPoemOgPreviews(poemId: poem.id)
            }
            await MainActor.run {
                ogState.previews = response.variants
                ogState.currentVariant = response.currentVariant
                if let selected = ogState.selectedVariant,
                   response.variants.contains(where: { $0.name == selected }) {
                    // Preserve explicit user selection when still valid.
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

    private func applyOgVariantSelection() {
        guard let selectedVariant = ogState.selectedVariant, !selectedVariant.isEmpty else { return }
        ogState.isApplying = true
        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "applyPoemOgVariant") {
                    try await apiClient.client.createPoemShare(
                        poemId: poem.id,
                        expiresInDays: expiresInDays,
                        allowSave: allowSave,
                        ogVariant: selectedVariant
                    )
                }
                await MainActor.run {
                    self.shareResponse = response
                    ogState.currentVariant = selectedVariant
                    ogState.isApplying = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    ogState.isApplying = false
                }
            }
        }
    }

    private func createShare() async {
        isCreatingShare = true
        error = nil

        do {
            let selectedVariant = ogState.selectedVariant
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createPoemShare") {
                try await apiClient.client.createPoemShare(
                    poemId: poem.id,
                    expiresInDays: expiresInDays,
                    allowSave: allowSave,
                    ogVariant: selectedVariant
                )
            }
            await MainActor.run {
                self.shareResponse = response
                ogState.currentVariant = selectedVariant
                self.isCreatingShare = false
            }
            await loadPoemOgPreviews()
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isCreatingShare = false
            }
        }
    }

    // MARK: - Share Actions

    private func shareViaMessages(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let smsUrl = URL(string: "sms:&body=\(encoded)") {
            UIApplication.shared.open(smsUrl)
        }
    }

    private func shareViaWhatsApp(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
        if let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let waUrl = URL(string: "whatsapp://send?text=\(encoded)") {
            UIApplication.shared.open(waUrl)
        }
    }

    private func shareViaEmail(_ url: String, pin: String) {
        let poemText = poem.verses.joined(separator: "\n\n")
        let subject = "A Special Poem for \(poem.recipientName)"
        let body = """
        I wrote a poem for you!

        \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}
        For \(poem.recipientName)

        \(poemText)

        With love \u{2726}
        \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}

        Read it with the full experience: \(url)
        PIN: \(pin)
        """
        if let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let encodedBody = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
           let mailUrl = URL(string: "mailto:?subject=\(encodedSubject)&body=\(encodedBody)") {
            UIApplication.shared.open(mailUrl)
        }
    }

    private func shareViaFacebook(_ url: String) {
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

        guard let backgroundImageData = renderPoemImage()?.pngData(),
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
        guard let shareImage = renderPoemImage() else {
            presentActivityVC(items: [shareURL])
            return
        }

        Task { @MainActor in
            let result = await TikTokShareService.shared.shareCardImage(shareImage, shareURL: shareURL)
            if case .fallback(let reason) = result {
                print("[PoemShare][TikTok] Falling back to activity sheet: \(reason)")
                presentActivityVC(items: [shareURL])
            }
        }
    }

    private func shareViaSystemSheet(_ url: String, pin: String) {
        let text = "I wrote a poem for you! Open it here: \(url)\n\nUse PIN: \(pin)"
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

    private func presentActivityVC(items: [Any]) {
        let activityVC = UIActivityViewController(
            activityItems: items,
            applicationActivities: nil
        )

        // Find the topmost presented view controller in the key window
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
              let keyWindow = windowScene.windows.first(where: { $0.isKeyWindow })
                ?? windowScene.windows.first else { return }

        var topVC: UIViewController? = keyWindow.rootViewController
        while let presented = topVC?.presentedViewController {
            topVC = presented
        }
        guard let presenter = topVC else { return }

        // Required for iPad
        activityVC.popoverPresentationController?.sourceView = presenter.view
        activityVC.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 100,
            width: 0, height: 0
        )

        presenter.present(activityVC, animated: true)
    }

    private func saveImageToPhotos() {
        guard let image = renderPoemImage() else { return }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        withAnimation(.spring(response: 0.3)) {
            imageSavedToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation { imageSavedToast = false }
        }
    }
}

// MARK: - Poem Share Card (rendered as image for sharing)

/// A simplified poem card optimized for 1080px share images.
/// Dark background with gold accents, no interactive elements.
private struct PoemShareCard: View {
    let poem: Poem

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 48)

            // Top ornament
            Text("\u{2726} \u{2500}\u{2500}\u{2500} \u{2726}")
                .font(.system(size: 20))
                .foregroundColor(Color(hex: "D4A574").opacity(0.6))

            // Recipient
            Text("For \(poem.recipientName)")
                .font(.custom("PlayfairDisplay-SemiBold", size: 36))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)

            // Occasion
            Text(occasionLabel.uppercased())
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Color(hex: "D4A574"))
                .tracking(2)

            // Divider
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(hex: "D4A574").opacity(0),
                            Color(hex: "D4A574"),
                            Color(hex: "D4A574").opacity(0)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: 300, height: 1)

            // Verses
            VStack(spacing: 24) {
                ForEach(poem.verses.indices, id: \.self) { index in
                    let verse = poem.verses[index]
                    if !verse.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(verse)
                            .font(.custom("PlayfairDisplay-Regular", size: 22))
                            .italic()
                            .foregroundColor(.white.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .lineSpacing(8)
                    }
                }
            }
            .padding(.horizontal, 48)

            // Divider
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(hex: "D4A574").opacity(0),
                            Color(hex: "D4A574"),
                            Color(hex: "D4A574").opacity(0)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: 300, height: 1)

            // Bottom ornament
            Text("\u{2726}")
                .font(.system(size: 18))
                .foregroundColor(Color(hex: "D4A574").opacity(0.5))

            // Branding
            Text("porizo.co")
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.3))

            Spacer(minLength: 48)
        }
        .frame(maxWidth: .infinity)
        .background(Color(hex: "0A0A0A"))
    }

    private var occasionLabel: String {
        switch poem.occasion.lowercased() {
        case "birthday": return "Birthday"
        case "anniversary": return "Anniversary"
        case "thank_you": return "Thank You"
        case "i_love_you": return "Love"
        case "wedding": return "Wedding"
        case "graduation": return "Graduation"
        case "celebration": return "Celebration"
        case "apology": return "Apology"
        case "encouragement": return "Encouragement"
        case "advice": return "Advice"
        case "bereavement": return "Bereavement"
        default: return "Poem"
        }
    }
}

#Preview {
    PoemShareView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            tone: "heartfelt",
            status: "complete",
            verses: ["Another year of wonder."],
            createdAt: "2026-01-27",
            updatedAt: "2026-01-27"
        )
    )
    .environment(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
