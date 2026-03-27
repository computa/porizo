//
//  ConfirmationCardView.swift
//  PorizoApp
//
//  Extracted from UnifiedCreateFlowView — story confirmation card
//  shown when the story is complete but not yet created.
//  Pure display + edit callback, no owned @State.
//

import SwiftUI

struct ConfirmationCardView: View {
    let recipientName: String
    let narrative: String
    let occasion: String?
    let onEnterEditMode: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            // Divider
            HStack(spacing: 10) {
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("READY")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold.opacity(0.7))
                    .tracking(1.5)
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
            }

            // Narrative summary
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("\(recipientName)'s Story")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)

                    Spacer()

                    Button {
                        onEnterEditMode()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12))
                            Text("Edit")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }
                }

                Text(narrative)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(4)

                // Mood pills (derived from occasion)
                HStack(spacing: 8) {
                    ForEach(moodPills(for: occasion), id: \.label) { pill in
                        moodPill(icon: pill.icon, label: pill.label)
                    }
                }

                // Style picker + Create button moved to CollapsibleStylePicker in bottom bar
            }
            .padding(16)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
            )
        }
        .padding(.top, 12)
    }

    // MARK: - Mood Derivation

    private struct MoodPillData: Hashable {
        let icon: String
        let label: String
    }

    private func moodPills(for occasion: String?) -> [MoodPillData] {
        switch occasion?.lowercased() {
        case "birthday":
            return [
                MoodPillData(icon: "party.popper.fill", label: "Celebratory"),
                MoodPillData(icon: "face.smiling", label: "Joyful"),
                MoodPillData(icon: "heart.fill", label: "Warm"),
            ]
        case "anniversary":
            return [
                MoodPillData(icon: "heart.fill", label: "Romantic"),
                MoodPillData(icon: "clock.arrow.circlepath", label: "Nostalgic"),
                MoodPillData(icon: "sparkles", label: "Warm"),
            ]
        case "wedding":
            return [
                MoodPillData(icon: "heart.fill", label: "Loving"),
                MoodPillData(icon: "sparkles", label: "Elegant"),
                MoodPillData(icon: "face.smiling", label: "Joyful"),
            ]
        case "memorial", "funeral", "remembrance":
            return [
                MoodPillData(icon: "leaf.fill", label: "Reflective"),
                MoodPillData(icon: "cloud.sun.fill", label: "Gentle"),
                MoodPillData(icon: "heart.fill", label: "Warm"),
            ]
        case "graduation":
            return [
                MoodPillData(icon: "star.fill", label: "Proud"),
                MoodPillData(icon: "sun.max.fill", label: "Hopeful"),
                MoodPillData(icon: "sparkles", label: "Bright"),
            ]
        case "thank you", "thanks", "appreciation":
            return [
                MoodPillData(icon: "hands.clap.fill", label: "Grateful"),
                MoodPillData(icon: "heart.fill", label: "Warm"),
                MoodPillData(icon: "sparkles", label: "Heartfelt"),
            ]
        case "apology", "sorry":
            return [
                MoodPillData(icon: "heart.fill", label: "Sincere"),
                MoodPillData(icon: "leaf.fill", label: "Gentle"),
                MoodPillData(icon: "sun.max.fill", label: "Hopeful"),
            ]
        default:
            return [
                MoodPillData(icon: "heart.fill", label: "Warm"),
                MoodPillData(icon: "face.smiling", label: "Playful"),
                MoodPillData(icon: "mountain.2.fill", label: "Adventurous"),
            ]
        }
    }

    // MARK: - Private

    private func moodPill(icon: String, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9))
            Text(label)
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
        }
        .foregroundStyle(DesignTokens.gold)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(DesignTokens.gold.opacity(0.1))
        .clipShape(Capsule())
    }
}
