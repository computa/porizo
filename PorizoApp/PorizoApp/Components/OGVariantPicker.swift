//
//  OGVariantPicker.swift
//  PorizoApp
//
//  Shared OG variant (share card style) picker used by both
//  ShareSheetView (songs) and PoemShareView (poems).
//

import SwiftUI

/// State container for OG variant picker, shared across song and poem share views.
@Observable
class OGVariantPickerState {
    var previews: [OgVariantPreview] = []
    var selectedVariant: String?
    var currentVariant: String?
    var isLoading = false
    var isApplying = false
    var error: String?
}

/// Reusable picker for selecting OG share card style variants.
/// Displays horizontal thumbnail previews with selection ring and optional apply button.
struct OGVariantPicker: View {
    @Bindable var state: OGVariantPickerState
    let showApplyButton: Bool
    var onApply: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SHARE CARD STYLE")
                .font(.system(size: 12, weight: .medium))
                .tracking(1)
                .foregroundStyle(DesignTokens.textTertiary)

            if state.isLoading && state.previews.isEmpty {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading style previews...")
                        .font(.system(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else if !state.previews.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(state.previews) { variant in
                            Button {
                                state.selectedVariant = variant.name
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    if let previewImage = decodePreviewImage(variant.preview) {
                                        Image(uiImage: previewImage)
                                            .resizable()
                                            .scaledToFill()
                                            .frame(width: 160, height: 84)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                    } else {
                                        RoundedRectangle(cornerRadius: 10)
                                            .fill(DesignTokens.cardBackground)
                                            .frame(width: 160, height: 84)
                                            .overlay(
                                                Image(systemName: "photo")
                                                    .font(.system(size: 18))
                                                    .foregroundStyle(DesignTokens.textTertiary)
                                            )
                                    }
                                    Text(variant.label)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(DesignTokens.textSecondary)
                                        .lineLimit(1)
                                }
                                .padding(6)
                                .background(DesignTokens.cardBackground)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(
                                            state.selectedVariant == variant.name ? DesignTokens.gold : DesignTokens.border.opacity(0.6),
                                            lineWidth: state.selectedVariant == variant.name ? 2 : 1
                                        )
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .scrollIndicators(.hidden)

                if showApplyButton,
                   let selectedVariant = state.selectedVariant,
                   selectedVariant != state.currentVariant {
                    Button {
                        onApply?()
                    } label: {
                        HStack {
                            if state.isApplying {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .tint(.white)
                                    .scaleEffect(0.9)
                            } else {
                                Image(systemName: "checkmark.circle")
                            }
                            Text(state.isApplying ? "Updating style..." : "Apply Selected Style")
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(DesignTokens.gold)
                        .clipShape(Capsule())
                    }
                    .disabled(state.isApplying)
                } else if showApplyButton, let currentVariant = state.currentVariant {
                    Text("Current style: \(labelForVariant(currentVariant))")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else {
                Text(state.error ?? "Style previews unavailable. Default social card will be used.")
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding()
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func labelForVariant(_ variantName: String?) -> String {
        guard let variantName else { return "Default" }
        return state.previews.first(where: { $0.name == variantName })?.label ?? variantName
    }

    private func decodePreviewImage(_ dataUrl: String) -> UIImage? {
        guard let commaIndex = dataUrl.firstIndex(of: ",") else { return nil }
        let base64 = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}
