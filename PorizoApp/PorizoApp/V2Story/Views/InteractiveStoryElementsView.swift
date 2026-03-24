//
//  InteractiveStoryElementsView.swift
//  PorizoApp
//
//  Interactive story elements card. Shows element progress as bars.
//  Tapping a weak element opens ElementGuidanceSheet popup.
//

import SwiftUI

/// Lightweight Identifiable wrapper for sheet(item:) presentation.
private struct SelectedBeatItem: Identifiable {
    let id: String
    let beat: V2Beat
}

struct InteractiveStoryElementsView: View {
    var engine: V2StoryEngine
    // Uses sheet(item:) pattern for reliable presentation (avoids black screen)
    @State private var selectedItem: SelectedBeatItem?
    @State private var speechInputContext: SpeechInputContext?
    @State private var pendingGuidanceSpeechText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            headerRow

            ForEach(engine.currentBeats) { beat in
                elementRow(beat: beat)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .sheet(item: $selectedItem) { item in
            ElementGuidanceSheet(
                engine: engine,
                beat: item.beat,
                onSpeechInput: { speechInputContext = SpeechInputContext(storyId: engine.storyId) },
                pendingSpeechText: $pendingGuidanceSpeechText
            )
        }
        .fullScreenCover(item: $speechInputContext) { context in
            SpeechInputView(
                storyId: context.storyId,
                onTranscription: { text in
                    speechInputContext = nil
                    pendingGuidanceSpeechText = text
                },
                onCancel: {
                    speechInputContext = nil
                }
            )
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack {
            Text("Story Elements")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Text("\(engine.completionScore)%")
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
        }
    }

    // MARK: - Element Row

    private func elementRow(beat: V2Beat) -> some View {
        Button {
            selectedItem = SelectedBeatItem(id: beat.id, beat: beat)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold.opacity(0.5))
                        .frame(width: 8, height: 8)

                    Text(beat.displayName)
                        .font(DesignTokens.bodyFont(size: 14, weight: beat.isFilled ? .regular : .medium))
                        .foregroundStyle(beat.isFilled ? DesignTokens.textSecondary : DesignTokens.textPrimary)

                    Spacer()

                    if beat.isFilled {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(DesignTokens.success)
                    }
                }

                // Horizontal strength bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(DesignTokens.surfaceMuted)
                            .frame(height: 6)

                        RoundedRectangle(cornerRadius: 4)
                            .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold)
                            .frame(width: max(geo.size.width * beat.strength, 0), height: 6)
                    }
                }
                .frame(height: 6)
                .padding(.leading, 18)
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .disabled(beat.isFilled)
    }
}
