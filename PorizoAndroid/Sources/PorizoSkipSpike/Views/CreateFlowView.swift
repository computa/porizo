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
        case .conversing:
            StoryConversationView(flow: flow)
        default:
            // U9-U10 placeholder — lyrics review, render, reveal, and share
            // are built in later units.
            VStack(spacing: 12) {
                Spacer()
                FrauncesTitle(text: "For \(flow.recipientName)", size: 24, weight: .bold)
                Text("Creating your \(flow.contentType.label.lowercased())…")
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

/// The AI story conversation (U8): chat bubbles + input bar + Create.
struct StoryConversationView: View {
    @State var flow: AndroidCreateFlowModel
    @State var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ChatHeader(recipient: flow.recipientName, occasion: flow.occasion.label)
                    ForEach(flow.messages) { message in
                        ChatBubble(message: message)
                    }
                    if flow.isSending {
                        Text("…")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(PorizoAndroidTheme.textTertiary)
                    }
                    if let error = flow.conversationError {
                        PorizoStatusText(text: error)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }

            if flow.canFinish {
                PorizoActionButton(
                    title: "Create \(flow.contentType.label.lowercased())",
                    symbol: "checkmark.circle",
                    isDisabled: flow.isSending
                ) {
                    Task { await flow.finish() }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }

            inputBar
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            PorizoTextInput(title: "Share a detail…", text: draftBinding)
            Button {
                let answer = draft
                draft = ""
                Task { await flow.sendAnswer(answer) }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(canSend ? PorizoAndroidTheme.gold : PorizoAndroidTheme.textTertiary)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(PorizoAndroidTheme.surface)
    }

    private var canSend: Bool {
        !flow.isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var draftBinding: Binding<String> {
        Binding(get: { draft }, set: { draft = $0 })
    }
}

// Not `private` — Skip Fuse cannot bridge private views.
struct ChatHeader: View {
    let recipient: String
    let occasion: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            FrauncesTitle(text: "For \(recipient)", size: 20, weight: .bold)
            Text(occasion)
                .font(.system(size: 13))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
        }
        .padding(.bottom, 6)
    }
}

struct ChatBubble: View {
    let message: StoryMessage
    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.text)
                .font(.system(size: 15))
                .foregroundStyle(message.role == .user ? Color.white : PorizoAndroidTheme.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.role == .user ? PorizoAndroidTheme.gold : PorizoAndroidTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }
}
