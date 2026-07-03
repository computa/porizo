import SwiftUI

/// The create wizard shell (U7). Owns the create-flow model and renders the
/// current moment. U7 fully implements the .entry steps; later moments show a
/// placeholder until U8-U10 land. Mirrors iOS WarmCanvasFlowView.
struct CreateFlowView: View {
    // Not `private` — Skip Fuse cannot bridge private @State on a bridged View.
    @State var flow: AndroidCreateFlowModel
    let onClose: () -> Void

    init(occasion: Occasion? = nil, type: CreateContentType? = nil, onClose: @escaping () -> Void) {
        let model = AndroidCreateFlowModel()
        model.reset(occasion: occasion, type: type)
        _flow = State(initialValue: model)
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                closeBar
                content
            }
        }
    }

    private var closeBar: some View {
        HStack {
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var content: some View {
        switch flow.moment {
        case .entry(.name):
            CreateNameStep(flow: flow)
        case .entry(.details):
            CreateDetailsStep(flow: flow)
        default:
            // U8-U10 placeholder — the AI conversation, lyrics, render, reveal,
            // and share are built in later units.
            VStack(spacing: 12) {
                Spacer()
                FrauncesTitle(text: "For \(flow.recipientName)", size: 24, weight: .bold)
                Text("The guided \(flow.contentType.label.lowercased()) conversation is coming next.")
                    .font(.system(size: 15))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Spacer()
            }
        }
    }
}

/// Step 1: "Who's this song for?" — type a name (contacts deferred to a later
/// native bridge; typing is the reliable floor).
struct CreateNameStep: View {
    @State var flow: AndroidCreateFlowModel

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 34))
                .foregroundStyle(PorizoAndroidTheme.gold)
            FrauncesTitle(text: whoTitle, size: 28, weight: .bold)

            PorizoTextInput(title: "Their name", text: nameBinding)
                .padding(.horizontal, 24)

            PorizoActionButton(
                title: "Continue",
                symbol: "arrow.right",
                isDisabled: !flow.canStartConversation
            ) {
                flow.confirmName()
            }
            .padding(.horizontal, 24)

            Spacer()
            Spacer()
        }
    }

    private var whoTitle: String {
        flow.contentType == .poem ? "Who's this poem for?" : "Who's this song for?"
    }

    private var nameBinding: Binding<String> {
        Binding(get: { flow.recipientName }, set: { flow.recipientName = $0 })
    }
}

/// Step 2: occasion + Song/Poem toggle → start the conversation.
struct CreateDetailsStep: View {
    @State var flow: AndroidCreateFlowModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    FrauncesTitle(text: "A few details", size: 26, weight: .bold)
                    Text("For \(flow.recipientName)")
                        .font(.system(size: 15))
                        .foregroundStyle(PorizoAndroidTheme.textSecondary)
                }

                section("Occasion") {
                    FlowLayoutPills(items: Occasion.allCases.map(\.label))
                        .allowsHitTesting(false)
                    Picker("Occasion", selection: occasionBinding) {
                        ForEach(Occasion.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                section("Type") {
                    Picker("Type", selection: typeBinding) {
                        ForEach(CreateContentType.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                PorizoActionButton(title: "Next", symbol: "arrow.right", isDisabled: !flow.canStartConversation) {
                    flow.startConversation()
                }

                Button("Back") { flow.backToName() }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
            }
            .padding(24)
        }
    }

    @ViewBuilder
    private func section(_ title: String, @ViewBuilder _ body: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
            body()
        }
    }

    private var occasionBinding: Binding<Occasion> {
        Binding(get: { flow.occasion }, set: { flow.occasion = $0 })
    }
    private var typeBinding: Binding<CreateContentType> {
        Binding(get: { flow.contentType }, set: { flow.contentType = $0 })
    }
}
