import Foundation
import Observation
import SkipFuse

/// A node type in the onboarding question graph (subset of iOS
/// QuestionGraphEngine's types — enough for parity behavior).
enum OnboardingNodeType: String, Codable, Sendable {
    case multiSelect
    case singleSelect
    case textInput
    case terminal
}

/// One selectable option on a select node.
struct OnboardingOption: Identifiable, Equatable, Sendable {
    let label: String
    let value: String
    var id: String { value }
}

/// A single graph node. `next` may contain `{relationship_type}` which resolves
/// against accumulated answers (mirrors iOS `emotional_seed_{relationship_type}`).
struct OnboardingNode: Identifiable, Sendable {
    let id: String
    let type: OnboardingNodeType
    let question: String
    /// `{relationship_label}`/`{name}` placeholders resolved at display time.
    let questionTemplate: String?
    let options: [OnboardingOption]
    let minSelections: Int
    let next: String?
}

/// The onboarding graph: entry node + node table.
struct OnboardingGraph: Sendable {
    let entryNode: String
    let nodes: [String: OnboardingNode]

    /// A compact default graph: goal → relationship → name → done. Simplified
    /// from iOS's per-relationship emotional-seed branches (plan: "simplify
    /// branches as needed"); the engine mechanics are the parity target.
    static let `default` = OnboardingGraph(
        entryNode: "goal",
        nodes: [
            "goal": OnboardingNode(
                id: "goal", type: .singleSelect,
                question: "What brought you here today?",
                questionTemplate: nil,
                options: [
                    OnboardingOption(label: "Surprise someone for their birthday", value: "birthday_surprise"),
                    OnboardingOption(label: "Say something I've never been able to say", value: "unsaid_words"),
                    OnboardingOption(label: "Create a gift that means something", value: "meaningful_gift"),
                ],
                minSelections: 1, next: "relationship"
            ),
            "relationship": OnboardingNode(
                id: "relationship", type: .singleSelect,
                question: "Who deserves something unforgettable?",
                questionTemplate: nil,
                options: [
                    OnboardingOption(label: "Mom", value: "mom"),
                    OnboardingOption(label: "Dad", value: "dad"),
                    OnboardingOption(label: "Partner", value: "partner"),
                    OnboardingOption(label: "Best Friend", value: "best_friend"),
                    OnboardingOption(label: "Someone Else", value: "other"),
                ],
                minSelections: 1, next: "name"
            ),
            "name": OnboardingNode(
                id: "name", type: .textInput,
                question: "Who is this for?",
                questionTemplate: "What's your {relationship_label}'s name?",
                options: [], minSelections: 0, next: "done"
            ),
            "done": OnboardingNode(
                id: "done", type: .terminal,
                question: "You're all set.",
                questionTemplate: nil, options: [], minSelections: 0, next: nil
            ),
        ]
    )
}

/// Pure graph engine: navigation, template resolution, answer accumulation,
/// recipient capture. No UI. Unit-tested on the host.
final class OnboardingGraphEngine {
    private let graph: OnboardingGraph
    private(set) var currentNodeId: String
    private var history: [String] = []
    private var answers: [String: String] = [:]

    init(graph: OnboardingGraph) {
        self.graph = graph
        self.currentNodeId = graph.entryNode
    }

    var currentNode: OnboardingNode {
        graph.nodes[currentNodeId] ?? graph.nodes[graph.entryNode]!
    }

    var isComplete: Bool { currentNode.type == .terminal }

    /// The captured recipient name (nil when blank).
    var recipientName: String? {
        guard let name = answers["name"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty else { return nil }
        return name
    }

    /// The question to show, with `{relationship_label}`/`{name}` resolved.
    var currentQuestion: String {
        guard let template = currentNode.questionTemplate else { return currentNode.question }
        let resolved = template
            .replacingOccurrences(of: "{relationship_label}", with: relationshipLabel ?? "them")
            .replacingOccurrences(of: "{name}", with: recipientName ?? "them")
        return resolved
    }

    private var relationshipLabel: String? {
        guard let value = answers["relationship"],
              let option = graph.nodes["relationship"]?.options.first(where: { $0.value == value })
        else { return nil }
        return option.label
    }

    /// Record a single-select answer and advance.
    func answerSingle(value: String) {
        answers[currentNodeId] = value
        advance()
    }

    /// Record a text answer and advance. Blank text still advances.
    func answerText(_ text: String) {
        answers[currentNodeId] = text
        advance()
    }

    /// Step back to the previous node (no-op at entry).
    func back() {
        guard let previous = history.popLast() else { return }
        currentNodeId = previous
    }

    private func advance() {
        guard let rawNext = currentNode.next else { return }
        // Resolve any {relationship_type}-style placeholder against answers.
        let next = rawNext.replacingOccurrences(
            of: "{relationship_type}", with: answers["relationship"] ?? ""
        )
        guard graph.nodes[next] != nil else { return }
        history.append(currentNodeId)
        currentNodeId = next
    }
}

/// @Observable shell driving the onboarding view. Skip/Compose only recomposes
/// on reads of the model's own *stored* properties, so `currentNodeId` is a
/// stored @Observable property (a computed passthrough to a hidden engine would
/// never invalidate the view). Each answer reassigns it, triggering re-render.
@MainActor
@Observable
final class AndroidOnboardingModel {
    private let engine = OnboardingGraphEngine(graph: OnboardingGraph.default)
    /// The observed state: reassigned on every answer so `body` re-renders.
    private(set) var currentNodeId: String

    init() {
        currentNodeId = engine.currentNodeId
    }

    // These read `currentNodeId` first so SwiftUI/Skip records the dependency on
    // the stored @Observable property — otherwise a pure engine passthrough
    // would never invalidate the view on Compose.
    var currentNode: OnboardingNode {
        _ = currentNodeId
        return engine.currentNode
    }
    var currentQuestion: String {
        _ = currentNodeId
        return engine.currentQuestion
    }
    var isComplete: Bool {
        _ = currentNodeId
        return engine.isComplete
    }
    var recipientName: String? { engine.recipientName }

    func answerSingle(value: String) { engine.answerSingle(value: value); sync() }
    func answerText(_ text: String) { engine.answerText(text); sync() }
    func back() { engine.back(); sync() }

    private func sync() { currentNodeId = engine.currentNodeId }
}
