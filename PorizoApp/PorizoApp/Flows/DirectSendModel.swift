//
//  DirectSendModel.swift
//  PorizoApp
//
//  One-tap "Send to [name]" — mints a PIN-free link and opens iMessage (or a
//  Messages/WhatsApp chooser when WhatsApp is installed), pre-addressed to the
//  recipient's number. Shared by the reveal (WarmCanvasFlowView) and the async
//  path (TrackPlayerFullView / MySongs / library).
//
//  Presentation is IMPERATIVE (UIKit `present` on the top view controller), not
//  SwiftUI `.sheet`/`.confirmationDialog`. Those surfaces already host several
//  presentations; stacking another SwiftUI sheet silently no-ops. Same lesson as
//  ContactPickerPresenter.
//
//  After the user picks a channel we confirm the send ("Sent to [name]!") so they
//  don't return to a still-present reveal and send a second time:
//   - iMessage: confirmed precisely from the compose result (.sent).
//   - WhatsApp: opening it is the last in-app action and we can't observe the send,
//     so we confirm once when the app returns to the foreground.
//

import Combine
import UIKit
import MessageUI

@MainActor
final class DirectSendModel: ObservableObject {
    @Published private(set) var isSending = false
    private var composeDelegate: ComposeDelegate?
    /// Background + foreground observers that confirm a WhatsApp hand-off on return.
    /// Only confirm after a real background→foreground round-trip so an unrelated
    /// foregrounding (Control Center, a banner) can't show a spurious "Sent!".
    private var directSendObservers: [NSObjectProtocol] = []
    private var backgroundedSinceArm = false
    /// Recipient for the post-send confirmation copy.
    private var recipientName = ""

    private var sentToast: String {
        recipientName.isEmpty ? "Sent! 🎉" : "Sent to \(recipientName)! 🎉"
    }

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
            presentChannelChooser(recipients: recipients, body: body, whatsAppURL: whatsAppURL)
        } else {
            presentMessageCompose(recipients: recipients, body: body)
        }
    }

    private func presentChannelChooser(recipients: [String], body: String, whatsAppURL: URL) {
        guard let top = Self.topViewController() else {
            ToastService.shared.show("Couldn't open the share screen. Try again.", type: .error)
            return
        }
        let title = recipientName.isEmpty ? "Send your song" : "Send to \(recipientName)"
        let sheet = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Messages", style: .default) { [weak self] _ in
            self?.presentMessageCompose(recipients: recipients, body: body)
        })
        sheet.addAction(UIAlertAction(title: "WhatsApp", style: .default) { [weak self] _ in
            self?.openWhatsApp(whatsAppURL)
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        // iPad anchor (no-op on iPhone).
        sheet.popoverPresentationController?.sourceView = top.view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: top.view.bounds.midX, y: top.view.bounds.maxY - 40, width: 0, height: 0)
        top.present(sheet, animated: true)
    }

    /// Hand off to WhatsApp and confirm once the user returns to the app.
    private func openWhatsApp(_ url: URL) {
        armWhatsAppReturnConfirmation()
        UIApplication.shared.open(url) { [weak self] success in
            // If WhatsApp couldn't open, don't leave a misleading "sent" armed.
            if !success { Task { @MainActor in self?.disarmWhatsAppReturnConfirmation() } }
        }
    }

    private func armWhatsAppReturnConfirmation() {
        disarmWhatsAppReturnConfirmation()
        backgroundedSinceArm = false
        let toast = sentToast
        let background = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.backgroundedSinceArm = true }
        }
        let foreground = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                // Ignore foregroundings that weren't a real round-trip to WhatsApp.
                guard let self, self.backgroundedSinceArm else { return }
                ToastService.shared.show(toast, type: .success)
                self.disarmWhatsAppReturnConfirmation()
            }
        }
        directSendObservers = [background, foreground]
    }

    private func disarmWhatsAppReturnConfirmation() {
        directSendObservers.forEach { NotificationCenter.default.removeObserver($0) }
        directSendObservers.removeAll()
        backgroundedSinceArm = false
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
        let toast = sentToast
        let delegate = ComposeDelegate(onResult: { [weak self] result in
            Task { @MainActor in
                switch result {
                case .sent: ToastService.shared.show(toast, type: .success)
                case .failed: ToastService.shared.show("Couldn't send. Try again.", type: .error)
                default: break  // .cancelled — no message
                }
                self?.composeDelegate = nil
            }
        })
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

/// Separate (non-MainActor) delegate so the compose VC dismisses itself and reports
/// the terminal result for the "Sent!" confirmation.
private final class ComposeDelegate: NSObject, MFMessageComposeViewControllerDelegate {
    private let onResult: (MessageComposeResult) -> Void
    init(onResult: @escaping (MessageComposeResult) -> Void) { self.onResult = onResult }

    func messageComposeViewController(
        _ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult
    ) {
        controller.dismiss(animated: true) { [onResult] in onResult(result) }
    }
}
