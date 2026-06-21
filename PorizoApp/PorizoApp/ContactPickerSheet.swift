//
//  ContactPickerSheet.swift
//  PorizoApp
//
//  Contacts picker for gift delivery destinations.
//

import SwiftUI
import Contacts
import ContactsUI

/// Exposes the Gift flow's destination enum to other create-flow surfaces
/// (e.g. the recipient-first name step) without a parallel enum or rename churn.
typealias ContactDestinationMethod = GiftSendFlowView.GiftDestinationMethod

struct GiftContactPickerRequest: Identifiable {
    let method: GiftSendFlowView.GiftDestinationMethod

    var id: String {
        method.rawValue
    }
}

struct GiftContactSelection {
    let method: GiftSendFlowView.GiftDestinationMethod
    let fullName: String
    let phoneNumber: String?
    let emailAddress: String?
}

struct GiftContactPickerSheet: UIViewControllerRepresentable {
    let method: GiftSendFlowView.GiftDestinationMethod
    let onSelect: (GiftContactSelection) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(method: method, onSelect: onSelect)
    }

    func makeUIViewController(context: Context) -> CNContactPickerViewController {
        let picker = CNContactPickerViewController()
        picker.delegate = context.coordinator
        picker.displayedPropertyKeys = method == .text ? [CNContactPhoneNumbersKey] : [CNContactEmailAddressesKey]
        picker.predicateForEnablingContact = context.coordinator.contactPredicate
        picker.predicateForSelectionOfContact = NSPredicate(value: false)
        picker.predicateForSelectionOfProperty = NSPredicate(value: true)
        return picker
    }

    func updateUIViewController(_ uiViewController: CNContactPickerViewController, context: Context) {}

    final class Coordinator: NSObject, CNContactPickerDelegate {  // gift-flow coordinator
        // (unchanged — used by the SwiftUI .sheet path in the Gift flow)
        let method: GiftSendFlowView.GiftDestinationMethod
        let onSelect: (GiftContactSelection) -> Void

        init(
            method: GiftSendFlowView.GiftDestinationMethod,
            onSelect: @escaping (GiftContactSelection) -> Void
        ) {
            self.method = method
            self.onSelect = onSelect
        }

        var contactPredicate: NSPredicate {
            switch method {
            case .text:
                return NSPredicate(format: "phoneNumbers.@count > 0")
            case .email:
                return NSPredicate(format: "emailAddresses.@count > 0")
            }
        }

        func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
            let contact = contactProperty.contact
            let fullName = CNContactFormatter.string(from: contact, style: .fullName)
                ?? [contact.givenName, contact.familyName]
                    .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .joined(separator: " ")

            switch method {
            case .text:
                guard let phoneNumber = contactProperty.value as? CNPhoneNumber else { return }
                onSelect(
                    GiftContactSelection(
                        method: .text,
                        fullName: fullName,
                        phoneNumber: phoneNumber.stringValue,
                        emailAddress: nil
                    )
                )
            case .email:
                if let email = contactProperty.value as? NSString {
                    onSelect(
                        GiftContactSelection(
                            method: .email,
                            fullName: fullName,
                            phoneNumber: nil,
                            emailAddress: email as String
                        )
                    )
                }
            }
        }
    }
}

/// Presents the system contact picker IMPERATIVELY (UIKit `present`) instead of
/// as a SwiftUI `.sheet` root. `CNContactPickerViewController` auto-dismisses
/// itself on selection; embedded as a `.sheet` inside a `.fullScreenCover` that
/// self-dismiss cascades and tears down the whole parent flow (it kicked the
/// create flow back to Home). Presenting on the top view controller scopes the
/// dismissal to the picker only.
final class ContactPickerPresenter: NSObject, CNContactPickerDelegate {
    private var onSelect: ((GiftContactSelection) -> Void)?
    private var strongSelf: ContactPickerPresenter?

    func presentPhonePicker(onSelect: @escaping (GiftContactSelection) -> Void) {
        self.onSelect = onSelect
        self.strongSelf = self  // retain through the picker's lifetime
        let picker = CNContactPickerViewController()
        picker.delegate = self
        picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
        picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
        picker.predicateForSelectionOfContact = NSPredicate(value: false)
        picker.predicateForSelectionOfProperty = NSPredicate(value: true)
        guard let presenter = Self.topViewController() else { strongSelf = nil; return }
        presenter.present(picker, animated: true)
    }

    func contactPicker(
        _ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty
    ) {
        defer { strongSelf = nil }
        guard let phone = contactProperty.value as? CNPhoneNumber else { return }
        let contact = contactProperty.contact
        let fullName = CNContactFormatter.string(from: contact, style: .fullName)
            ?? [contact.givenName, contact.familyName]
                .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                .joined(separator: " ")
        onSelect?(
            GiftContactSelection(
                method: .text, fullName: fullName,
                phoneNumber: phone.stringValue, emailAddress: nil))
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        strongSelf = nil
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
