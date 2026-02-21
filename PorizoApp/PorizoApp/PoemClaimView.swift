//
//  PoemClaimView.swift
//  PorizoApp
//
//  Claim flow for shared poems - shows reveal animation, PIN entry, then full poem.
//  Orchestrates PoemRevealView and SharedPoemView with backend integration.
//

import SwiftUI

struct PoemClaimView: View {
    let apiClient: APIClient
    let shareId: String

    @Environment(\.dismiss) private var dismiss

    @State private var state: PoemClaimState = .loading
    @State private var shareInfo: PoemShareInfoResponse?
    @State private var claimResponse: PoemShareClaimResponse?
    @State private var claimedPoem: Poem?
    @State private var pin = ""
    @State private var pinError: String?

    enum PoemClaimState: Equatable {
        case loading
        case reveal       // Show gift animation
        case requiresPin  // PIN entry
        case claimed      // Show full poem
        case error(String)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            switch state {
            case .loading:
                loadingView

            case .reveal:
                if let info = shareInfo {
                    PoemRevealView(shareInfo: info) {
                        withAnimation(.spring(response: 0.4)) {
                            state = .requiresPin
                        }
                    }
                }

            case .requiresPin:
                pinEntryView

            case .claimed:
                if let poem = claimedPoem {
                    SharedPoemView(
                        poem: poem,
                        claimResponse: claimResponse,
                        shareUrl: "\(AppConfig.apiBaseURL)/poem/\(shareId)",
                        onDone: { dismiss() }
                    )
                }

            case .error(let message):
                errorView(message: message)
            }
        }
        .onAppear {
            loadShareInfo()
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(DesignTokens.gold)

            Text("Loading poem...")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Shared Components

    private var dismissHeader: some View {
        HStack {
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
        }
        .padding(.horizontal, 20)
    }

    // MARK: - PIN Entry View

    private var pinEntryView: some View {
        VStack(spacing: 24) {
            dismissHeader

            VStack(spacing: 16) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 40))
                    .foregroundColor(DesignTokens.gold)

                Text("Enter PIN")
                    .font(DesignTokens.displayFont(size: 24, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("The sender shared a secret PIN with you.\nEnter it below to read this poem.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 40)

            // PIN Input
            VStack(spacing: 12) {
                TextField("000000", text: $pin)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .tracking(8)
                    .foregroundColor(DesignTokens.textPrimary)
                    .padding(.vertical, 20)
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .onChange(of: pin) { _, newValue in
                        pin = String(newValue.filter { $0.isNumber }.prefix(6))
                        pinError = nil
                    }

                if let pinError {
                    Text(pinError)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.error)
                }
            }
            .padding(.horizontal, 20)

            // Submit Button
            Button {
                claimPoem()
            } label: {
                HStack {
                    Image(systemName: "lock.open.fill")
                    Text("Unlock Poem")
                }
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(pin.count == 6 ? .black : DesignTokens.textTertiary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(pin.count == 6 ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(14)
            }
            .disabled(pin.count != 6)
            .padding(.horizontal, 20)

            Spacer()
        }
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 24) {
            dismissHeader

            Spacer()

            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.warning)

                Text("Something went wrong")
                    .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text(message)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                Button {
                    loadShareInfo()
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                        Text("Try Again")
                    }
                    .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.gold)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.gold.opacity(0.15))
                    .cornerRadius(20)
                }
            }
            .padding(.horizontal, 20)

            Spacer()
        }
    }

    // MARK: - Actions

    private func loadShareInfo() {
        state = .loading

        Task {
            do {
                let info = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getPoemShareInfo") {
                    try await apiClient.getPoemShareInfo(shareId: shareId)
                }
                await MainActor.run {
                    self.shareInfo = info

                    switch info.status {
                    case "active", "claimed":
                        // Check if already claimed by this device
                        if info.canAccess == true {
                            // Re-call claim endpoint (idempotent) to get correct poem ID + full verses
                            self.reClaimPoem()
                        } else if info.requiresPin == true {
                            state = .reveal  // Show reveal animation first
                        } else {
                            state = .error("Unable to access this poem.")
                        }
                    case "expired":
                        state = .error("This poem share link has expired.")
                    case "revoked":
                        state = .error("This poem share link has been revoked.")
                    default:
                        state = .error("This poem is not available.")
                    }
                }
            } catch let error as APIClientError {
                await MainActor.run {
                    state = .error(mapPoemShareError(error))
                }
            } catch {
                await MainActor.run {
                    state = .error(error.localizedDescription)
                }
            }
        }
    }

    private func reClaimPoem() {
        // Re-call claim endpoint for already-accessible poems to get correct poem ID + full verses
        // The endpoint is idempotent for already-bound devices
        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "reClaimPoemShare") {
                    try await apiClient.claimPoemShare(shareId: shareId, pin: "")
                }
                await MainActor.run {
                    self.claimResponse = response
                    if let claimedPoemData = response.poem {
                        self.claimedPoem = claimedPoemData
                        state = .claimed
                    } else {
                        state = .error("Poem data not available.")
                    }
                }
            } catch {
                await MainActor.run {
                    // Fall back to PIN entry if re-claim fails
                    state = .requiresPin
                }
            }
        }
    }

    private func claimPoem() {
        pinError = nil

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "claimPoemShare") {
                    try await apiClient.claimPoemShare(shareId: shareId, pin: pin)
                }
                await MainActor.run {
                    self.claimResponse = response

                    // Convert the claim response poem to a full Poem
                    if let claimedPoemData = response.poem {
                        self.claimedPoem = claimedPoemData
                        withAnimation(.spring(response: 0.4)) {
                            state = .claimed
                        }
                    } else {
                        // Claim succeeded but no poem data - show error
                        state = .error("Poem data not available.")
                    }
                }
            } catch let error as APIClientError {
                await MainActor.run {
                    pinError = mapPoemShareError(error)
                }
            } catch {
                await MainActor.run {
                    pinError = error.localizedDescription
                }
            }
        }
    }

    private func mapPoemShareError(_ error: APIClientError) -> String {
        switch error {
        case .httpError(let statusCode, _):
            switch statusCode {
            case 404:
                return "Poem share link not found."
            case 410:
                return "This poem share link has expired."
            case 401:
                return "Invalid PIN. Please try again."
            case 403:
                return "Access denied. Too many attempts."
            case 429:
                return "Too many attempts. Please wait and try again."
            default:
                return error.localizedDescription
            }
        case .serverError(let message):
            if message.lowercased().contains("invalid pin") {
                return "Invalid PIN. Please check and try again."
            }
            if message.lowercased().contains("expired") {
                return "This poem share link has expired."
            }
            return message
        default:
            return error.localizedDescription
        }
    }
}

#Preview {
    PoemClaimView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        shareId: "test-poem-share-id"
    )
}
