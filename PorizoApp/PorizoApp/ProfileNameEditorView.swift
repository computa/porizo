import SwiftUI

struct ProfileNameEditorView: View {
    let presentation: ProfileNameEditorPresentation
    let apiClient: APIClient
    let fixtureSaveError: String?

    @Environment(AuthManager.self) private var authManager
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var isNameFieldFocused: Bool

    init(
        presentation: ProfileNameEditorPresentation,
        apiClient: APIClient,
        initialErrorMessage: String? = nil,
        fixtureSaveError: String? = nil
    ) {
        self.presentation = presentation
        self.apiClient = apiClient
        self.fixtureSaveError = fixtureSaveError
        _name = State(initialValue: presentation.initialName)
        _errorMessage = State(initialValue: initialErrorMessage)
    }

    private var validation: ProfileNameValidation { validateProfileName(name) }
    private var inputLength: Int {
        name.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
    }

    private var title: String {
        presentation.mode == .initialPrompt ? "What should we call you?" : "Edit your name"
    }

    private var subtitle: String {
        presentation.mode == .initialPrompt
            ? "Add the name you want to see around Porizo."
            : "This is the name shown on your Porizo account."
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.spacing24) {
                    VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                        Text(title)
                            .font(DesignTokens.displayFont(size: 28, relativeTo: .title))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text(subtitle)
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                        TextField("Your name", text: $name)
                            .textContentType(.name)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .focused($isNameFieldFocused)
                            .font(.body)
                            .padding(.horizontal, DesignTokens.spacing16)
                            .padding(.vertical, DesignTokens.spacing12)
                            .background(DesignTokens.inputBackground)
                            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
                            .overlay {
                                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                            }
                            .accessibilityIdentifier("profileNameEditor.nameField")
                            .onSubmit(submitIfValid)

                        HStack(alignment: .firstTextBaseline) {
                            if case .tooLong = validation {
                                Text("Use 100 characters or fewer.")
                                    .foregroundStyle(DesignTokens.error)
                            } else {
                                Text("Names can be up to 100 characters.")
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            Text("\(inputLength)/100")
                                .foregroundStyle(inputLength > 100 ? DesignTokens.error : .secondary)
                        }
                        .font(.footnote)
                        .accessibilityElement(children: .combine)
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(DesignTokens.error)
                            .accessibilityIdentifier("profileNameEditor.error")
                    }

                    VelvetButton(
                        isSaving ? "Saving…" : "Save",
                        isLoading: isSaving,
                        isDisabled: validation.message != nil || isSaving,
                        accessibilityLabel: isSaving ? "Saving name" : "Save name"
                    ) {
                        Task { await save() }
                    }
                    .accessibilityIdentifier("profileNameEditor.saveButton")
                }
                .padding(DesignTokens.spacing20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(presentation.mode == .initialPrompt ? "Not now" : "Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier(
                        presentation.mode == .initialPrompt
                            ? "profileNameEditor.notNowButton"
                            : "profileNameEditor.cancelButton"
                    )
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .presentationDetents([.medium, .large])
        .task {
            await Task.yield()
            isNameFieldFocused = true
        }
    }

    private func submitIfValid() {
        guard validation.message == nil, !isSaving else { return }
        Task { await save() }
    }

    @MainActor
    private func save() async {
        guard case .valid(let trimmedName) = validation, !isSaving else { return }
        if let fixtureSaveError {
            isSaving = true
            errorMessage = nil
            errorMessage = fixtureSaveError
            isSaving = false
            return
        }
        guard authManager.isAuthenticated,
              authManager.currentUser?.id == presentation.userID else {
            errorMessage = "Your signed-in account changed. Reopen this editor and try again."
            return
        }
        isSaving = true
        errorMessage = nil

        do {
            let updatedUser = try await apiClient.updateProfile(
                expectedUserId: presentation.userID,
                displayName: trimmedName
            )
            guard shouldApplyProfileNameUpdate(
                expectedUserID: presentation.userID,
                currentUserID: authManager.currentUser?.id,
                responseUserID: updatedUser.id
            ) else {
                errorMessage = "Your signed-in account changed. Reopen this editor and try again."
                isSaving = false
                return
            }
            authManager.updateCurrentUser(updatedUser)
            isSaving = false
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

#Preview("Missing name") {
    ProfileNameEditorView(
        presentation: ProfileNameEditorPresentation(
            userID: "preview-empty",
            initialName: "",
            mode: .initialPrompt
        ),
        apiClient: APIClient(baseURL: "http://localhost:0")
    )
    .environment(AuthManager())
}

#Preview("Existing name") {
    ProfileNameEditorView(
        presentation: ProfileNameEditorPresentation(
            userID: "preview-existing",
            initialName: "Ambrose",
            mode: .accountEdit
        ),
        apiClient: APIClient(baseURL: "http://localhost:0")
    )
    .environment(AuthManager())
}

#Preview("Recoverable error") {
    ProfileNameEditorView(
        presentation: ProfileNameEditorPresentation(
            userID: "preview-error",
            initialName: "Ambrose",
            mode: .accountEdit
        ),
        apiClient: APIClient(baseURL: "http://localhost:0"),
        initialErrorMessage: "We couldn't save your name. Try again."
    )
    .environment(AuthManager())
    .environment(\.dynamicTypeSize, .accessibility2)
}
