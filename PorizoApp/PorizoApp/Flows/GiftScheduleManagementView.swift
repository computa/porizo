//
//  GiftScheduleManagementView.swift
//  PorizoApp
//
//  Sender-side management surfaces for scheduled gifts.
//

import SwiftUI

struct ScheduledGiftListSheet: View {
    let gifts: [GiftOrder]
    let onSelect: (GiftOrder) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                if gifts.isEmpty {
                    VStack(spacing: 12) {
                        Text("No scheduled gifts")
                            .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Scheduled gifts will appear here until they are delivered.")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(24)
                } else {
                    ScrollView {
                        VStack(spacing: 12) {
                            ForEach(gifts) { gift in
                                Button {
                                    dismiss()
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                        onSelect(gift)
                                    }
                                } label: {
                                    scheduledGiftListRow(gift)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Manage \(gift.contentTitle ?? defaultTitle(for: gift))")
                            }
                        }
                        .padding(20)
                    }
                }
            }
            .navigationTitle("Scheduled Gifts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func scheduledGiftListRow(_ gift: GiftOrder) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(gift.contentTitle ?? defaultTitle(for: gift))
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text(recipientText(for: gift))
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()

                Text(statusText(for: gift))
                    .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                    .foregroundStyle(statusColor(for: gift))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(statusColor(for: gift).opacity(0.12))
                    .clipShape(Capsule())
            }

            Text("Delivery: \(format(sendAt: gift.sendAt))")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
        .contentShape(Rectangle())
    }

    private func defaultTitle(for gift: GiftOrder) -> String {
        gift.contentType.lowercased() == GiftContentType.poem.rawValue ? "Poem gift" : "Song gift"
    }

    private func recipientText(for gift: GiftOrder) -> String {
        if let email = gift.recipientEmail, !email.isEmpty, let phone = gift.recipientPhone, !phone.isEmpty {
            return "\(phone) • \(email)"
        }
        return gift.recipientPhone ?? gift.recipientEmail ?? "Recipient not set"
    }

    private func statusText(for gift: GiftOrder) -> String {
        switch gift.status.lowercased() {
        case "dispatch_retry":
            return "Retrying"
        case "dispatching":
            return "Sending"
        default:
            return "Scheduled"
        }
    }

    private func statusColor(for gift: GiftOrder) -> Color {
        switch gift.status.lowercased() {
        case "dispatch_retry":
            return DesignTokens.warning
        case "dispatching":
            return DesignTokens.statusSuccess
        default:
            return DesignTokens.gold
        }
    }

    private func format(sendAt: String) -> String {
        GiftDateParsing.parse(sendAt).formatted(date: .abbreviated, time: .shortened)
    }
}

struct GiftManagementSheet: View {
    let apiClient: APIClient
    let gift: GiftOrder
    let onGiftUpdated: (GiftOrder) -> Void
    let onGiftCancelled: (GiftOrder, Int?) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var sendViaSMS: Bool
    @State private var sendViaEmail: Bool
    @State private var recipientPhone: String
    @State private var recipientEmail: String
    @State private var message: String
    @State private var scheduledAt: Date
    @State private var selectedCountry: Country
    @State private var showCountryPicker = false
    @State private var isSaving = false
    @State private var isCancelling = false
    @State private var errorMessage: String?
    @State private var showCancelConfirmation = false

    init(
        apiClient: APIClient,
        gift: GiftOrder,
        onGiftUpdated: @escaping (GiftOrder) -> Void,
        onGiftCancelled: @escaping (GiftOrder, Int?) -> Void
    ) {
        self.apiClient = apiClient
        self.gift = gift
        self.onGiftUpdated = onGiftUpdated
        self.onGiftCancelled = onGiftCancelled
        let inferredCountry = Country.country(forPhoneNumber: gift.recipientPhone)
        _selectedCountry = State(initialValue: inferredCountry)
        _sendViaSMS = State(initialValue: (gift.recipientPhone?.isEmpty == false) || gift.channels.contains(GiftDeliveryChannel.sms.rawValue))
        _sendViaEmail = State(initialValue: (gift.recipientEmail?.isEmpty == false) || gift.channels.contains(GiftDeliveryChannel.email.rawValue))
        _recipientPhone = State(initialValue: Self.displayPhone(gift.recipientPhone, country: inferredCountry))
        _recipientEmail = State(initialValue: gift.recipientEmail ?? "")
        _message = State(initialValue: gift.message ?? "")
        _scheduledAt = State(initialValue: GiftDateParsing.parse(gift.sendAt))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        headerCard
                        channelSection
                        recipientSection
                        deliverySection
                        messageSection

                        if let errorMessage {
                            Text(errorMessage)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.error)
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Manage Gift")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSaving || isCancelling)
                }
            }
            .safeAreaInset(edge: .bottom) {
                actionBar
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 20)
                    .background(DesignTokens.background.opacity(0.96))
            }
        }
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(selectedCountry: $selectedCountry, isPresented: $showCountryPicker)
        }
        .confirmationDialog("Cancel this scheduled gift?", isPresented: $showCancelConfirmation, titleVisibility: .visible) {
            Button("Cancel Gift", role: .destructive) {
                Task { await cancelGift() }
            }
            Button("Keep Gift", role: .cancel) {}
        } message: {
            Text("This refunds the gift token and removes the scheduled delivery.")
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(gift.contentTitle ?? defaultTitle)
                .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            HStack(spacing: 8) {
                statusPill(text: statusText, color: statusColor)
                if let pin = gift.claimPin, !pin.isEmpty {
                    statusPill(text: "PIN \(pin)", color: DesignTokens.textSecondary)
                }
            }

            Text("Make sure the recipient and delivery time are correct before we send it.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.cardBackground)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var channelSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Delivery channels")
            channelToggle(title: "SMS", subtitle: "Send as a text message", isOn: $sendViaSMS)
            channelToggle(title: "Email", subtitle: "Send by email", isOn: $sendViaEmail)
        }
    }

    @ViewBuilder
    private var recipientSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Recipient details")

            if sendViaSMS {
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

                    TextField("Recipient phone", text: $recipientPhone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 14)
                        .background(DesignTokens.cardBackground)
                        .clipShape(.rect(cornerRadius: 10))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .onChange(of: recipientPhone) { _, newValue in
                            recipientPhone = formatPhoneInput(newValue, selectedCountry: selectedCountry)
                        }
                }
            }

            if sendViaEmail {
                TextField("Recipient email", text: $recipientEmail)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                    .background(DesignTokens.cardBackground)
                    .clipShape(.rect(cornerRadius: 10))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
        }
    }

    private var deliverySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Delivery time")
            DatePicker(
                "Scheduled for",
                selection: $scheduledAt,
                in: Date.now.addingTimeInterval(60)...,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.graphical)
            .tint(DesignTokens.gold)
            .padding(12)
            .background(DesignTokens.cardBackground)
            .clipShape(.rect(cornerRadius: 12))

            Text("Timezone: \(gift.senderTimezone ?? TimeZone.current.identifier)")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }

    private var messageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionLabel("Message")
            TextEditor(text: $message)
                .frame(minHeight: 120)
                .padding(8)
                .background(DesignTokens.cardBackground)
                .clipShape(.rect(cornerRadius: 10))
                .foregroundStyle(DesignTokens.textPrimary)
        }
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            Button {
                Task { await saveChanges() }
            } label: {
                HStack {
                    if isSaving {
                        ProgressView().tint(.white)
                    }
                    Text("Save changes")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(canSave ? DesignTokens.gold : DesignTokens.surfaceMuted)
                .clipShape(.rect(cornerRadius: 14))
            }
            .disabled(!canSave || isSaving || isCancelling)
            .buttonStyle(.plain)

            Button {
                showCancelConfirmation = true
            } label: {
                HStack {
                    if isCancelling {
                        ProgressView().tint(DesignTokens.error)
                    }
                    Text("Cancel gift")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                }
                .foregroundStyle(DesignTokens.error)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(DesignTokens.cardBackground)
                .clipShape(.rect(cornerRadius: 14))
            }
            .disabled(isSaving || isCancelling)
            .buttonStyle(.plain)
        }
    }

    private var normalizedPhone: String? {
        sendViaSMS ? normalizedE164PhoneNumber(recipientPhone, selectedCountry: selectedCountry) : nil
    }

    private var normalizedEmail: String? {
        let trimmed = recipientEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return nil }
        let emailPredicate = NSPredicate(format: "SELF MATCHES[c] %@", "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$")
        return emailPredicate.evaluate(with: trimmed) ? trimmed : nil
    }

    private var channels: [String] {
        var next: [String] = []
        if sendViaSMS { next.append(GiftDeliveryChannel.sms.rawValue) }
        if sendViaEmail { next.append(GiftDeliveryChannel.email.rawValue) }
        return next
    }

    private var canSave: Bool {
        guard !channels.isEmpty else { return false }
        if sendViaSMS && normalizedPhone == nil { return false }
        if sendViaEmail && normalizedEmail == nil { return false }
        return scheduledAt > Date.now.addingTimeInterval(60)
    }

    private var defaultTitle: String {
        gift.contentType.lowercased() == GiftContentType.poem.rawValue ? "Poem gift" : "Song gift"
    }

    private var statusText: String {
        switch gift.status.lowercased() {
        case "dispatch_retry":
            return "Retrying"
        case "dispatching":
            return "Sending"
        default:
            return "Scheduled"
        }
    }

    private var statusColor: Color {
        switch gift.status.lowercased() {
        case "dispatch_retry":
            return DesignTokens.warning
        case "dispatching":
            return DesignTokens.statusSuccess
        default:
            return DesignTokens.gold
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            .foregroundStyle(DesignTokens.textSecondary)
    }

    private func statusPill(text: String, color: Color) -> some View {
        Text(text)
            .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
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
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .clipShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func saveChanges() async {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let request = UpdateGiftRequest(
            sendAt: scheduledAt.formatted(.iso8601),
            senderTimezone: gift.senderTimezone ?? TimeZone.current.identifier,
            channels: channels,
            recipientPhone: normalizedPhone,
            recipientEmail: normalizedEmail,
            message: message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : message.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        do {
            let response = try await apiClient.updateGift(giftId: gift.id, updates: request)
            onGiftUpdated(response.gift)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func cancelGift() async {
        isCancelling = true
        errorMessage = nil
        defer { isCancelling = false }

        do {
            let response = try await apiClient.cancelGift(giftId: gift.id)
            onGiftCancelled(response.gift, response.walletBalance)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func displayPhone(_ phone: String?, country: Country) -> String {
        guard let phone else { return "" }
        if phone.hasPrefix(country.dialCode) {
            let national = String(phone.dropFirst(country.dialCode.count))
            return formatPhoneInput(national, selectedCountry: country)
        }
        return phone
    }
}

enum GiftDateParsing {
    private static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let basic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ isoString: String) -> Date {
        withFractionalSeconds.date(from: isoString)
            ?? basic.date(from: isoString)
            ?? Date.now
    }
}
