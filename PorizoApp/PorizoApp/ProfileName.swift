import Foundation

enum ProfileNameEditorMode: String {
    case initialPrompt
    case accountEdit
}

struct ProfileNameEditorPresentation: Identifiable, Equatable {
    let userID: String
    let initialName: String
    let mode: ProfileNameEditorMode

    var id: String { "\(mode.rawValue)-\(userID)" }
}

struct ProfileNamePromptEvaluation: Hashable {
    let userID: String?
    let displayName: String?
    let isAuthenticated: Bool
    let hasValidatedSession: Bool
    let isMain: Bool
    let hasHigherPriorityPresentation: Bool
    let fixtureID: String?
}

enum ProfileNameValidation: Equatable {
    case valid(String)
    case empty
    case tooLong

    var message: String? {
        switch self {
        case .valid:
            return nil
        case .empty:
            return "Enter a name."
        case .tooLong:
            return "Use 100 characters or fewer."
        }
    }
}

func validateProfileName(_ input: String) -> ProfileNameValidation {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .empty }
    guard trimmed.utf16.count <= 100 else { return .tooLong }
    return .valid(trimmed)
}

func shouldApplyProfileNameUpdate(
    expectedUserID: String,
    currentUserID: String?,
    responseUserID: String
) -> Bool {
    currentUserID == expectedUserID && responseUserID == expectedUserID
}
