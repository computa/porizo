//
//  ContactPickerSheet.swift
//  PorizoApp
//
//  Contacts picker for gift delivery destinations.
//

import SwiftUI
import Contacts
import ContactsUI

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

    final class Coordinator: NSObject, CNContactPickerDelegate {
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
