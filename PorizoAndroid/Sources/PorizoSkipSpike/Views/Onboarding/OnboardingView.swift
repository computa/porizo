import SwiftUI

/// U11 onboarding: a short question graph shown before the tabs on first launch.
/// Ports the iOS OnboardingV2View shape (simplified graph). On completion it
/// calls `onComplete(recipientName)` so the root can persist the flag + seed a
/// first-create suggestion.
struct OnboardingView: View {
    @State var model = AndroidOnboardingModel()
    @State var draft = ""
    let onComplete: (String?) -> Void

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 24) {
                header
                question
                Spacer()
                nodeBody
            }
            .padding(24)
        }
        .onChange(of: model.isComplete) { _, done in
            if done { onComplete(model.recipientName) }
        }
    }

    private var header: some View {
        HStack {
            if model.currentNode.id != OnboardingGraph.default.entryNode {
                Button("Back") { model.back() }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
            }
            Spacer()
            Button("Skip") { onComplete(nil) }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(PorizoAndroidTheme.textTertiary)
        }
        .padding(.top, 8)
    }

    private var question: some View {
        FrauncesTitle(text: model.currentQuestion, size: 28, weight: .bold)
    }

    @ViewBuilder
    private var nodeBody: some View {
        switch model.currentNode.type {
        case .singleSelect, .multiSelect:
            VStack(spacing: 10) {
                ForEach(model.currentNode.options) { option in
                    Button {
                        model.answerSingle(value: option.value)
                    } label: {
                        Text(option.label)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(PorizoAndroidTheme.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(PorizoAndroidTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
                            .overlay(
                                RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium)
                                    .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        case .textInput:
            VStack(spacing: 14) {
                PorizoTextInput(title: "Their name", text: draftBinding)
                PorizoActionButton(title: "Continue", symbol: "arrow.right") {
                    model.answerText(draft)
                }
            }
        case .terminal:
            EmptyView()
        }
    }

    private var draftBinding: Binding<String> {
        Binding(get: { draft }, set: { draft = $0 })
    }
}
