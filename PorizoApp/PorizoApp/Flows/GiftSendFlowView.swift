//
//  GiftSendFlowView.swift
//  PorizoApp
//
//  Sender flow for one-off token purchase + immediate/scheduled gift delivery.
//

import SwiftUI
import StoreKit

struct GiftSendFlowView: View {
    let apiClient: APIClient
    @ObservedObject var storeKit: StoreKitManager
    let onComplete: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var step: Step = .content
    @State private var contentType: GiftContentType = .song
    @State private var selectedTrackId: String?
    @State private var selectedTrackVersionNum: Int?
    @State private var selectedTrackTitle: String?
    @State private var selectedPoem: Poem?

    @State private var createLaunch: GiftCreateLaunch?
    @State private var songRetryCount = 0

    @State private var sendViaSMS = true
    @State private var sendViaEmail = false
    @State private var recipientPhone = ""
    @State private var recipientEmail = ""
    @State private var message = ""

    @State private var deliveryMode: GiftDeliveryMode = .immediate
    @State private var scheduledAt = Date().addingTimeInterval(60 * 60)

    @State private var walletBalance = 0
    @State private var walletTransactions: [GiftWalletTransaction] = []
    @State private var createdGift: GiftOrder?

    @State private var isBootstrapping = true
    @State private var isSubmitting = false
    @State private var isPurchasing = false
    @State private var errorMessage: String?

    enum Step: Int, CaseIterable {
        case content
        case recipient
        case delivery
        case review
        case success

        var title: String {
            switch self {
            case .content: return "Create Gift"
            case .recipient: return "Recipient"
            case .delivery: return "Delivery"
            case .review: return "Review & Send"
            case .success: return "Gift Scheduled"
            }
        }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                if step != .success {
                    progressDots
                        .padding(.top, 12)
                        .padding(.bottom, 8)
                }

                if isBootstrapping {
                    Spacer()
                    ProgressView("Loading gift wallet...")
                        .foregroundColor(DesignTokens.textSecondary)
                    Spacer()
                } else {
                    content
                }
            }
        }
        .task {
            await bootstrap()
        }
        .alert("Gift Flow Error", isPresented: Binding(
            get: { errorMessage != nil },
            set: { newValue in
                if !newValue { errorMessage = nil }
            }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .fullScreenCover(item: $createLaunch) { launch in
            CreateFlowView(
                apiClient: apiClient,
                preselectedType: launch.type,
                maxSongRerolls: 3,
                initialSongRerollsUsed: songRetryCount,
                allowedRerollTypes: [.lyrics],
                onSongRerollUsed: { used in
                    songRetryCount = min(used, 3)
                },
                onPoemComplete: { poem in
                    applyCreatedPoem(poem)
                },
                onComplete: { trackId, versionNum in
                    createLaunch = nil
                    Task {
                        await applyCreatedSong(trackId: trackId, versionNum: versionNum)
                    }
                },
                onCancel: {
                    createLaunch = nil
                }
            )
        }
    }

    private var header: some View {
        HStack {
            if step != .content && step != .success {
                Button {
                    goBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 40, height: 40)
                        .background(DesignTokens.cardBackground)
                        .clipShape(Circle())
                }
            } else {
                Color.clear.frame(width: 40, height: 40)
            }

            Spacer()

            Text(step.title)
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            Button {
                onCancel()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 40, height: 40)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<4, id: \.self) { index in
                Circle()
                    .fill(index <= step.rawValue ? DesignTokens.gold : DesignTokens.surfaceMuted)
                    .frame(width: 8, height: 8)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .content:
            contentStep
        case .recipient:
            recipientStep
        case .delivery:
            deliveryStep
        case .review:
            reviewStep
        case .success:
            successStep
        }
    }

    private var contentStep: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    sectionTitle("Create a fresh gift")

                    Text("Use the same creation flow as Express Yourself, then send the finished song or poem to someone else.")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)

                    if let selectedContentTitle {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Ready to send")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            Text(selectedContentTitle)
                                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                                .foregroundColor(DesignTokens.textPrimary)

                            if contentType == .song {
                                Text("Lyrics retries used: \(songRetryCount)/3")
                                    .font(DesignTokens.bodyFont(size: 13))
                                    .foregroundColor(DesignTokens.textSecondary)
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(12)
                    }

                    VStack(spacing: 10) {
                        createActionButton(
                            title: "Create Song Gift",
                            icon: "music.note",
                            action: { openCreateFlow(type: .song) }
                        )

                        createActionButton(
                            title: "Create Poem Gift",
                            icon: "text.book.closed",
                            action: { openCreateFlow(type: .poem) }
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }

            flowButton("Continue", disabled: selectedContentId == nil || isSubmitting) {
                step = .recipient
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private var recipientStep: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    sectionTitle("Delivery Channels")

                    channelToggle(
                        title: "SMS",
                        subtitle: "Send as a text message with gift link + PIN",
                        isOn: $sendViaSMS
                    )
                    channelToggle(
                        title: "Email",
                        subtitle: "Send by email with the same secure claim details",
                        isOn: $sendViaEmail
                    )

                    if sendViaSMS {
                        fieldLabel("Recipient phone")
                        TextField("+1 555 123 4567", text: $recipientPhone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .autocorrectionDisabled(true)
                            .textInputAutocapitalization(.never)
                            .padding(12)
                            .background(DesignTokens.cardBackground)
                            .cornerRadius(10)
                            .foregroundColor(DesignTokens.textPrimary)
                    }

                    if sendViaEmail {
                        fieldLabel("Recipient email")
                        TextField("name@example.com", text: $recipientEmail)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .autocorrectionDisabled(true)
                            .textInputAutocapitalization(.never)
                            .padding(12)
                            .background(DesignTokens.cardBackground)
                            .cornerRadius(10)
                            .foregroundColor(DesignTokens.textPrimary)
                    }

                    fieldLabel("Your message (optional)")
                    TextEditor(text: $message)
                        .frame(minHeight: 120)
                        .padding(8)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(10)
                        .foregroundColor(DesignTokens.textPrimary)
                        .overlay(alignment: .topLeading) {
                            if message.isEmpty {
                                Text("Add a short note for them...")
                                    .font(DesignTokens.bodyFont(size: 14))
                                    .foregroundColor(DesignTokens.textSecondary)
                                    .padding(.top, 16)
                                    .padding(.leading, 14)
                            }
                        }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }

            flowButton("Continue", disabled: !isRecipientStepValid || isSubmitting) {
                step = .delivery
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private var deliveryStep: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    sectionTitle("When should we deliver this gift?")

                    Picker("Delivery Mode", selection: $deliveryMode) {
                        Text("Now").tag(GiftDeliveryMode.immediate)
                        Text("Schedule").tag(GiftDeliveryMode.scheduled)
                    }
                    .pickerStyle(.segmented)

                    if deliveryMode == .scheduled {
                        DatePicker(
                            "Send date",
                            selection: $scheduledAt,
                            in: Date().addingTimeInterval(60)...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .datePickerStyle(.graphical)
                        .accentColor(DesignTokens.gold)
                        .padding(12)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(12)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Timezone")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundColor(DesignTokens.textSecondary)
                        Text(TimeZone.current.identifier)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.textPrimary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(10)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }

            flowButton("Continue", disabled: !isDeliveryStepValid || isSubmitting) {
                step = .review
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private var reviewStep: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    sectionTitle("Gift Summary")

                    summaryCard
                    walletCard
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }

            VStack(spacing: 10) {
                if walletBalance < 1 {
                    flowButton(
                        isPurchasing ? "Purchasing..." : "Buy 1 Gift Token",
                        disabled: isSubmitting || isPurchasing
                    ) {
                        Task { await purchaseGiftToken() }
                    }
                }

                flowButton(
                    isSubmitting ? "Sending..." : "Send Gift",
                    disabled: !canSendGift || isSubmitting
                ) {
                    Task { await submitGift() }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private var successStep: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundColor(DesignTokens.statusSuccess)

            Text("Gift is ready")
                .font(DesignTokens.displayFont(size: 24, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            if let gift = createdGift {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Share PIN: \(gift.claimPin ?? "—")")
                    Text("Delivery: \(gift.deliveryMode.capitalized)")
                    Text("Status: \(gift.status.capitalized)")
                }
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundColor(DesignTokens.textPrimary)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DesignTokens.cardBackground)
                .cornerRadius(12)
                .padding(.horizontal, 20)
            }

            flowButton("Done", disabled: false) {
                onComplete()
                dismiss()
            }
            .padding(.horizontal, 20)

            Spacer()
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gift Item")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)
            Text(selectedContentTitle ?? "—")
                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            if contentType == .song {
                Text("Lyrics retries used: \(songRetryCount)/3")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
            }

            Divider().background(DesignTokens.border)

            Text("Channels: \(selectedChannels.map { $0.uppercased() }.joined(separator: ", "))")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textPrimary)
            if sendViaSMS {
                Text("Phone: \(normalizedPhone ?? recipientPhone)")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            if sendViaEmail {
                Text("Email: \(recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines))")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            Text("Delivery: \(deliverySummary)")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textPrimary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
    }

    private var walletCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gift Token Wallet")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)
            Text("\(walletBalance) token\(walletBalance == 1 ? "" : "s") available")
                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                .foregroundColor(walletBalance > 0 ? DesignTokens.statusSuccess : DesignTokens.warning)

            if let latest = walletTransactions.first {
                Text("Latest activity: \(latest.type.replacingOccurrences(of: "_", with: " ").capitalized)")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .cornerRadius(12)
    }

    private func createActionButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                Text(title)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundColor(DesignTokens.background)
            .padding(.vertical, 14)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.gold.opacity(0.85)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }

    private func channelToggle(title: String, subtitle: String, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text(subtitle)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundColor(DesignTokens.textSecondary)
                }
                Spacer()
                Image(systemName: isOn.wrappedValue ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isOn.wrappedValue ? DesignTokens.gold : DesignTokens.textTertiary)
                    .font(.system(size: 20))
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
            .foregroundColor(DesignTokens.textPrimary)
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label)
            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            .foregroundColor(DesignTokens.textSecondary)
    }

    private func flowButton(_ title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(disabled ? DesignTokens.textSecondary : DesignTokens.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background {
                    if disabled {
                        DesignTokens.surfaceMuted
                    } else {
                        LinearGradient(
                            colors: [DesignTokens.gold, DesignTokens.gold.opacity(0.85)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                }
                .cornerRadius(14)
        }
        .disabled(disabled)
        .buttonStyle(.plain)
    }

    private func goBack() {
        guard let previous = Step(rawValue: max(step.rawValue - 1, 0)) else { return }
        step = previous
    }

    private func openCreateFlow(type: CreateFlowView.CreationType) {
        createLaunch = GiftCreateLaunch(type: type)
    }

    @MainActor
    private func applyCreatedSong(trackId: String, versionNum: Int) async {
        contentType = .song
        selectedTrackId = trackId
        selectedTrackVersionNum = versionNum
        selectedPoem = nil
        selectedTrackTitle = "Your Song"

        do {
            let response = try await apiClient.getTrack(trackId: trackId)
            selectedTrackTitle = response.track.title
        } catch {
            // Keep the fallback title when track fetch fails.
        }

        step = .recipient
    }

    @MainActor
    private func applyCreatedPoem(_ poem: Poem) {
        contentType = .poem
        selectedPoem = poem
        selectedTrackId = nil
        selectedTrackVersionNum = nil
        selectedTrackTitle = nil
        step = .recipient
    }

    private var selectedContentId: String? {
        switch contentType {
        case .song:
            return selectedTrackId
        case .poem:
            return selectedPoem?.id
        }
    }

    private var selectedContentTitle: String? {
        switch contentType {
        case .song:
            return selectedTrackTitle
        case .poem:
            return selectedPoem?.title
        }
    }

    private var selectedChannels: [String] {
        var channels: [String] = []
        if sendViaSMS { channels.append(GiftDeliveryChannel.sms.rawValue) }
        if sendViaEmail { channels.append(GiftDeliveryChannel.email.rawValue) }
        return channels
    }

    private var normalizedPhone: String? {
        let raw = recipientPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return nil }
        let digits = raw.filter(\.isNumber)
        if raw.hasPrefix("+"), (10...15).contains(digits.count) {
            return "+\(digits)"
        }
        if digits.count == 10 {
            return "+1\(digits)"
        }
        if digits.count == 11, digits.first == "1" {
            return "+\(digits)"
        }
        return nil
    }

    private var normalizedEmail: String? {
        let raw = recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if raw.isEmpty { return nil }
        let emailPredicate = NSPredicate(format: "SELF MATCHES[c] %@", "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$")
        return emailPredicate.evaluate(with: raw) ? raw : nil
    }

    private var isRecipientStepValid: Bool {
        guard !selectedChannels.isEmpty else { return false }
        if sendViaSMS, normalizedPhone == nil { return false }
        if sendViaEmail, normalizedEmail == nil { return false }
        return true
    }

    private var isDeliveryStepValid: Bool {
        if deliveryMode == .immediate { return true }
        return scheduledAt > Date().addingTimeInterval(60)
    }

    private var canSendGift: Bool {
        selectedContentId != nil && isRecipientStepValid && isDeliveryStepValid && walletBalance > 0
    }

    private var deliverySummary: String {
        switch deliveryMode {
        case .immediate:
            return "Send immediately"
        case .scheduled:
            return DateFormatter.localizedString(from: scheduledAt, dateStyle: .medium, timeStyle: .short)
        }
    }

    private func bootstrap() async {
        isBootstrapping = true
        defer { isBootstrapping = false }

        do {
            let walletData = try await apiClient.getGiftWallet(limit: 10)
            walletBalance = walletData.balance
            walletTransactions = walletData.transactions
        } catch {
            errorMessage = mapError(error)
        }
    }

    @MainActor
    private func purchaseGiftToken() async {
        isPurchasing = true
        defer { isPurchasing = false }

        var product = storeKit.giftTokenProduct
        if product == nil {
            product = await storeKit.fetchProduct(identifier: ProductID.giftTokenOneOff.rawValue)
        }

        guard let product else {
            errorMessage = "Gift token product is not available right now."
            return
        }

        let purchased = await storeKit.purchase(product)
        guard purchased else {
            switch storeKit.purchaseState {
            case .failed(let error):
                errorMessage = error
            case .cancelled:
                break
            default:
                errorMessage = "Gift token purchase failed."
            }
            return
        }

        do {
            if case .success(let txId) = storeKit.purchaseState {
                _ = try await apiClient.syncAppleGiftConsumable(transactionId: String(txId))
            }
            let wallet = try await apiClient.getGiftWallet(limit: 10)
            walletBalance = wallet.balance
            walletTransactions = wallet.transactions
            storeKit.resetPurchaseState()
        } catch {
            errorMessage = mapError(error)
        }
    }

    private func submitGift() async {
        guard let contentId = selectedContentId else {
            errorMessage = "Create a song or poem first."
            return
        }
        guard isRecipientStepValid else {
            errorMessage = "Recipient details are incomplete."
            return
        }
        guard walletBalance > 0 else {
            errorMessage = "You need at least 1 gift token."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let sendAtISO: String? = deliveryMode == .scheduled
            ? ISO8601DateFormatter().string(from: scheduledAt)
            : nil

        let request = CreateGiftRequest(
            contentType: contentType.rawValue,
            contentId: contentId,
            deliveryMode: deliveryMode.rawValue,
            senderTimezone: TimeZone.current.identifier,
            channels: selectedChannels,
            recipientPhone: sendViaSMS ? normalizedPhone : nil,
            recipientEmail: sendViaEmail ? normalizedEmail : nil,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : message.trimmingCharacters(in: .whitespacesAndNewlines),
            sendAt: sendAtISO,
            expiresInDays: 30,
            versionNum: contentType == .song ? selectedTrackVersionNum : nil
        )

        do {
            let idempotency = "gift_ios_\(UUID().uuidString.lowercased())"
            let response = try await apiClient.createGift(request: request, idempotencyKey: idempotency)
            createdGift = response.gift
            walletBalance = response.walletBalance
            step = .success
        } catch {
            errorMessage = mapError(error)
        }
    }

    private func mapError(_ error: Error) -> String {
        if let apiError = error as? APIClientError {
            switch apiError {
            case .serverError(let message):
                return message
            case .httpError(_, let body):
                return body
            default:
                return apiError.localizedDescription
            }
        }
        return error.localizedDescription
    }

    private struct GiftCreateLaunch: Identifiable {
        let id = UUID()
        let type: CreateFlowView.CreationType
    }
}
