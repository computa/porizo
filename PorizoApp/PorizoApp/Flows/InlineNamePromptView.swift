//
//  InlineNamePromptView.swift
//  PorizoApp
//
//  Recipient-first create entry. When the host wires `onContactPicked`, this is
//  a TWO-STEP flow so picking the recipient is a deliberate, unmissable first
//  action (it enables one-tap "Send to [recipient]"):
//    1. "Who's this song for?" — Choose from Contacts (hero) or type a name.
//    2. Occasion + Song/Poem, then "Next →".
//  When `onContactPicked` is nil (e.g. previews/galleries), it falls back to the
//  original single screen.
//

import SwiftUI

struct InlineNamePromptView: View {
    let selectedType: CreateFlowKind?
    var preselectedOccasion: String?
    let onStart: (String, Occasion?, CreateFlowKind) -> Void
    let onCancel: () -> Void
    /// Called when the sender picks a contact: the contact's full name and
    /// (when available) their raw phone number. When wired, this view runs the
    /// two-step recipient-first flow; when nil, the single-screen fallback.
    var onContactPicked: ((_ name: String, _ phone: String?) -> Void)? = nil

    private enum EntryPhase { case recipient, details }

    @State private var nameInput: String = ""
    @State private var selectedOccasion: String?
    @State private var activeType: CreateFlowKind = .song
    @State private var contactPickerRequest: GiftContactPickerRequest?
    @State private var phase: EntryPhase = .recipient
    @State private var showManualEntry = false

    private static let occasions: [(emoji: String, label: String)] = Occasion.allCases
        .filter { $0 != .custom }
        .map { ($0.emoji, $0.displayName) }

    private var trimmedName: String {
        nameInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var typeLabel: String { activeType == .poem ? "poem" : "song" }

    private var heading: String {
        if let occ = selectedOccasion { return "Create a \(occ) \(typeLabel)" }
        return "Create a \(typeLabel)"
    }

    private var recipientFirst: Bool { onContactPicked != nil }

    var body: some View {
        VStack(spacing: 0) {
            topBar

            Spacer()

            if recipientFirst {
                switch phase {
                case .recipient: recipientPhase
                case .details: detailsPhase
                }
            } else {
                legacyScreen
            }

            Spacer()
        }
        .onAppear {
            selectedOccasion = preselectedOccasion
            activeType = selectedType ?? .song
        }
        .onTapGesture {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .sheet(item: $contactPickerRequest) { request in
            GiftContactPickerSheet(method: request.method) { selection in
                contactPickerRequest = nil
                let trimmed = selection.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { nameInput = trimmed }
                onContactPicked?(trimmed, selection.phoneNumber)
                if !trimmed.isEmpty { withAnimation { phase = .details } }
            }
        }
    }

    // MARK: - Top bar (back when on step 2 + close)

    private var topBar: some View {
        HStack {
            if recipientFirst && phase == .details {
                Button { withAnimation { phase = .recipient } } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(Color.black.opacity(0.05))
                        .clipShape(Circle())
                }
                .accessibilityIdentifier("name-entry-back")
            }
            Spacer()
            Button { onCancel() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(Color.black.opacity(0.05))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }

    // MARK: - Step 1: Who's this song for?

    private var recipientPhase: some View {
        VStack(spacing: 20) {
            sparkle
            Text("Who's this song for?")
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            // Hero — Choose from Contacts
            Button {
                contactPickerRequest = GiftContactPickerRequest(method: .text)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.system(size: 17, weight: .semibold))
                    Text("Choose from Contacts")
                        .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .padding(.horizontal, 20)
            .accessibilityIdentifier("name-entry-pick-contact")

            Text("We'll text them the song in one tap the moment it's ready.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if showManualEntry {
                VStack(spacing: 12) {
                    TextField("Their name", text: $nameInput)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(DesignTokens.border, lineWidth: 1.5))
                        .accessibilityIdentifier("name-entry-recipient-field")
                        .onSubmit { advanceToDetails() }

                    Button { advanceToDetails() } label: {
                        Text("Continue →")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .disabled(trimmedName.isEmpty)
                    .opacity(trimmedName.isEmpty ? 0.5 : 1.0)
                }
                .padding(.horizontal, 20)
            } else {
                Button { withAnimation { showManualEntry = true } } label: {
                    Text("Just type a name instead")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                }
                .accessibilityIdentifier("name-entry-type-instead")
            }
        }
    }

    // MARK: - Step 2: occasion + type

    private var detailsPhase: some View {
        VStack(spacing: 20) {
            sparkle
            Text("A \(typeLabel) for \(trimmedName)")
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)

            occasionChips
            typeToggle
            nextButton
        }
    }

    // MARK: - Single-screen fallback (onContactPicked not wired)

    private var legacyScreen: some View {
        VStack(spacing: 20) {
            sparkle
            Text(heading)
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
            nameField
            occasionChips
            typeToggle
            nextButton
        }
    }

    // MARK: - Shared pieces

    private var sparkle: some View {
        Image(systemName: "sparkle")
            .font(.system(size: 36))
            .foregroundStyle(DesignTokens.gold)
    }

    private var nameField: some View {
        TextField("Their Name", text: $nameInput)
            .font(DesignTokens.bodyFont(size: 16))
            .foregroundStyle(DesignTokens.textPrimary)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.border, lineWidth: 1.5))
            .padding(.horizontal, 20)
            .accessibilityIdentifier("name-entry-recipient-field")
            .onSubmit { submit() }
    }

    private var occasionChips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Self.occasions, id: \.label) { item in
                    let isSelected = selectedOccasion == item.label
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            selectedOccasion = isSelected ? nil : item.label
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(item.emoji).font(.system(size: 14))
                            Text(item.label)
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        }
                        .foregroundStyle(isSelected ? DesignTokens.gold : DesignTokens.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(DesignTokens.surface)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule().stroke(
                                isSelected ? DesignTokens.gold : DesignTokens.border,
                                lineWidth: isSelected ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("occasion-chip-\(item.label.lowercased())")
                }
            }
            .padding(.horizontal, 20)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var typeToggle: some View {
        // Song / Poem toggle (only when type is not pre-determined)
        if selectedType == nil {
            HStack(spacing: 0) {
                typeToggleButton("♪ A Song", type: .song)
                typeToggleButton("📝 A Poem", type: .poem)
            }
            .padding(4)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.border, lineWidth: 1))
            .padding(.horizontal, 20)
        }
    }

    private var nextButton: some View {
        Button { submit() } label: {
            Text("Next →")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .disabled(trimmedName.isEmpty)
        .opacity(trimmedName.isEmpty ? 0.5 : 1.0)
        .padding(.horizontal, 20)
    }

    private func typeToggleButton(_ label: String, type: CreateFlowKind) -> some View {
        let isSelected = activeType == type
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) { activeType = type }
        } label: {
            Text(label)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(isSelected ? DesignTokens.background : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func advanceToDetails() {
        guard !trimmedName.isEmpty else { return }
        withAnimation { phase = .details }
    }

    private func submit() {
        guard !trimmedName.isEmpty else { return }
        let occasion: Occasion? = selectedOccasion.flatMap { label in
            Occasion.allCases.first { $0.displayName == label }
        }
        onStart(trimmedName, occasion, activeType)
    }
}
