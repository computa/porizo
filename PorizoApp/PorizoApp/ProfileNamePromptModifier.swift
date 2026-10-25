import SwiftUI

struct ProfileNamePromptModifier: ViewModifier {
    @Binding var presentation: ProfileNameEditorPresentation?
    let apiClient: APIClient
    let evaluation: ProfileNamePromptEvaluation
    let currentUserID: String?
    let isAuthenticated: Bool
    let higherPriorityPresentationID: String?
    let onEvaluate: @MainActor () -> Void
    let onLogout: () -> Void

    @Environment(AuthManager.self) private var authManager

    func body(content: Content) -> some View {
        content
            .sheet(item: $presentation) { item in
                ProfileNameEditorView(
                    presentation: item,
                    apiClient: apiClient,
                    fixtureSaveError: item.userID.hasPrefix("fixture-")
                        ? "Fixture save failed as expected. Your name is still here so you can retry."
                        : nil
                )
                .environment(authManager)
            }
            .task(id: evaluation) {
                await Task.yield()
                onEvaluate()
            }
            .onChange(of: currentUserID) { _, newUserID in
                guard presentation?.userID != newUserID else { return }
                presentation = nil
            }
            .onChange(of: isAuthenticated) { _, newValue in
                guard !newValue else { return }
                presentation = nil
                onLogout()
            }
            .onChange(of: higherPriorityPresentationID) { _, identifier in
                if identifier != nil { presentation = nil }
            }
    }
}
