//
//  TrackCreationView.swift
//  PorizoApp
//
//  Form for creating a new personalized song.
//

import SwiftUI

struct TrackCreationView: View {
    let apiClient: APIClient
    let onTrackCreated: (String, Int) -> Void  // (trackId, versionNum)
    let onCancel: () -> Void

    // Form state
    @State private var recipientName = ""
    @State private var selectedOccasion: Occasion = .birthday
    @State private var selectedStyle: MusicStyle = .pop
    @State private var message = ""
    @State private var showAdvanced = false

    // Advanced options (story context)
    @State private var relationshipType = ""
    @State private var yearsKnown = ""
    @State private var specificMemory = ""
    @State private var specialPhrases = ""
    @State private var whatMakesThemSpecial = ""

    // UI state
    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""

    // Validation
    private var isFormValid: Bool {
        !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var characterCount: Int {
        message.count
    }

    private var characterCountColor: Color {
        if characterCount > 900 {
            return .red
        } else if characterCount > 700 {
            return .orange
        }
        return .secondary
    }

    var body: some View {
        NavigationView {
            Form {
                // Recipient Section
                Section {
                    TextField("Who is this song for?", text: $recipientName)
                        .textContentType(.name)
                        .autocapitalization(.words)
                } header: {
                    Text("Recipient")
                } footer: {
                    Text("Leave blank for \"someone special\"")
                }

                // Occasion Section
                Section("Occasion") {
                    Picker("Occasion", selection: $selectedOccasion) {
                        ForEach(Occasion.allCases) { occasion in
                            Label {
                                Text(occasion.displayName)
                            } icon: {
                                Text(occasion.emoji)
                            }
                            .tag(occasion)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                // Style Section
                Section("Music Style") {
                    Picker("Style", selection: $selectedStyle) {
                        ForEach(MusicStyle.allCases) { style in
                            Text(style.displayName).tag(style)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                // Message Section
                Section {
                    ZStack(alignment: .topLeading) {
                        if message.isEmpty {
                            Text("What do you want to say? This becomes the song...")
                                .foregroundColor(.secondary)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                        }
                        TextEditor(text: $message)
                            .frame(minHeight: 120)
                            .opacity(message.isEmpty ? 0.25 : 1)
                    }
                } header: {
                    Text("Your Message")
                } footer: {
                    HStack {
                        Text("Express your feelings - this becomes the song lyrics")
                        Spacer()
                        Text("\(characterCount)/1000")
                            .foregroundColor(characterCountColor)
                    }
                }

                // Advanced Options
                Section {
                    DisclosureGroup("Add Personal Details", isExpanded: $showAdvanced) {
                        VStack(alignment: .leading, spacing: 16) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Relationship")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., spouse, parent, friend", text: $relationshipType)
                                    .textFieldStyle(.roundedBorder)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("Years Known")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., 10", text: $yearsKnown)
                                    .textFieldStyle(.roundedBorder)
                                    .keyboardType(.numberPad)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("A Special Memory")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., The day we met at the coffee shop", text: $specificMemory)
                                    .textFieldStyle(.roundedBorder)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("Special Phrases or Inside Jokes")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., \"My sunshine\", \"Nkem\"", text: $specialPhrases)
                                    .textFieldStyle(.roundedBorder)
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text("What Makes Them Special")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., Their laughter fills every room", text: $whatMakesThemSpecial)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                } footer: {
                    Text("These details help create more personalized lyrics")
                }

                // Create Button
                Section {
                    Button {
                        createTrack()
                    } label: {
                        HStack {
                            Spacer()
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Image(systemName: "wand.and.stars")
                                Text("Create My Song")
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                    .disabled(!isFormValid || isLoading)
                    .listRowBackground(isFormValid && !isLoading ? Color.blue : Color.gray)
                    .foregroundColor(.white)
                }
            }
            .navigationTitle("Create Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Actions

    private func createTrack() {
        guard isFormValid else { return }
        guard !isLoading else { return }

        isLoading = true

        Task {
            defer { isLoading = false }

            do {
                // Build the title from occasion and recipient
                let recipient = recipientName.isEmpty ? "Someone Special" : recipientName
                let title = "\(selectedOccasion.displayName) Song for \(recipient)"

                // Parse years known
                let years: Int? = Int(yearsKnown)

                // Create track request
                let request = CreateTrackRequest(
                    title: title,
                    occasion: selectedOccasion.rawValue,
                    recipientName: recipientName.isEmpty ? nil : recipientName,
                    style: selectedStyle.rawValue,
                    durationTarget: 60,  // MVP: 60 second songs
                    voiceMode: "user_voice",
                    message: message.trimmingCharacters(in: .whitespacesAndNewlines),
                    relationshipType: relationshipType.isEmpty ? nil : relationshipType,
                    yearsKnown: years,
                    specificMemory: specificMemory.isEmpty ? nil : specificMemory,
                    specialPhrases: specialPhrases.isEmpty ? nil : specialPhrases,
                    whatMakesThemSpecial: whatMakesThemSpecial.isEmpty ? nil : whatMakesThemSpecial
                )

                // Create the track
                let trackResponse = try await apiClient.createTrack(request: request)

                // Create a version for this track
                let versionResponse = try await apiClient.createVersion(
                    trackId: trackResponse.trackId,
                    renderType: "preview"
                )

                // Success - navigate to lyrics review
                await MainActor.run {
                    onTrackCreated(trackResponse.trackId, versionResponse.versionNum)
                }

            } catch let error as APIClientError {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }
}

// MARK: - Convenience initializer for legacy TrackCreationView

extension CreateTrackRequest {
    init(
        title: String,
        occasion: String,
        recipientName: String?,
        style: String,
        durationTarget: Int,
        voiceMode: String,
        message: String,
        relationshipType: String?,
        yearsKnown: Int?,
        specificMemory: String?,
        specialPhrases: String?,
        whatMakesThemSpecial: String?
    ) {
        self.title = title
        self.occasion = occasion
        self.recipientName = recipientName ?? ""
        self.style = style
        self.durationTarget = durationTarget
        self.voiceMode = voiceMode
        self.message = message
        self.relationshipType = relationshipType
        self.yearsKnown = yearsKnown
        self.specificMemory = specificMemory
        self.memoryAnswers = nil  // No memory answers in legacy form
        self.specialPhrases = specialPhrases
        self.whatMakesThemSpecial = whatMakesThemSpecial
    }
}

#Preview {
    TrackCreationView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onTrackCreated: { _, _ in },
        onCancel: { }
    )
}
