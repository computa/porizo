//
//  DirectSendModel.swift
//  PorizoApp
//
//  One-tap "Send to [name]" — mints a PIN-free share link and opens iMessage
//  (or a Messages/WhatsApp chooser when WhatsApp is installed), pre-addressed to
//  the recipient's number. Shared by the synchronous reveal (WarmCanvasFlowView)
//  and the async path (TrackPlayerFullView / MySongs / library).
//
//  Presentation is IMPERATIVE (UIKit `present` on the top view controller), not
//  SwiftUI `.sheet`/`.confirmationDialog`. These surfaces already host several
//  presentations (activeSheet, fullScreenCover, alert); stacking another SwiftUI
//  sheet onto the same view silently no-ops (the link mints but nothing appears).
//  Presenting on the top VC sidesteps that — same lesson as ContactPickerPresenter.
//

import Combine
import UIKit
import MessageUI

@MainActor
final class DirectSendModel: ObservableObject {
    @Published private(set) var isSending = false
    /// Retains the compose delegate for the lifetime of the message sheet.
    private var composeDelegate: ComposeDelegate?

    /// Mint a PIN-free link (via the host's `makeLink`) then present the send UI
    /// pre-addressed to `phone`. Decoupled from `ShareController` so any surface can use it.
    func send(
        recipientName: String,
        phone: String,
        makeLink: @escaping () async throws -> String
    ) {
        guard !isSending else { return }
        isSending = true
        ToastService.shared.show("Preparing your song link...", type: .info)
        Task { @MainActor in
            defer { isSending = false }
            do {
                let link = try await makeLink()
                present(recipientName: recipientName, link: link, phone: phone)
            } catch {
                ToastService.shared.show("Couldn't prepare the link. Try again.", type: .error)
            }
        }
    }

    private func present(recipientName: String, link: String, phone: String) {
        let e164 = PhoneNumberNormalizer.e164(phone)
        let body = RecipientMessage.body(recipientName: recipientName, link: link)
        let recipients = [e164 ?? phone]

        // Offer WhatsApp only when installed AND we have a valid wa.me URL.
        if let whatsAppScheme = URL(string: "whatsapp://"),
           UIApplication.shared.canOpenURL(whatsAppScheme),
           let e164,
           let whatsAppURL = RecipientMessage.whatsAppURL(phoneE164: e164, body: body) {
            presentChannelChooser(
                title: "Send to \(recipientName)",
                recipients: recipients, body: body, whatsAppURL: whatsAppURL)
        } else {
            presentMessageCompose(recipients: recipients, body: body)
        }
    }

    private func presentChannelChooser(
        title: String, recipients: [String], body: String, whatsAppURL: URL
    ) {
        guard let top = Self.topViewController() else {
            ToastService.shared.show("Couldn't open the share screen. Try again.", type: .error)
            return
        }
        let sheet = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Messages", style: .default) { [weak self] _ in
            self?.presentMessageCompose(recipients: recipients, body: body)
        })
        sheet.addAction(UIAlertAction(title: "WhatsApp", style: .default) { _ in
            UIApplication.shared.open(whatsAppURL)
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        // iPad anchor (no-op on iPhone).
        sheet.popoverPresentationController?.sourceView = top.view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: top.view.bounds.midX, y: top.view.bounds.maxY - 40, width: 0, height: 0)
        top.present(sheet, animated: true)
    }

    /// Present the iMessage compose sheet, or fall back to the system share sheet
    /// when this device can't send texts (e.g. iPad without Messages).
    private func presentMessageCompose(recipients: [String], body: String) {
        guard let top = Self.topViewController() else {
            ToastService.shared.show("Couldn't open the share screen. Try again.", type: .error)
            return
        }
        guard MFMessageComposeViewController.canSendText() else {
            let activityVC = UIActivityViewController(activityItems: [body], applicationActivities: nil)
            activityVC.popoverPresentationController?.sourceView = top.view
            top.present(activityVC, animated: true)
            return
        }
        let delegate = ComposeDelegate { [weak self] in self?.composeDelegate = nil }
        composeDelegate = delegate
        let vc = MFMessageComposeViewController()
        vc.messageComposeDelegate = delegate
        vc.recipients = recipients
        vc.body = body
        top.present(vc, animated: true)
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

/// Separate (non-MainActor) delegate so the compose VC dismisses itself on finish.
private final class ComposeDelegate: NSObject, MFMessageComposeViewControllerDelegate {
    private let onDismiss: () -> Void
    init(onDismiss: @escaping () -> Void) { self.onDismiss = onDismiss }

    func messageComposeViewController(
        _ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult
    ) {
        controller.dismiss(animated: true) { [onDismiss] in onDismiss() }
    }
}
