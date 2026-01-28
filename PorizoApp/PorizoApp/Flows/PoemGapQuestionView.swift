//
//  PoemGapQuestionView.swift
//  PorizoApp
//
//  Collects a missing detail for poem readiness.
//

import SwiftUI

struct PoemGapQuestionView: View {
    let question: String
    let onSubmit: (String) -> Void
    let onCancel: () -> Void

    @State private var answer: String = ""
    @State private var isSubmitting = false

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 24) {
                    VStack(spacing: 8) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 40))
                            .foregroundColor(DesignTokens.gold)

                        Text("One more detail")
                            .font(.title2.bold())
                            .foregroundColor(DesignTokens.textPrimary)

                        Text(question)
                            .font(.body)
                            .foregroundColor(DesignTokens.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    TextEditor(text: $answer)
                        .font(.body)
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.gold)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 140)
                        .padding(12)
                        .background(DesignTokens.surface)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                        )
                        .padding(.horizontal)

                    Spacer()
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Button {
                        isSubmitting = true
                        onSubmit(answer)
                    } label: {
                        HStack {
                            if isSubmitting {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text("Continue")
                                .font(.headline)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(canSubmit ? DesignTokens.gold : DesignTokens.borderSubtle)
                        .cornerRadius(12)
                    }
                    .disabled(!canSubmit || isSubmitting)

                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundColor(DesignTokens.textSecondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(DesignTokens.surface)
            }
            .navigationTitle("Finish Your Story")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var canSubmit: Bool {
        !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

#Preview {
    PoemGapQuestionView(
        question: "Where did this happen?",
        onSubmit: { _ in },
        onCancel: { }
    )
}
