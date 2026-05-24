//
//  GiftSendFlowView.swift
//  PorizoApp
//
//  Sender flow for one-off token purchase + immediate/scheduled gift delivery.
//

import SwiftUI
import StoreKit
import Contacts

struct GiftSendFlowView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    let onComplete: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(StyleStore.self) private var styleStore
    @Environment(STTRouter.self) private var sttRouter
    @Environment(AuthManager.self) private var authManager

    @State private var screen: Screen = .content
    @State private var contentType: GiftContentType = .song
    @State private var selectedTrackId: String?
    @State private var selectedTrackTitle: String?
    @State private var selectedPoem: Poem?

    @State private var createLaunch: GiftCreateLaunch?
    @State private var recipientName = ""
    @State private var senderDisplayName = ""
    @State private var sendViaText = true
    @State private var sendViaEmail = false
    @State private var recipientPhone = ""
    @State private var recipientEmail = ""
    @State private var message = ""
    @State private var selectedCountry: Country = .default

    @State private var deliveryMode: GiftDeliveryMode = .immediate
    @State private var scheduledAt = Date.now.addingTimeInterval(60 * 60)

    @State private var reservation: GiftReservation?
    @State private var reservationFinalized = false
    @State private var composerResumePolicy: ComposerResumePolicy = .automatic

    @State private var walletBalance = 0
    @State private var scheduledGifts: [GiftOrder] = []
    @State private var createdGift: GiftOrder?

    @State private var isSubmitting = false
    @State private var isReserving = false
    @State private var errorMessage: String?

    @State private var showBundlePicker = false
    @State private var bundlePickerState: BundlePickerState = .selecting
    @State private var pendingCreateType: CreateFlowKind?
    @State private var isCreatingContent = false
    @State private var showCloseConfirmation = false
    @State private var showCountryPicker = false
    @State private var showSchedulePicker = false
    @State private var showScheduledGiftList = false
    @State private var managingGift: GiftOrder?
    @State private var contactPickerRequest: GiftContactPickerRequest?
    @Environment(\.scenePhase) private var scenePhase

    enum BundlePickerState: Equatable {
        case selecting
        case purchasing
        case success
        case failed(String)
        case cancelled
    }

    enum Screen {
        case content
        case composer
        case success

        var title: String {
            switch self {
            case .content: return "Create Gift"
            case .composer: return "Address Your Gift"
            case .success: return ""
            }
        }
    }

    enum ComposerResumePolicy {
        case automatic
        case pausedByUser
    }

    enum GiftDestinationMethod: String, CaseIterable {
        case text
        case email

        var title: String {
            switch self {
            case .text: return "Text"
            case .email: return "Email"
            }
        }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                content
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
        .confirmationDialog("Leave gift flow?", isPresented: $showCloseConfirmation, titleVisibility: .visible) {
            if hasActiveReservation {
                Button("Save & Close") {
                    Task { await closeFlow(shouldDiscardReservation: false) }
                }
                Button("Discard Gift", role: .destructive) {
                    Task { await closeFlow(shouldDiscardReservation: true) }
                }
            }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text(closeConfirmationMessage)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task {
                    await storeKit.syncPendingGiftTransactions()
                    await refreshGiftSurface()
                }
            }
        }
        .sheet(isPresented: $showBundlePicker) {
            bundlePickerSheet
        }
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(
                selectedCountry: $selectedCountry,
                isPresented: $showCountryPicker
            )
        }
        .sheet(item: $contactPickerRequest) { request in
            GiftContactPickerSheet(method: request.method) { selection in
                applyGiftContactSelection(selection)
            }
        }
        .sheet(isPresented: $showSchedulePicker) {
            schedulePickerSheet
        }
        .sheet(isPresented: $showScheduledGiftList) {
            ScheduledGiftListSheet(gifts: scheduledGifts) { gift in
                managingGift = gift
            }
        }
        .sheet(item: $managingGift, onDismiss: {
            Task { await refreshGiftSurface() }
        }) { gift in
            GiftManagementSheet(
                apiClient: apiClient,
                gift: gift,
                onGiftUpdated: { updated in
                    scheduledGifts = upsertScheduledGift(updated, into: scheduledGifts)
                },
                onGiftCancelled: { cancelled, walletBalance in
                    scheduledGifts = upsertScheduledGift(cancelled, into: scheduledGifts)
                    if let walletBalance {
                        self.walletBalance = walletBalance
                    }
                }
            )
        }
        .fullScreenCover(item: $createLaunch, onDismiss: {
            isCreatingContent = false
            Task {
                await refreshGiftSurface()
            }
        }) { launch in
            WarmCanvasFlowView(
                apiClient: apiClient,
                storeKit: storeKit,
                preselectedType: launch.type,
                alwaysShowVoiceSelection: true,
                isGiftContext: true,
                giftReservationId: launch.reservationId,
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

    private var header: some View {
        HStack {
            if screen == .composer {
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

            Text(headerTitle)
                .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

                Button {
                    if hasActiveReservation && screen != .success {
                        showCloseConfirmation = true
                    } else {
                        Task { await closeFlow(shouldDiscardReservation: false) }
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

    private var headerTitle: String {
        switch screen {
        case .success:
            return successTitle
        default:
            return screen.title
        }
    }

    @ViewBuilder
    private var content: some View {
        switch screen {
        case .content:
            contentScreen
        case .composer:
            composerScreen
        case .success:
            successScreen
        }
    }

    private var contentScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                sectionTitle("Create a fresh gift")

                Text("Pick a gift type below. If you need a gift credit, we’ll only ask when you’re ready to keep going.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)

                reservationStatusCard

                if hasAttachedReservationContent {
                    savedDraftCard
                }

                VStack(spacing: 10) {
                    createActionButton(
                        title: primaryCreateButtonTitle(for: .song),
                        icon: "music.note",
                        disabled: isCreateButtonDisabled(for: .song),
                        action: { startCreateFlow(type: .song) }
                    )

                    createActionButton(
                        title: primaryCreateButtonTitle(for: .poem),
                        icon: "text.book.closed",
                        disabled: isCreateButtonDisabled(for: .poem),
                        action: { startCreateFlow(type: .poem) }
                    )
                }

                scheduledGiftsCard
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
    }

    private var reservationStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if hasActiveReservation {
                Text(hasAttachedReservationContent ? "Gift saved and ready to address" : "Gift draft in progress")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.statusSuccess)
                if let expiresAt = reservation?.expiresAt {
                    Text("This draft stays ready until \(expiresAt).")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else {
                Text("Nothing waiting right now")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.warning)
                Text("Start with the song or poem. You’ll only be asked to unlock the gift if you actually need to.")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var savedDraftCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Continue your gift")
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Text(selectedContentTitle ?? "Your gift content is ready. Add who it’s for and when it should arrive.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            Button {
                composerResumePolicy = .automatic
                screen = .composer
            } label: {
                Text("Address this gift")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var scheduledGiftsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Scheduled")
                .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)

            if scheduledGifts.isEmpty {
                Text("Your upcoming gifts will appear here until they are delivered.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            } else {
                VStack(spacing: 10) {
                    ForEach(Array(scheduledGifts.prefix(3))) { gift in
                        Button {
                            managingGift = gift
                        } label: {
                            scheduledGiftRow(gift)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Manage \(gift.displayTitle)")
                    }

                    if scheduledGifts.count > 3 {
                        Button("View all scheduled gifts") {
                            showScheduledGiftList = true
                        }
                        .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(DesignTokens.gold.opacity(0.55), lineWidth: 1)
        )
        .clipShape(.rect(cornerRadius: 12))
    }

    private var composerScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                composerHero
                composerRecipientSection
                composerSenderSection
                composerDestinationSection
                composerNoteSection
                composerTimingSection

                if isComposerReadyForSummary {
                    composerSummaryCard
                }

                flowButton(
                    isSubmitting ? "Sending..." : primaryComposerCTA,
                    disabled: !canSendGift || isSubmitting
                ) {
                    Task { await submitGift() }
                }
                .padding(.top, 4)

                Text("Gift credit is only checked when you finish sending.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
    }

    private var successScreen: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(DesignTokens.statusSuccess)

            Text(successTitle)
                .font(DesignTokens.displayFont(size: 24, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            if let successSubtitle {
                Text(successSubtitle)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            VStack(spacing: 10) {
                if let gift = createdGift, gift.deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue {
                    flowButton("Manage scheduled gift", disabled: false) {
                        managingGift = gift
                    }
                    .padding(.horizontal, 20)
                }

                flowButton("Done", disabled: false) {
                    onComplete()
                    dismiss()
                }
                .padding(.horizontal, 20)
            }

            Spacer()
        }
    }

    private var composerHero: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(contentType == .poem ? "Your poem is ready" : "Your song is ready")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)

            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [DesignTokens.gold.opacity(0.95), DesignTokens.gold.opacity(0.55)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 60, height: 60)

                    Image(systemName: contentType == .poem ? "text.book.closed.fill" : "music.note")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(DesignTokens.background)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedContentTitle ?? "Your gift")
                        .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text(contentType == .poem ? "A note made unforgettable." : "Now wrap it with who it’s for and when it should arrive.")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var composerRecipientSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Who is this for?")

            TextField("Their name", text: $recipientName)
                .textContentType(.name)
                .autocorrectionDisabled(true)
                .padding(.horizontal, 4)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(DesignTokens.border)
                        .frame(height: 1)
                }
                .font(DesignTokens.displayFont(size: 24, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
        }
    }

    private var composerDestinationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            fieldLabel("How should it reach them?")

            HStack(spacing: 8) {
                deliveryMethodToggle(title: "Text", isOn: $sendViaText)
                deliveryMethodToggle(title: "Email", isOn: $sendViaEmail)
            }
            .padding(4)
            .background(DesignTokens.surfaceMuted)
            .clipShape(.rect(cornerRadius: 12))

            if sendViaText {
                HStack(spacing: 8) {
                    Button {
                        showCountryPicker = true
                    } label: {
                        Text("\(selectedCountry.flag) \(selectedCountry.dialCode)")
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 14)
                            .background(DesignTokens.cardBackground)
                            .clipShape(.rect(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)

                    TextField(selectedCountry.phonePlaceholder, text: $recipientPhone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .autocorrectionDisabled(true)
                        .textInputAutocapitalization(.never)
                        .padding(12)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 10))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .onChange(of: recipientPhone) { _, newValue in
                            let resolved = resolvedPhoneInputState(newValue, currentCountry: selectedCountry)
                            if selectedCountry != resolved.country {
                                selectedCountry = resolved.country
                            }
                            if recipientPhone != resolved.formatted {
                                recipientPhone = resolved.formatted
                            }
                        }

                    contactPickerButton(for: .text)
                }
            }

            if sendViaEmail {
                HStack(spacing: 8) {
                    TextField("name@example.com", text: $recipientEmail)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled(true)
                        .textInputAutocapitalization(.never)
                        .padding(12)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 10))
                        .foregroundStyle(DesignTokens.textPrimary)

                    contactPickerButton(for: .email)
                }
            }

            Text(destinationMethodHint)
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }

    @ViewBuilder
    private var composerSenderSection: some View {
        if shouldPromptForSenderDisplayName {
            VStack(alignment: .leading, spacing: 8) {
                fieldLabel("How should your name appear?")

                TextField("Your name", text: $senderDisplayName)
                    .textContentType(.name)
                    .autocorrectionDisabled(true)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(DesignTokens.border)
                            .frame(height: 1)
                    }
                    .font(DesignTokens.bodyFont(size: 20, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("This appears in the gift message so it feels personal, not anonymous.")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    private var composerNoteSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Your note")

            TextEditor(text: $message)
                .frame(minHeight: 84, maxHeight: 104)
                .padding(8)
                .background(DesignTokens.cardBackground)
                .clipShape(.rect(cornerRadius: 10))
                .foregroundStyle(DesignTokens.textPrimary)
                .overlay(alignment: .topLeading) {
                    if message.isEmpty {
                        Text("Add a note if you want.")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .padding(.top, 16)
                            .padding(.leading, 14)
                    }
                }
        }
    }

    private var composerTimingSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            fieldLabel("When should it arrive?")

            HStack(spacing: 8) {
                timingButton(title: "Send now", mode: .immediate)
                timingButton(title: "Schedule", mode: .scheduled)
            }
            .padding(4)
            .background(DesignTokens.surfaceMuted)
            .clipShape(.rect(cornerRadius: 12))

            if deliveryMode == .scheduled {
                Button {
                    showSchedulePicker = true
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(scheduleHeadline)
                                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text(DateFormatter.localizedString(from: scheduledAt, dateStyle: .medium, timeStyle: .short))
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(14)
                    .background(DesignTokens.cardBackground)
                    .clipShape(.rect(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var composerSummaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Delivery Summary")
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
            Text(deliverySummarySentence)
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var schedulePickerSheet: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 18) {
                    DatePicker(
                        "Send date",
                        selection: $scheduledAt,
                        in: minimumScheduledDate()...,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .datePickerStyle(.graphical)
                    .tint(DesignTokens.gold)
                    .padding(12)
                    .background(DesignTokens.cardBackground)
                    .clipShape(.rect(cornerRadius: 12))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("They’ll get it")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                        Text(DateFormatter.localizedString(from: scheduledAt, dateStyle: .full, timeStyle: .short))
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Spacer()
                }
                .padding(20)
            }
            .navigationTitle("Choose the moment")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showSchedulePicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func scheduledGiftRow(_ gift: GiftOrder) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(gift.displayTitle)
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text(gift.recipientSummary)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer(minLength: 8)

                HStack(spacing: 8) {
                    Text(gift.managementStatusLabel)
                        .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                        .foregroundStyle(gift.managementStatusColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(gift.managementStatusColor.opacity(0.14))
                        .clipShape(Capsule())

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
            }

            Text("Delivery: \(gift.sendAtLabel)")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surfaceMuted.opacity(0.55))
        .clipShape(.rect(cornerRadius: 10))
        .contentShape(Rectangle())
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

    private func timingButton(title: String, mode: GiftDeliveryMode) -> some View {
        Button {
            deliveryMode = mode
            if mode == .scheduled, scheduledAt <= minimumScheduledDate() {
                scheduledAt = defaultScheduledDate()
            }
        } label: {
            Text(title)
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(isSelectedDeliveryMode(mode) ? DesignTokens.background : DesignTokens.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(isSelectedDeliveryMode(mode) ? DesignTokens.gold : Color.clear)
                .clipShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func deliveryMethodToggle(title: String, isOn: Binding<Bool>) -> some View {
        Button {
            if isOn.wrappedValue {
                let activeCount = [sendViaText, sendViaEmail].filter { $0 }.count
                if activeCount > 1 {
                    isOn.wrappedValue = false
                }
            } else {
                isOn.wrappedValue = true
            }
        } label: {
            Text(title)
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(isOn.wrappedValue ? DesignTokens.background : DesignTokens.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(isOn.wrappedValue ? DesignTokens.gold : DesignTokens.cardBackground)
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

    private func contactPickerButton(for method: GiftDestinationMethod) -> some View {
        Button {
            presentContactPicker(for: method)
        } label: {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
                .frame(width: 48, height: 48)
                .background(DesignTokens.cardBackground)
                .clipShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(method == .text ? "Choose phone number from contacts" : "Choose email from contacts")
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
        switch screen {
        case .content, .success:
            break
        case .composer:
            composerResumePolicy = .pausedByUser
            screen = .content
        }
    }

    private func openCreateFlow(type: CreateFlowKind) {
        guard let reservationId = reservation?.id else {
            errorMessage = "We couldn’t get this gift ready yet. Please try again."
            return
        }
        CreateFlowStore.shared.clear()
        isCreatingContent = true
        createLaunch = GiftCreateLaunch(type: type, reservationId: reservationId)
    }

    private func startCreateFlow(type: CreateFlowKind) {
        Task {
            if hasAttachedReservationContent {
                await MainActor.run {
                    composerResumePolicy = .automatic
                    screen = .composer
                }
                return
            }
            pendingCreateType = type
            let ready = await ensureReservationForCreation()
            if ready {
                pendingCreateType = nil
                openCreateFlow(type: type)
            }
        }
    }

    @MainActor
    private func presentContactPicker(for method: GiftDestinationMethod) {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .restricted, .denied:
            errorMessage = "Allow Contacts access in Settings to choose a recipient from your address book."
        case .authorized, .limited, .notDetermined:
            contactPickerRequest = GiftContactPickerRequest(method: method)
        @unknown default:
            errorMessage = "Contacts access is unavailable right now."
        }
    }

    @MainActor
    private func applyGiftContactSelection(_ selection: GiftContactSelection) {
        let trimmedName = selection.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty {
            recipientName = trimmedName
        }

        switch selection.method {
        case .text:
            guard let phoneNumber = selection.phoneNumber,
                  let country = normalizedPhoneCountry(phoneNumber),
                  let national = nationalPhoneNumberForInput(phoneNumber, selectedCountry: country)
            else {
                errorMessage = "That contact doesn’t have a phone number we can use yet."
                return
            }
            sendViaText = true
            selectedCountry = country
            recipientPhone = formatPhoneInput(national, selectedCountry: country)
        case .email:
            guard let emailAddress = selection.emailAddress?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !emailAddress.isEmpty
            else {
                errorMessage = "That contact doesn’t have an email address we can use yet."
                return
            }
            sendViaEmail = true
            recipientEmail = emailAddress
        }
    }

    @MainActor
    private func closeFlow(shouldDiscardReservation: Bool) async {
        if shouldDiscardReservation {
            await cancelReservationIfNeeded()
        }
        onCancel()
        dismiss()
    }

    @MainActor
    private func ensureReservationForCreation() async -> Bool {
        if hasActiveReservation {
            return true
        }

        isReserving = true
        defer { isReserving = false }

        do {
            let idempotency = "gift_reserve_ios_\(UUID().uuidString.lowercased())"
            let response = try await apiClient.createGiftReservation(idempotencyKey: idempotency)
            guard let reservation = response.reservation else {
                errorMessage = "We couldn’t get this gift ready yet. Please try again."
                return false
            }
            self.reservation = reservation
            self.walletBalance = response.walletBalance
            return true
        } catch {
            if shouldPromptGiftUnlock(for: error), AppConfig.enableGiftPurchaseUI {
                bundlePickerState = .selecting
                showBundlePicker = true
                return false
            }
            errorMessage = mapError(error)
            return false
        }
    }

    @MainActor
    private func applyCreatedSong(trackId: String, versionNum: Int) async {
        contentType = .song
        selectedTrackId = trackId
        selectedPoem = nil
        selectedTrackTitle = "Your Song"

        do {
            let response = try await apiClient.getTrack(trackId: trackId)
            selectedTrackTitle = response.track.title
            if recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let trackRecipient = response.track.recipientName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !trackRecipient.isEmpty {
                recipientName = trackRecipient
            }
        } catch {
            // Keep fallback title if fetch fails.
        }

        guard hasActiveReservation else {
            errorMessage = "This gift draft expired. Start a fresh gift and we’ll help you finish it."
            reservation = nil
            screen = .content
            return
        }

        guard let reservationId = reservation?.id else {
            errorMessage = "We lost track of this gift draft. Start a fresh one and we’ll keep going."
            screen = .content
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
            composerResumePolicy = .automatic
            screen = .composer
        } catch {
            errorMessage = mapError(error)
            screen = .content
        }
    }

    @MainActor
    private func applyCreatedPoem(_ poem: Poem) async {
        contentType = .poem
        selectedPoem = poem
        selectedTrackId = nil
        selectedTrackTitle = nil
        if recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let poemRecipient = poem.recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !poemRecipient.isEmpty {
                recipientName = poemRecipient
            }
        }

        guard hasActiveReservation else {
            errorMessage = "This gift draft expired. Start a fresh gift and we’ll help you finish it."
            reservation = nil
            screen = .content
            return
        }

        guard let reservationId = reservation?.id else {
            errorMessage = "We lost track of this gift draft. Start a fresh one and we’ll keep going."
            screen = .content
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
            composerResumePolicy = .automatic
            screen = .composer
        } catch {
            errorMessage = mapError(error)
            screen = .content
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
        if sendViaText { channels.append(GiftDeliveryChannel.sms.rawValue) }
        if sendViaEmail { channels.append(GiftDeliveryChannel.email.rawValue) }
        return channels
    }

    private var normalizedPhone: String? {
        sendViaText ? normalizedE164PhoneNumber(recipientPhone, selectedCountry: selectedCountry) : nil
    }

    private var normalizedEmail: String? {
        let raw = recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if raw.isEmpty { return nil }
        let emailPredicate = NSPredicate(format: "SELF MATCHES[c] %@", "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$")
        return emailPredicate.evaluate(with: raw) ? raw : nil
    }

    private var hasValidRecipientAndDestination: Bool {
        guard !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard sendViaText || sendViaEmail else { return false }
        if sendViaText && normalizedPhone == nil { return false }
        if sendViaEmail && normalizedEmail == nil { return false }
        return true
    }

    private var trimmedSenderDisplayName: String {
        senderDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var automaticSenderDisplayName: String? {
        if let displayName = authManager.currentUser?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !displayName.isEmpty {
            return displayName
        }

        guard let email = authManager.currentUser?.email?.trimmingCharacters(in: .whitespacesAndNewlines),
              !email.isEmpty else {
            return nil
        }

        let localPart = email.split(separator: "@").first.map(String.init) ?? ""
        let cleaned = localPart
            .replacingOccurrences(of: ".", with: " ")
            .split(whereSeparator: { $0 == "_" || $0 == "-" || $0.isWhitespace })
            .map { token -> String in
                let lowercased = token.lowercased()
                guard let first = lowercased.first else { return "" }
                return first.uppercased() + lowercased.dropFirst()
            }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    private var shouldPromptForSenderDisplayName: Bool {
        automaticSenderDisplayName == nil
    }

    private var resolvedSenderDisplayName: String? {
        if !trimmedSenderDisplayName.isEmpty {
            return trimmedSenderDisplayName
        }
        return automaticSenderDisplayName
    }

    private var hasValidSenderIdentity: Bool {
        resolvedSenderDisplayName != nil
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
        selectedContentId != nil
            && hasAttachedReservationContent
            && hasValidRecipientAndDestination
            && hasValidSenderIdentity
            && isDeliveryValid
    }

    private var isDeliveryValid: Bool {
        if deliveryMode == .immediate { return true }
        return scheduledAt > minimumScheduledDate()
    }

    private var isComposerReadyForSummary: Bool {
        hasAttachedReservationContent && hasValidRecipientAndDestination && hasValidSenderIdentity && isDeliveryValid
    }

    private var primaryComposerCTA: String {
        deliveryMode == .scheduled ? "Schedule Gift" : "Send Gift"
    }

    private var scheduleHeadline: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(scheduledAt) {
            return "Today"
        }
        if calendar.isDateInTomorrow(scheduledAt) {
            return "Tomorrow"
        }
        return "Choose the moment"
    }

    private var deliverySummarySentence: String {
        let name = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        let medium = deliveryMethodSummary
        let who = name.isEmpty ? "They" : name
        if deliveryMode == .immediate {
            return "\(who) will get this by \(medium) today."
        }
        return "\(who) will get this by \(medium) on \(DateFormatter.localizedString(from: scheduledAt, dateStyle: .medium, timeStyle: .short))."
    }

    private var destinationMethodHint: String {
        if sendViaText && sendViaEmail {
            return "We’ll send this by text and email."
        }
        if sendViaText {
            return recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "We’ll send this by text only."
                : "We’ll send this by text only. Your email stays here if you want to turn it back on."
        }
        if sendViaEmail {
            return recipientPhone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "We’ll send this by email only."
                : "We’ll send this by email only. Your phone stays here if you want to turn it back on."
        }
        return "Choose at least one way to deliver this gift."
    }

    private var deliveryMethodSummary: String {
        switch (sendViaText, sendViaEmail) {
        case (true, true):
            return "text and email"
        case (true, false):
            return "text"
        case (false, true):
            return "email"
        case (false, false):
            return "your chosen method"
        }
    }

    private var trimmedRecipientName: String {
        recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func minimumScheduledDate(reference: Date = .now) -> Date {
        reference.addingTimeInterval(60)
    }

    private func defaultScheduledDate(reference: Date = .now) -> Date {
        reference.addingTimeInterval(60 * 60)
    }

    private func bootstrap() async {
        await refreshGiftSurface()
    }

    private func refreshGiftSurface() async {
        do {
            async let reservationTask = apiClient.getActiveGiftReservation()
            async let giftsTask = apiClient.getGifts(limit: 20)

            let reservationData = try await reservationTask
            let giftsData = try await giftsTask

            reservation = reservationData.reservation
            scheduledGifts = visibleScheduledGifts(from: giftsData.gifts)

            if let reservation {
                await hydrateSelectionFromReservation(reservation)
            } else if screen == .composer && createdGift == nil {
                screen = .content
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
            selectedTrackTitle = "Selected Song"
            do {
                let response = try await apiClient.getTrack(trackId: contentId)
                selectedTrackTitle = response.track.title
                if recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                   let trackRecipient = response.track.recipientName?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !trackRecipient.isEmpty {
                    recipientName = trackRecipient
                }
            } catch {
                // Keep fallback title when fetch fails.
            }
            if hasAttachedReservationContent && createdGift == nil {
                if shouldAutoResumeComposer {
                    screen = .composer
                }
            }
            return
        }

        if contentTypeRaw == GiftContentType.poem.rawValue {
            contentType = .poem
            do {
                let response = try await apiClient.getPoem(poemId: contentId)
                selectedPoem = response.poem
                if recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let poemRecipient = response.poem.recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !poemRecipient.isEmpty {
                        recipientName = poemRecipient
                    }
                }
            } catch {
                selectedPoem = nil
            }
            if hasAttachedReservationContent && createdGift == nil {
                if shouldAutoResumeComposer {
                    screen = .composer
                }
            }
        }
    }

    private var shouldAutoResumeComposer: Bool {
        composerResumePolicy == .automatic
            && !isCreatingContent
            && createLaunch == nil
            && createdGift == nil
            && screen == .content
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
            errorMessage = "Start a fresh gift first."
            return
        }
        guard hasAttachedReservationContent else {
            errorMessage = "Create a song or poem first."
            return
        }
        guard hasValidRecipientAndDestination else {
            errorMessage = "Recipient details are incomplete."
            return
        }
        guard let senderDisplayName = resolvedSenderDisplayName else {
            errorMessage = "Add the name this gift should come from."
            return
        }
        if deliveryMode == .scheduled && !isDeliveryValid {
            scheduledAt = max(scheduledAt, defaultScheduledDate())
            showSchedulePicker = true
            errorMessage = "Choose a delivery time at least a minute from now."
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let sendAtISO: String? = deliveryMode == .scheduled
            ? scheduledAt.formatted(.iso8601)
            : nil

        let request = FinalizeGiftReservationRequest(
            recipientName: trimmedRecipientName.isEmpty ? nil : trimmedRecipientName,
            senderDisplayName: senderDisplayName,
            deliveryMode: deliveryMode.rawValue,
            senderTimezone: TimeZone.current.identifier,
            channels: selectedChannels,
            recipientPhone: sendViaText ? normalizedPhone : nil,
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
            scheduledGifts = upsertScheduledGift(response.gift, into: scheduledGifts)
            screen = .success
        } catch {
            errorMessage = mapError(error)
        }
    }

    private func visibleScheduledGifts(from gifts: [GiftOrder]) -> [GiftOrder] {
        gifts
            .filter { gift in
                gift.deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue
                    && ["scheduled", "dispatch_retry", "dispatching"].contains(gift.status.lowercased())
            }
            .sorted { left, right in
                parseGiftDate(left.sendAt) < parseGiftDate(right.sendAt)
            }
    }

    private func upsertScheduledGift(_ gift: GiftOrder, into gifts: [GiftOrder]) -> [GiftOrder] {
        guard gift.deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue else {
            return gifts
        }
        var next = gifts.filter { $0.id != gift.id }
        if ["scheduled", "dispatch_retry", "dispatching"].contains(gift.status.lowercased()) {
            next.append(gift)
        }
        return next.sorted { parseGiftDate($0.sendAt) < parseGiftDate($1.sendAt) }
    }

    private var closeConfirmationMessage: String {
        if hasAttachedReservationContent {
            return "Save this gift and come back later, or discard it and release the credit."
        }
        if hasActiveReservation {
            return "Save this gift for later, or discard it and release the credit."
        }
        return "Close this flow?"
    }

    private func primaryCreateButtonTitle(for type: CreateFlowKind) -> String {
        if isReserving {
            return "Starting Gift..."
        }
        guard hasAttachedReservationContent else {
            return type == .song ? "Create Song Gift" : "Create Poem Gift"
        }
        return reservation?.contentType == type.rawValue
            ? (type == .song ? "Continue Song Gift" : "Continue Poem Gift")
            : (type == .song ? "Create Song Gift" : "Create Poem Gift")
    }

    private func isCreateButtonDisabled(for type: CreateFlowKind) -> Bool {
        if isReserving || isSubmitting || isCreatingContent {
            return true
        }
        if hasAttachedReservationContent, reservation?.contentType != type.rawValue {
            return true
        }
        return false
    }

    private var successTitle: String {
        guard let gift = createdGift else {
            return "Gift is ready"
        }
        return gift.deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue
            ? "Gift scheduled"
            : "Gift sent"
    }

    private var successSubtitle: String? {
        guard let gift = createdGift else {
            return nil
        }
        let persistedRecipientName = gift.recipientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let recipient = recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (!persistedRecipientName.isEmpty
                ? persistedRecipientName
                : gift.recipientSummary)
            : recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        let when = gift.sendAtLabel
        if gift.deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue {
            return "We’ll deliver this to \(recipient) on \(when)."
        }
        return "This gift is going to \(recipient) now."
    }

    private func parseGiftDate(_ isoString: String) -> Date {
        GiftDateParsing.parse(isoString)
    }

    private func isSelectedDeliveryMode(_ mode: GiftDeliveryMode) -> Bool {
        deliveryMode == mode
    }

    // MARK: - Bundle Picker Sheet

    private var bundlePickerSheet: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Unlock this gift")
                            .font(DesignTokens.displayFont(size: 22))
                            .foregroundStyle(DesignTokens.textPrimary)
                        
                        Text("Unlock this gift so you can send it when you're ready.")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)

                        if storeKit.giftBundleProducts.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 32))
                                    .foregroundStyle(DesignTokens.warning)
                            Text("Gift credits aren't available right now.")
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
            Text("Gift credits are separate from subscriptions. Upgrade for higher song and poem limits.")
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
                bundlePickerState = .failed("Payment went through, but your gift credit hasn't shown up yet. Reopen the app in a moment and try again.")
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
            storeKit.resetPurchaseState()
            bundlePickerState = .success
        } catch {
            print("[GiftFlow] Wallet sync failed after purchase: \(error)")
            bundlePickerState = .failed("Payment went through. Your gift credit should appear shortly — please reopen the app.")
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
        giftUserFacingMessage(for: error)
    }

    private func shouldPromptGiftUnlock(for error: Error) -> Bool {
        if let apiError = error as? APIClientError {
            switch apiError {
            case .serverError(_, let code, _):
                return code?.uppercased() == "INSUFFICIENT_GIFT_TOKENS"
            case .httpError(_, let body):
                return body.localizedCaseInsensitiveContains("INSUFFICIENT_GIFT_TOKENS")
                    || body.localizedCaseInsensitiveContains("gift token")
                    || body.localizedCaseInsensitiveContains("gift credit")
            default:
                return false
            }
        }
        return false
    }

    private struct GiftCreateLaunch: Identifiable {
        let id = UUID()
        let type: CreateFlowKind
        let reservationId: String
    }
}
