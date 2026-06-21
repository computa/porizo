//
//  MessageComposeSheet.swift
//  PorizoApp
//
//  SwiftUI wrapper around MFMessageComposeViewController for the one-tap
//  "Send to [recipient]" flow. Pre-fills the recipient phone number and the
//  PIN-free song message. Gate presentation behind canSendText().
//

import SwiftUI
import MessageUI

struct MessageComposeSheet: UIViewControllerRepresentable {
    let recipients: [String]
    let body: String
    var onFinish: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let vc = MFMessageComposeViewController()
        vc.messageComposeDelegate = context.coordinator
        vc.recipients = recipients
        vc.body = body
        return vc
    }

    func updateUIViewController(_ uiViewController: MFMessageComposeViewController, context: Context) {}

    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        private let onFinish: (() -> Void)?

        init(onFinish: (() -> Void)?) {
            self.onFinish = onFinish
        }

        func messageComposeViewController(
            _ controller: MFMessageComposeViewController,
            didFinishWith result: MessageComposeResult
        ) {
            // Close the sheet on every terminal result (.sent, .cancelled, .failed).
            controller.dismiss(animated: true) { [onFinish] in
                onFinish?()
            }
        }
    }
}
