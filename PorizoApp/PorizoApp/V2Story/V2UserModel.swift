import Foundation

struct V2UserModel: Equatable, Codable {
    let style: UserStyle
    let fatigueSignals: Int
    let tonePreference: String

    enum UserStyle: String, CaseIterable, Codable {
        case brief
        case verbose
        case emotional
        case analytical
        case unknown

        var displayName: String {
            switch self {
            case .brief: return "Brief"
            case .verbose: return "Detailed"
            case .emotional: return "Emotional"
            case .analytical: return "Analytical"
            case .unknown: return "Adapting..."
            }
        }
    }

    static let initial = V2UserModel(
        style: .unknown,
        fatigueSignals: 0,
        tonePreference: "neutral"
    )
}
