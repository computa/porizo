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
    var storeKit: StoreKitManager
    let onComplete: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(StyleStore.self) private var styleStore
    @Environment(STTRouter.self) private var sttRouter

    @State private var step: Step = .content
    @State private var contentType: GiftContentType = .song
    @State private var selectedTrackId: String?
    @State private var selectedTrackVersionNum: Int?
    @State private var selectedTrackTitle: String?
    @State private var selectedPoem: Poem?

    @State private var createLaunch: GiftCreateLaunch?
    @State private var sendViaSMS = true
    @State private var sendViaEmail = false
    @State private var recipientPhone = ""
    @State private var recipientEmail = ""
    @State private var message = ""

    @State private var deliveryMode: GiftDeliveryMode = .immediate
    @State private var scheduledAt = Date.now.addingTimeInterval(60 * 60)

    @State private var reservation: GiftReservation?
    @State private var reservationFinalized = false

    @State private var walletBalance = 0
    @State private var walletTransactions: [GiftWalletTransaction] = []
    @State private var createdGift: GiftOrder?

    @State private var isBootstrapping = true
    @State private var isSubmitting = false
    @State private var isPurchasing = false
    @State private var isReserving = false
    @State private var errorMessage: String?

    @State private var showBundlePicker = false
    @State private var bundlePickerState: BundlePickerState = .selecting
    @State private var pendingCreateType: CreateFlowKind?
    @State private var isCreatingContent = false
    @State private var showCloseConfirmation = false
    @Environment(\.scenePhase) private var scenePhase

    enum BundlePickerState: Equatable {
        case selecting
        case purchasing
        case success
        case failed(String)
        case cancelled
    }

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
                        .foregroundStyle(DesignTokens.textSecondary)
                    Spacer()
                } else {
                    content
                }
            }
        }
        .task {
            guard AppConfig.enableGiftPurchaseUI else {
                errorMessage = "Gift purchases are currently unavailable."
                return
            }
            await storeKit.syncPendingGiftTransactions()
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
        .alert("Discard gift?", isPresented: $showCloseConfirmation) {
            Button("Discard", role: .destructive) {
                Task { await closeFlow() }
            }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("Your song has been created. Closing will cancel the reservation and return your token.")
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task {
                    await storeKit.syncPendingGiftTransactions()
                    let wallet = try? await apiClient.getGiftWallet(limit: 10)
                    if let wallet {
                        walletBalance = wallet.balance
                        walletTransactions = wallet.transactions
                    }
                    // Refresh reservation status — may have expired while backgrounded
                    if reservation != nil {
                        let active = try? await apiClient.getActiveGiftReservation()
                        if active?.reservation == nil {
                            reservation = nil
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showBundlePicker) {
            bundlePickerSheet
        }
        .fullScreenCover(item: $createLaunch, onDismiss: { isCreatingContent = false }) { launch in
            if launch.type == .poem && !AppConfig.useWarmCanvasForPoems {
                UnifiedCreateFlowView(
                    apiClient: apiClient,
                    storeKit: storeKit,
                    preselectedType: .poem,
                    onPoemComplete: { @MainActor poem in
                        createLaunch = nil
                        Task { @MainActor in
                            await applyCreatedPoem(poem)
                        }
                    },
                    onComplete: { @MainActor _, _ in createLaunch = nil },
                    onCancel: { @MainActor in createLaunch = nil }
                )
                .environment(styleStore)
                .environment(sttRouter)
            } else {
                WarmCanvasFlowView(
                    apiClient: apiClient,
                    storeKit: storeKit,
                    preselectedType: launch.type,
                    alwaysShowVoiceSelection: true,
                    isGiftContext: true,
                    onPoemComplete: { @MainActor poem in
                        createLaunch = nil
                        Task { @MainActor in
                            await applyCreatedPoem(poem)
                        }
                    },
                    onComplete: { @MainActor trackId, versionNum in
                        createLaunch = nil
                        Task { @MainActor in
                            await applyCreatedSong(trackId: trackId, versionNum: versionNum)
                        }
                    },
                    onCancel: { @MainActor in
                        createLaunch = nil
                    }
                )
                .environment(styleStore)
                .environment(sttRouter)
            }
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
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 40, height: 40)
                        .background(DesignTokens.cardBackground)
                        .clipShape(Circle())
                }
                .accessibilityLabel("Back")
            } else {
                Color.clear.frame(width: 40, height: 40)
            }

            Spacer()

            Text(step.title)
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Button {
                if hasAttachedReservationContent && step != .content && step != .success {
                    showCloseConfirmation = true
                } else {
                    Task { await closeFlow() }
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 40, height: 40)
                    .background(DesignTokens.cardBackground)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close")
            .disabled(isSubmitting || isReserving)
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

                    Text("Pick a gift type below. If you need tokens, you'll be prompted to buy a bundle.")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)

                    reservationStatusCard

                    if let selectedContentTitle {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Ready to send")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)

                            Text(selectedContentTitle)
                                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                                .foregroundStyle(DesignTokens.textPrimary)

                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 12))
                    }

                    VStack(spacing: 10) {
                        createActionButton(
                            title: isReserving ? "Reserving Token..." : "Create Song Gift",
                            icon: "music.note",
                            disabled: isReserving || isPurchasing || isSubmitting || isCreatingContent,
                            action: { startCreateFlow(type: .song) }
                        )

                        createActionButton(
                            title: isReserving ? "Reserving Token..." : "Create Poem Gift",
                            icon: "text.book.closed",
                            disabled: isReserving || isPurchasing || isSubmitting || isCreatingContent,
                            action: { startCreateFlow(type: .poem) }
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }

            flowButton("Continue", disabled: !hasAttachedReservationContent || isSubmitting || isReserving) {
                step = .recipient
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private var reservationStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if hasActiveReservation {
                Text("1 token reserved for this gift")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.statusSuccess)
                if let expiresAt = reservation?.expiresAt {
                    Text("Reservation expires: \(expiresAt)")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else {
                Text("No active reservation")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.warning)
                Text("Reserve a token before creating gift content.")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Text("Wallet: \(walletBalance) token\(walletBalance == 1 ? "" : "s")")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
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
                            .clipShape(.rect(cornerRadius: 10))
                            .foregroundStyle(DesignTokens.textPrimary)
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
                            .clipShape(.rect(cornerRadius: 10))
                            .foregroundStyle(DesignTokens.textPrimary)
                    }

                    fieldLabel("Your message (optional)")
                    TextEditor(text: $message)
                        .frame(minHeight: 120)
                        .padding(8)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 10))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .overlay(alignment: .topLeading) {
                            if message.isEmpty {
                                Text("Add a short note for them...")
                                    .font(DesignTokens.bodyFont(size: 14))
                                    .foregroundStyle(DesignTokens.textSecondary)
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
                            in: Date.now.addingTimeInterval(60)...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .datePickerStyle(.graphical)
                        .tint(DesignTokens.gold)
                        .padding(12)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Timezone")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                        Text(TimeZone.current.identifier)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DesignTokens.cardBackground)
                    .clipShape(.rect(cornerRadius: 10))
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

            flowButton(
                isSubmitting ? "Sending..." : "Send Gift",
                disabled: !canSendGift || isSubmitting
            ) {
                Task { await submitGift() }
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
                .foregroundStyle(DesignTokens.statusSuccess)

            Text("Gift is ready")
                .font(DesignTokens.displayFont(size: 24, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            if let gift = createdGift {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Share PIN: \(gift.claimPin ?? "—")")
                    Text("Delivery: \(gift.deliveryMode.capitalized)")
                    Text("Status: \(gift.status.capitalized)")
                }
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textPrimary)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DesignTokens.cardBackground)
                .clipShape(.rect(cornerRadius: 12))
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
                .foregroundStyle(DesignTokens.textSecondary)
            Text(selectedContentTitle ?? "—")
                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Divider().background(DesignTokens.border)

            Text("Channels: \(selectedChannels.map { $0.uppercased() }.joined(separator: ", "))")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textPrimary)
            if sendViaSMS {
                Text("Phone: \(normalizedPhone ?? recipientPhone)")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            if sendViaEmail {
                Text("Email: \(recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines))")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            Text("Delivery: \(deliverySummary)")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textPrimary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var walletCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gift Token Wallet")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
            Text("\(walletBalance) token\(walletBalance == 1 ? "" : "s") available")
                .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                .foregroundStyle(walletBalance > 0 ? DesignTokens.statusSuccess : DesignTokens.warning)

            if let latest = walletTransactions.first {
                Text("Latest activity: \(latest.type.replacingOccurrences(of: "_", with: " ").capitalized)")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private func createActionButton(title: String, icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
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
            .foregroundStyle(disabled ? DesignTokens.textSecondary : DesignTokens.background)
            .padding(.vertical, 14)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .background(
                Group {
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
            )
            .clipShape(.rect(cornerRadius: 12))
        }
        .disabled(disabled)
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
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text(subtitle)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                Spacer()
                Image(systemName: isOn.wrappedValue ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isOn.wrappedValue ? DesignTokens.gold : DesignTokens.textTertiary)
                    .font(.system(size: 20))
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .clipShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
            .foregroundStyle(DesignTokens.textPrimary)
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(label)
            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            .foregroundStyle(DesignTokens.textSecondary)
    }

    private func flowButton(_ title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(disabled ? DesignTokens.textSecondary : DesignTokens.background)
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
                .clipShape(.rect(cornerRadius: 14))
        }
        .disabled(disabled)
        .buttonStyle(.plain)
    }

    private func goBack() {
        guard let previous = Step(rawValue: max(step.rawValue - 1, 0)) else { return }
        step = previous
    }

    private func openCreateFlow(type: CreateFlowKind) {
        CreateFlowStore.shared.clear()
        isCreatingContent = true
        createLaunch = GiftCreateLaunch(type: type)
    }

    private func startCreateFlow(type: CreateFlowKind) {
        Task {
            // If wallet empty and no reservation, show bundle picker
            if !hasActiveReservation && walletBalance < 1 && AppConfig.enableGiftPurchaseUI {
                pendingCreateType = type
                bundlePickerState = .selecting
                showBundlePicker = true
                return
            }
            let ready = await ensureReservationForCreation()
            if ready {
                openCreateFlow(type: type)
            }
        }
    }

    @MainActor
    private func closeFlow() async {
        await cancelReservationIfNeeded()
        onCancel()
        dismiss()
    }

    @MainActor
    private func ensureReservationForCreation() async -> Bool {
        if hasActiveReservation {
            return true
        }

        if walletBalance < 1 {
            errorMessage = "You need at least 1 gift token."
            return false
        }

        isReserving = true
        defer { isReserving = false }

        do {
            let idempotency = "gift_reserve_ios_\(UUID().uuidString.lowercased())"
            let response = try await apiClient.createGiftReservation(idempotencyKey: idempotency)
            guard let reservation = response.reservation else {
                errorMessage = "Failed to reserve gift token."
                return false
            }
            self.reservation = reservation
            self.walletBalance = response.walletBalance
            return true
        } catch {
            errorMessage = mapError(error)
            return false
        }
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
            // Keep fallback title if fetch fails.
        }

        guard hasActiveReservation else {
            errorMessage = "Your reservation has expired. Please reserve a new token."
            reservation = nil
            step = .content
            return
        }

        guard let reservationId = reservation?.id else {
            errorMessage = "Gift reservation was lost. Please reserve again."
            step = .content
            return
        }

        do {
            let response = try await apiClient.attachGiftReservationContent(
                reservationId: reservationId,
                contentType: GiftContentType.song.rawValue,
                contentId: trackId,
                versionNum: versionNum
            )
            reservation = response.reservation
            walletBalance = response.walletBalance
            step = .recipient
        } catch {
            errorMessage = mapError(error)
            step = .content
        }
    }

    @MainActor
    private func applyCreatedPoem(_ poem: Poem) async {
        contentType = .poem
        selectedPoem = poem
        selectedTrackId = nil
        selectedTrackVersionNum = nil
        selectedTrackTitle = nil

        guard hasActiveReservation else {
            errorMessage = "Your reservation has expired. Please reserve a new token."
            reservation = nil
            step = .content
            return
        }

        guard let reservationId = reservation?.id else {
            errorMessage = "Gift reservation was lost. Please reserve again."
            step = .content
            return
        }

        do {
            let response = try await apiClient.attachGiftReservationContent(
                reservationId: reservationId,
                contentType: GiftContentType.poem.rawValue,
                contentId: poem.id,
                versionNum: nil
            )
            reservation = response.reservation
            walletBalance = response.walletBalance
            step = .recipient
        } catch {
            errorMessage = mapError(error)
            step = .content
        }
    }

    private var selectedContentId: String? {
        switch contentType {
        case .song:
            return selectedTrackId ?? (reservation?.contentType == GiftContentType.song.rawValue ? reservation?.contentId : nil)
        case .poem:
            return selectedPoem?.id ?? (reservation?.contentType == GiftContentType.poem.rawValue ? reservation?.contentId : nil)
        }
    }

    private var selectedContentTitle: String? {
        switch contentType {
        case .song:
            return selectedTrackTitle ?? (reservation?.contentType == GiftContentType.song.rawValue ? "Selected Song" : nil)
        case .poem:
            return selectedPoem?.title ?? (reservation?.contentType == GiftContentType.poem.rawValue ? "Selected Poem" : nil)
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
        return scheduledAt > Date.now.addingTimeInterval(60)
    }

    private var hasActiveReservation: Bool {
        guard let status = reservation?.status.lowercased() else { return false }
        return status == "reserved" || status == "content_ready"
    }

    private var hasAttachedReservationContent: Bool {
        guard let reservation else { return false }
        return reservation.status.lowercased() == "content_ready"
            && reservation.contentId != nil
            && reservation.contentType != nil
    }

    private var canSendGift: Bool {
        selectedContentId != nil && hasAttachedReservationContent && isRecipientStepValid && isDeliveryStepValid
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
            async let walletTask = apiClient.getGiftWallet(limit: 10)
            async let reservationTask = apiClient.getActiveGiftReservation()

            let walletData = try await walletTask
            let reservationData = try await reservationTask

            walletBalance = walletData.balance
            walletTransactions = walletData.transactions
            reservation = reservationData.reservation

            if let reservation {
                await hydrateSelectionFromReservation(reservation)
            }
        } catch {
            errorMessage = mapError(error)
        }
    }

    @MainActor
    private func hydrateSelectionFromReservation(_ reservation: GiftReservation) async {
        guard let contentTypeRaw = reservation.contentType,
              let contentId = reservation.contentId else {
            return
        }

        if contentTypeRaw == GiftContentType.song.rawValue {
            contentType = .song
            selectedTrackId = contentId
            selectedTrackVersionNum = reservation.versionNum
            selectedTrackTitle = "Selected Song"
            do {
                let response = try await apiClient.getTrack(trackId: contentId)
                selectedTrackTitle = response.track.title
            } catch {
                // Keep fallback title when fetch fails.
            }
            return
        }

        if contentTypeRaw == GiftContentType.poem.rawValue {
            contentType = .poem
            do {
                let response = try await apiClient.getPoem(poemId: contentId)
                selectedPoem = response.poem
            } catch {
                selectedPoem = nil
            }
        }
    }

    @MainActor
    private func cancelReservationIfNeeded() async {
        guard !reservationFinalized,
              let reservation,
              hasActiveReservation else {
            return
        }

        do {
            let response = try await apiClient.cancelGiftReservation(reservationId: reservation.id)
            self.reservation = response.reservation
            self.walletBalance = response.walletBalance
        } catch {
            // Best effort cancel on dismissal.
        }
    }

    private func submitGift() async {
        guard let reservationId = reservation?.id else {
            errorMessage = "Reserve a gift token first."
            return
        }
        guard hasAttachedReservationContent else {
            errorMessage = "Create a song or poem first."
            return
        }
        guard isRecipientStepValid else {
            errorMessage = "Recipient details are incomplete."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let sendAtISO: String? = deliveryMode == .scheduled
            ? scheduledAt.formatted(.iso8601)
            : nil

        let request = FinalizeGiftReservationRequest(
            deliveryMode: deliveryMode.rawValue,
            senderTimezone: TimeZone.current.identifier,
            channels: selectedChannels,
            recipientPhone: sendViaSMS ? normalizedPhone : nil,
            recipientEmail: sendViaEmail ? normalizedEmail : nil,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : message.trimmingCharacters(in: .whitespacesAndNewlines),
            sendAt: sendAtISO,
            expiresInDays: 30
        )

        do {
            let idempotency = "gift_finalize_ios_\(UUID().uuidString.lowercased())"
            let response = try await apiClient.finalizeGiftReservation(
                reservationId: reservationId,
                request: request,
                idempotencyKey: idempotency
            )
            createdGift = response.gift
            walletBalance = response.walletBalance
            reservationFinalized = true
            step = .success
        } catch {
            errorMessage = mapError(error)
        }
    }

    // MARK: - Bundle Picker Sheet

    private var bundlePickerSheet: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Get Gift Tokens")
                            .font(DesignTokens.displayFont(size: 22))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text("Purchase tokens to create and send personalized gifts.")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)

                        if storeKit.giftBundleProducts.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 32))
                                    .foregroundStyle(DesignTokens.warning)
                                Text("Gift bundles are not available right now.")
                                    .font(DesignTokens.bodyFont(size: 15))
                                    .foregroundStyle(DesignTokens.textSecondary)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 32)
                        } else {
                            ForEach(storeKit.giftBundleProducts, id: \.id) { product in
                                bundleCard(for: product)
                            }
                        }

                        if case .failed(let msg) = bundlePickerState {
                            Text(msg)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.error)
                                .padding(.top, 4)
                        }

                        if !storeKit.subscriptionState.hasActiveSubscription {
                            subscriptionNudge
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        bundlePickerState = .cancelled
                        showBundlePicker = false
                    }
                    .disabled(bundlePickerState == .purchasing)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear {
            if storeKit.giftBundleProducts.isEmpty {
                print("[GiftFlow] Bundle picker shown but giftBundleProducts is empty — check StoreKit config")
            }
        }
    }

    private func bundleCard(for product: Product) -> some View {
        let config = AppConfig.giftBundles.first { $0.productId == product.id }
        let isBestValue = product.id == ProductID.giftBundle3.rawValue

        return Button {
            Task { await purchaseBundle(product) }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(config?.displayName ?? product.displayName)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)

                        if isBestValue {
                            Text("BEST VALUE")
                                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                .foregroundStyle(DesignTokens.background)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(DesignTokens.gold)
                                .clipShape(.rect(cornerRadius: 4))
                        }
                    }

                    Text(product.description)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()

                Text(product.displayPrice)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }
            .padding(14)
            .background(DesignTokens.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isBestValue ? DesignTokens.gold : DesignTokens.border, lineWidth: isBestValue ? 1.5 : 0.5)
            )
            .clipShape(.rect(cornerRadius: 12))
        }
        .disabled(bundlePickerState == .purchasing)
        .buttonStyle(.plain)
    }

    private var subscriptionNudge: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "crown.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(DesignTokens.gold)
                Text("Subscribers unlock additional creation perks")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            Text("Gift tokens are purchased separately. Upgrade for higher song and poem limits.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surfaceMuted)
        .clipShape(.rect(cornerRadius: 12))
    }

    @MainActor
    private func purchaseBundle(_ product: Product) async {
        bundlePickerState = .purchasing

        let purchased = await storeKit.purchase(product)
        guard purchased else {
            switch storeKit.purchaseState {
            case .syncFailed:
                bundlePickerState = .failed("Payment received but tokens could not be loaded. They will appear when you reopen the app.")
            case .failed(let error):
                bundlePickerState = .failed(error)
            case .cancelled:
                bundlePickerState = .selecting
            default:
                bundlePickerState = .failed("Purchase failed.")
            }
            return
        }

        // StoreKitManager already syncs the transaction with backend.
        // Refresh wallet state after successful purchase.
        do {
            let wallet = try await apiClient.getGiftWallet(limit: 10)
            walletBalance = wallet.balance
            walletTransactions = wallet.transactions
            storeKit.resetPurchaseState()
            bundlePickerState = .success
        } catch {
            print("[GiftFlow] Wallet sync failed after purchase: \(error)")
            bundlePickerState = .failed("Payment received. Tokens will appear shortly — please reopen the app.")
            return
        }

        // Only dismiss + continue when wallet sync actually succeeded.
        guard case .success = bundlePickerState else {
            return
        }

        // Brief success animation then auto-dismiss and proceed
        try? await Task.sleep(for: .milliseconds(1500))
        showBundlePicker = false

        if let type = pendingCreateType {
            pendingCreateType = nil
            let ready = await ensureReservationForCreation()
            if ready {
                openCreateFlow(type: type)
            }
        }
    }

    private func mapError(_ error: Error) -> String {
        if let apiError = error as? APIClientError {
            switch apiError {
            case .serverError(let message, _, _):
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
        let type: CreateFlowKind
    }
}
