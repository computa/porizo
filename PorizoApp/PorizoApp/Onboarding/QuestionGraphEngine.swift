//
//  QuestionGraphEngine.swift
//  PorizoApp
//
//  Interprets the bundled onboarding question graph JSON.
//  Manages navigation, template resolution, and answer accumulation.
//  Generic — knows nothing about specific screens.
//

import Foundation

// MARK: - Graph Data Model

struct OnboardingGraph: Codable {
    let version: Int
    let entryNode: String
    let nodes: [String: GraphNode]

    enum CodingKeys: String, CodingKey {
        case version
        case entryNode = "entry_node"
        case nodes
    }
}

enum GraphNodeType: String, Codable {
    case multiSelect = "multi_select"
    case singleSelect = "single_select"
    case textInput = "text_input"
    case singleSelectOrText = "single_select_or_text"
    case terminal
}

struct GraphNodeOption: Codable, Identifiable {
    let label: String
    let value: String?
    let emoji: String?
    let isDefault: Bool?

    var id: String { value ?? label }

    enum CodingKeys: String, CodingKey {
        case label, value, emoji
        case isDefault = "is_default"
    }
}

struct GraphNode: Codable {
    let type: GraphNodeType
    let question: String?
    let subtitle: String?
    let options: [GraphNodeOption]?
    let minSelections: Int?
    let questionTemplate: String?
    let fallbackQuestion: String?
    let allowFreeText: Bool?
    let next: String?
    let action: String?

    enum CodingKeys: String, CodingKey {
        case type, question, subtitle, options, next, action
        case minSelections = "min_selections"
        case questionTemplate = "question_template"
        case fallbackQuestion = "fallback_question"
        case allowFreeText = "allow_free_text"
    }
}

// MARK: - Accumulated Answers

struct OnboardingAnswers {
    var painPoints: [String] = []
    var goalIntent: String?
    var relationshipType: String?
    var recipientName: String?
    var emotionalSeed: String?
    var occasion: String?
}

// MARK: - Suggestion Request / Response

struct OnboardingSuggestionRequest: Codable, Sendable {
    let recipientName: String
    let relationshipType: String
    let emotionalSeed: String
    let occasion: String?

    enum CodingKeys: String, CodingKey {
        case recipientName = "recipient_name"
        case relationshipType = "relationship_type"
        case emotionalSeed = "emotional_seed"
        case occasion
    }
}

/// Server response alias — decoded directly into `OnboardingSuggestion`.
typealias OnboardingSuggestionResponse = OnboardingSuggestion

// MARK: - QuestionGraphEngine

@MainActor @Observable
final class QuestionGraphEngine {
    private(set) var currentNodeId: String
    private(set) var answers: OnboardingAnswers
    private let graph: OnboardingGraph

    /// Human-readable label for the selected relationship (e.g. "Mom", "Partner")
    private var relationshipLabel: String?

    var currentNode: GraphNode? { graph.nodes[currentNodeId] }
    var isTerminal: Bool { currentNode?.type == .terminal }

    init(graph: OnboardingGraph) {
        self.graph = graph
        self.currentNodeId = graph.entryNode
        self.answers = OnboardingAnswers()
    }

    // MARK: - Navigation

    /// Advance to the next node. Returns false if already at terminal.
    @discardableResult
    func advance() -> Bool {
        guard let node = currentNode, node.type != .terminal else { return false }
        guard let nextId = resolveNextNodeId(from: node) else {
            #if DEBUG
            print("[QuestionGraphEngine] No next node ID resolved from '\(currentNodeId)' (next: \(node.next ?? "nil"))")
            #endif
            return false
        }
        guard graph.nodes[nextId] != nil else {
            #if DEBUG
            print("[QuestionGraphEngine] Resolved next ID '\(nextId)' not found in graph nodes (from '\(currentNodeId)')")
            #endif
            return false
        }
        currentNodeId = nextId
        return true
    }

    // MARK: - Answer Setters

    /// For single_select nodes. Stores answer based on current node, then advances.
    func selectSingle(_ value: String?) {
        guard let node = currentNode else { return }
        storeAnswer(nodeId: currentNodeId, node: node, value: value)
    }

    /// For multi_select nodes. Stores all selections. Caller triggers advance().
    func selectMultiple(_ values: [String]) {
        switch currentNodeId {
        case "pain_points":
            answers.painPoints = values
        default:
            break
        }
    }

    /// For text_input nodes. Stores text. Caller triggers advance().
    func enterText(_ value: String) {
        guard let node = currentNode else { return }
        storeAnswer(nodeId: currentNodeId, node: node, value: value)
    }

    // MARK: - Template Resolution

    /// Resolves {name}, {relationship_label}, {relationship_type} in a template string.
    func resolve(_ template: String) -> String {
        var result = template
        if let name = answers.recipientName {
            result = result.replacingOccurrences(of: "{name}", with: name)
        }
        if let label = relationshipLabel {
            result = result.replacingOccurrences(of: "{relationship_label}", with: label)
        }
        if let type = answers.relationshipType {
            result = result.replacingOccurrences(of: "{relationship_type}", with: type)
        }
        return result
    }

    /// The resolved question for the current node (handles both `question` and `questionTemplate`).
    var resolvedQuestion: String {
        guard let node = currentNode else { return "" }
        if let template = node.questionTemplate {
            let resolved = resolve(template)
            // If template tokens remain unresolved, use fallback
            if resolved.contains("{") {
                return node.fallbackQuestion ?? resolved
            }
            return resolved
        }
        return node.question ?? ""
    }

    // MARK: - Suggestion Payload

    var suggestionPayload: OnboardingSuggestionRequest {
        OnboardingSuggestionRequest(
            recipientName: answers.recipientName ?? "",
            relationshipType: answers.relationshipType ?? "",
            emotionalSeed: answers.emotionalSeed ?? "",
            occasion: answers.occasion
        )
    }

    // MARK: - Private

    private func storeAnswer(nodeId: String, node: GraphNode, value: String?) {
        switch nodeId {
        case "goal_question":
            answers.goalIntent = value
        case "relationship_picker":
            answers.relationshipType = value
            // Store human label from the option
            relationshipLabel = node.options?.first(where: { $0.value == value })?.label
        case "name_entry":
            answers.recipientName = value
        case "occasion_picker":
            answers.occasion = value  // nil for "Just Because"
        default:
            // Emotional seed nodes
            if nodeId.hasPrefix("emotional_seed_") {
                answers.emotionalSeed = value
            }
        }
    }

    private func resolveNextNodeId(from node: GraphNode) -> String? {
        guard let next = node.next else { return nil }
        if next.contains("{") {
            return resolve(next)
        }
        return next
    }

    // MARK: - Graph Loading

    static func loadBundled() -> OnboardingGraph {
        guard let url = Bundle.main.url(forResource: "onboarding-graph", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: data) else {
            assertionFailure("onboarding-graph.json missing or corrupt in bundle")
            // Minimal fallback: single-node graph that goes straight to payoff
            return OnboardingGraph(version: 0, entryNode: "payoff", nodes: [
                "payoff": GraphNode(type: .terminal, question: nil, subtitle: nil, options: nil, minSelections: nil, questionTemplate: nil, fallbackQuestion: nil, allowFreeText: nil, next: nil, action: "generate_suggestion")
            ])
        }
        return graph
    }

    static func loadWithServerOverride(version: Int?, url: String?) async -> OnboardingGraph {
        let bundled = loadBundled()
        guard let serverVersion = version, serverVersion > bundled.version,
              let urlString = url, let fetchURL = URL(string: urlString) else {
            return bundled
        }
        let cacheKey = "onboarding_graph_cache"
        let cacheVersionKey = "onboarding_graph_cache_version"
        // Check if we already have this version cached
        if UserDefaults.standard.integer(forKey: cacheVersionKey) == serverVersion,
           let cached = UserDefaults.standard.data(forKey: cacheKey),
           let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: cached) {
            return graph
        }
        guard let data = try? await URLSession.shared.data(from: fetchURL).0,
              let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: data) else {
            return bundled
        }
        UserDefaults.standard.set(data, forKey: cacheKey)
        UserDefaults.standard.set(serverVersion, forKey: cacheVersionKey)
        return graph
    }
}
