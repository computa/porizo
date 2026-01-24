//
//  ShareSheetView.swift
//  PorizoApp
//
//  Share sheet for creating and managing share links.
//  Displays QR code, PIN, and share options.
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

    // UI state
    @State private var showingRevokeConfirmation = false
    @State private var copiedToClipboard = false

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
                .foregroundColor(DesignTokens.rose)
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
            .background(DesignTokens.cardBackground)
            .cornerRadius(12)

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
                .background(DesignTokens.rose)
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

            // PIN display
            if let response = shareResponse {
                VStack(spacing: 8) {
                    Text("Secret PIN")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(response.claimPin)
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .foregroundColor(DesignTokens.rose)
                        .tracking(8)

                    Text("Share this PIN separately with your recipient")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(DesignTokens.cardBackground)
                .cornerRadius(12)
            }

            // Share actions
            VStack(spacing: 12) {
                // Copy link button
                if let response = shareResponse {
                    Button {
                        copyToClipboard(response.shareUrl)
                    } label: {
                        HStack {
                            Spacer()
                            Image(systemName: copiedToClipboard ? "checkmark" : "doc.on.doc")
                            Text(copiedToClipboard ? "Copied!" : "Copy Link")
                            Spacer()
                        }
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding()
                        .background(copiedToClipboard ? DesignTokens.success : DesignTokens.rose)
                        .cornerRadius(12)
                    }
                }

                // Share via system share sheet
                if let response = shareResponse {
                    ShareLink(
                        item: response.shareUrl,
                        subject: Text("\(trackTitle) - A song for \(recipientName)"),
                        message: Text("I made you a personalized song! Use PIN \(response.claimPin) to unlock it.")
                    ) {
                        HStack {
                            Spacer()
                            Image(systemName: "square.and.arrow.up")
                            Text("Share Link & PIN")
                            Spacer()
                        }
                        .font(.headline)
                        .foregroundColor(DesignTokens.rose)
                        .padding()
                        .background(DesignTokens.roseMuted)
                        .cornerRadius(12)
                    }
                }
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
                .background(DesignTokens.cardBackground)
                .cornerRadius(12)
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
                .foregroundColor(DesignTokens.rose)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(DesignTokens.roseMuted)
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
                .background(DesignTokens.rose)
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

    // MARK: - Actions

    private func checkShareStatus() {
        shareState = .loading

        Task {
            do {
                let stats = try await apiClient.getShareStats(trackId: trackId)
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
                let response = try await apiClient.createShare(trackId: trackId, versionNum: versionNum)
                await MainActor.run {
                    self.shareResponse = response
                    self.shareState = .hasShare
                    // Load QR code and stats
                    loadQRCode()
                    loadStats()
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
                let qrData = try await apiClient.getQRCodeData(trackId: trackId, size: 300)
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
                let stats = try await apiClient.getShareStats(trackId: trackId)
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
                try await apiClient.revokeShare(trackId: trackId)
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

#Preview {
    ShareSheetView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        trackId: "test-track-id",
        versionNum: 1,
        trackTitle: "Happy Birthday Song",
        recipientName: "Mom"
    )
}
