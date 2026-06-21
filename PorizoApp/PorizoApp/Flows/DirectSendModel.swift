//
//  DirectSendModel.swift
//  PorizoApp
//
//  One-tap "Send to [name]" — mints a PIN-free share link and opens iMessage
//  (or a Messages/WhatsApp chooser when WhatsApp is installed), pre-addressed to
//  the recipient's number. Shared by the synchronous reveal (WarmCanvasFlowView)
//  and the async path (TrackPlayerFullView / library / notification-open) so the
//  recipient number collected up front is honored wherever a finished song is opened.
//

import Combine
import SwiftUI
import MessageUI

/// Non-nil drives the iMessage compose sheet via `.sheet(item:)`.
struct DirectSendPayload: Identifiable {
    let id = UUID()
    let recipients: [String]
    let body: String
}

/// Present when both Messages and WhatsApp can deliver — the user picks a channel.
struct DirectSendChannelChoice {
    let messagePayload: DirectSendPayload
    let whatsAppURL: URL
}

@MainActor
final class DirectSendModel: ObservableObject {
    @Published var payload: DirectSendPayload?
    @Published var channelChoice: DirectSendChannelChoice?
    @Published private(set) var isSending = false
    /// Recipient name for the channel-chooser title; set when a send starts.
    private(set) var recipientName: String = ""

    /// Mint a PIN-free link (via the host's `makeLink`) then present the send UI
    /// pre-addressed to `phone`. Decoupled from `ShareController` so any surface can use it.
    func send(
        recipientName: String,
        phone: String,
        makeLink: @escaping () async throws -> String
    ) {
        guard !isSending else { return }
        self.recipientName = recipientName
        isSending = true
        ToastService.shared.show("Preparing your song link...", type: .info)
        Task { @MainActor in
            defer { isSending = false }
            do {
                let link = try await makeLink()
                present(link: link, phone: phone)
            } catch {
                ToastService.shared.show("Couldn't prepare the link. Try again.", type: .error)
            }
        }
    }

    private func present(link: String, phone: String) {
        let e164 = PhoneNumberNormalizer.e164(phone)
        let body = RecipientMessage.body(recipientName: recipientName, link: link)
        let recipients = [e164 ?? phone]

        // Offer WhatsApp only when installed AND we have a valid wa.me URL.
        if let whatsAppScheme = URL(string: "whatsapp://"),
           UIApplication.shared.canOpenURL(whatsAppScheme),
           let e164,
           let whatsAppURL = RecipientMessage.whatsAppURL(phoneE164: e164, body: body) {
            channelChoice = DirectSendChannelChoice(
                messagePayload: DirectSendPayload(recipients: recipients, body: body),
                whatsAppURL: whatsAppURL
            )
        } else {
            presentMessageCompose(DirectSendPayload(recipients: recipients, body: body))
        }
    }

    /// Present the iMessage compose sheet, or fall back to the system share sheet
    /// when this device can't send texts (e.g. iPad without Messages).
    func presentMessageCompose(_ payload: DirectSendPayload) {
        guard MFMessageComposeViewController.canSendText() else {
            let activityVC = UIActivityViewController(
                activityItems: [payload.body],
                applicationActivities: nil
            )
            if let topVC = Self.topViewController() {
                activityVC.popoverPresentationController?.sourceView = topVC.view
                topVC.present(activityVC, animated: true)
            }
            return
        }
        self.payload = payload
    }

    private static func topViewController() -> UIViewController? {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap { $0.windows }
        let keyWindow = windows.first { $0.isKeyWindow } ?? windows.first
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

extension View {
    /// Hosts the channel chooser + iMessage compose sheet for a `DirectSendModel`.
    /// Attach once on any surface that calls `model.send(...)`.
    func directSendHost(_ model: DirectSendModel) -> some View {
        modifier(DirectSendHostModifier(model: model))
    }
}

private struct DirectSendHostModifier: ViewModifier {
    @ObservedObject var model: DirectSendModel

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                "Send to \(model.recipientName)",
                isPresented: Binding(
                    get: { model.channelChoice != nil },
                    set: { if !$0 { model.channelChoice = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let choice = model.channelChoice {
                    Button("Messages") {
                        model.channelChoice = nil
                        model.presentMessageCompose(choice.messagePayload)
                    }
                    Button("WhatsApp") {
                        model.channelChoice = nil
                        UIApplication.shared.open(choice.whatsAppURL)
                    }
                    Button("Cancel", role: .cancel) {
                        model.channelChoice = nil
                    }
                }
            }
            .sheet(item: Binding(get: { model.payload }, set: { model.payload = $0 })) { payload in
                MessageComposeSheet(
                    recipients: payload.recipients,
                    body: payload.body,
                    onFinish: { model.payload = nil }
                )
            }
    }
}
