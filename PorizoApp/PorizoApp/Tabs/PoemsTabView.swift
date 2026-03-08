//
//  PoemsTabView.swift
//  PorizoApp
//
//  Poems tab matching v1.pen "11 - Poems Library" design.
//  Velvet & Gold design system with custom header.
//

import SwiftUI

private enum PoemLibraryFilter: String, CaseIterable {
    case created = "My Poems"
    case received = "Received"
}

// MARK: - Poems Tab View

struct PoemsTabView: View {
    let apiClient: APIClient
    var onCreatePoem: (() -> Void)?
    var onCreateVariation: ((Poem) -> Void)?
    @ObservedObject var playerState: PlayerState

    @State private var poems: [Poem] = []
    @State private var selectedFilter: PoemLibraryFilter = .created
    @State private var isLoading = true
    @State private var loadError: Error?
    @State private var selectedPoem: Poem?
    @State private var showPoemDetail = false
    @State private var cacheLoaded = false

    // Delete confirmation
    @State private var poemToDelete: Poem?
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false

    // Task cancellation
    @State private var loadTask: Task<Void, Never>?

    private var hasReceivedPoems: Bool {
        poems.contains { $0.isReceived }
    }

    private var filteredPoems: [Poem] {
        switch selectedFilter {
        case .created: return poems.filter { !$0.isReceived }
        case .received: return poems.filter { $0.isReceived }
        }
    }

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header: "My Poems" + filter button
                poemsHeader

                Group {
                    if isLoading {
                        loadingView
                    } else if loadError != nil {
                        errorStateView
                    } else if poems.isEmpty {
                        emptyStateView
                    } else {
                        VStack(spacing: 0) {
                            poemFilterPicker
                            if filteredPoems.isEmpty && selectedFilter == .received {
                                receivedEmptyStateView
                            } else if filteredPoems.isEmpty && selectedFilter == .created {
                                emptyStateView
                            } else {
                                poemListView
                            }
                        }
                    }
                }
                .padding(.bottom, playerState.currentTrack != nil ? 80 : 0)
            }
        }
        .sheet(isPresented: $showPoemDetail) {
            if let poem = selectedPoem {
                PoemDetailView(
                    poem: poem,
                    apiClient: apiClient,
                    onDelete: { deletedPoem in
                        poems.removeAll { $0.id == deletedPoem.id }
                    },
                    onCreateVariation: onCreateVariation != nil ? { poemForVariation in
                        showPoemDetail = false
                        onCreateVariation?(poemForVariation)
                    } : nil
                )
            }
        }
        .alert("Delete Poem?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {
                poemToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let poem = poemToDelete {
                    deletePoem(poem)
                }
            }
        } message: {
            if let poem = poemToDelete {
                Text("Remove \"\(poem.title)\" from your library?")
            }
        }
        .onAppear {
            if poems.isEmpty && loadError == nil {
                loadTask = Task {
                    await loadPoems()
                }
            }
        }
        .onDisappear {
            loadTask?.cancel()
        }
        .onReceive(NotificationCenter.default.publisher(for: .poemLibraryDidChange)) { _ in
            loadTask = Task { await loadPoems() }
        }
    }

    // MARK: - Header (v1.pen design)

    private var poemsHeader: some View {
        HStack {
            Text("My Poems")
                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(DesignTokens.gold)
            Text("Loading poems...")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: - Error State

    private var errorStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Error icon
            ZStack {
                Circle()
                    .fill(DesignTokens.warning.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.warning)
            }

            VStack(spacing: 8) {
                Text("Couldn't Load Poems")
                    .font(DesignTokens.bodyFont(size: 20, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Check your connection and try again")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                loadError = nil
                isLoading = true
                Task {
                    await loadPoems()
                }
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(DesignTokens.background)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .cornerRadius(25)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon with gold theme
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "scroll")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.gold)
            }

            VStack(spacing: 8) {
                Text("No Poems Yet")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Express your feelings through\nbeautifully crafted words")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // CTA Button - gold
            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onCreatePoem?()
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Create Your First Poem")
                }
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(DesignTokens.background)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .cornerRadius(25)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Library Filter Picker

    private var poemFilterPicker: some View {
        Picker("Filter", selection: $selectedFilter) {
            ForEach(PoemLibraryFilter.allCases, id: \.self) { filter in
                Text(filter.rawValue).tag(filter)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .tint(DesignTokens.gold)
    }

    // MARK: - Received Empty State

    private var receivedEmptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.12))
                    .frame(width: 100, height: 100)

                Image(systemName: "envelope.open")
                    .font(.system(size: 40))
                    .foregroundColor(DesignTokens.gold)
            }

            VStack(spacing: 6) {
                Text("No received poems yet")
                    .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Poems shared with you will appear here")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Poem List

    private var poemListView: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(filteredPoems) { poem in
                    PoemCard(poem: poem, onTap: {
                        selectedPoem = poem
                        showPoemDetail = true
                    }, onDelete: {
                        poemToDelete = poem
                        showDeleteConfirmation = true
                    })
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 120) // Space for tab bar
        }
        .refreshable {
            await loadPoems()
        }
    }

    // MARK: - Load Poems

    private func loadPoems() async {
        if !cacheLoaded {
            await loadCachedPoems()
        }
        isLoading = true
        loadError = nil

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadPoems") {
                try await apiClient.getPoems()
            }
            poems = response.poems
            LocalCache.shared.savePoems(response.poems)
            isLoading = false
        } catch {
            print("[PoemsTab] Failed to load poems: \(error)")
            if poems.isEmpty {
                loadError = error
            } else {
                loadError = nil
            }
            isLoading = false
        }
    }

    private func loadCachedPoems() async {
        cacheLoaded = true
        if let cached = LocalCache.shared.loadPoems() {
            poems = cached.data
            isLoading = false
            loadError = nil
        }
    }

    private func deletePoem(_ poem: Poem) {
        isDeleting = true

        Task {
            do {
                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "deletePoem") {
                    try await apiClient.deletePoem(poemId: poem.id)
                }
                await MainActor.run {
                    withAnimation(.easeOut(duration: 0.25)) {
                        poems.removeAll { $0.id == poem.id }
                    }
                    poemToDelete = nil
                    isDeleting = false
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.success)
                }
            } catch {
                print("[PoemsTab] Failed to delete poem: \(error)")
                await MainActor.run {
                    poemToDelete = nil
                    isDeleting = false
                    ToastService.shared.error("Failed to delete poem")
                }
            }
        }
    }
}

// MARK: - Poem Card (v1.pen "11 - Poems Library" design)

struct PoemCard: View {
    let poem: Poem
    let onTap: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        Button {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            onTap()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                // Line 1: Title + Occasion tag
                HStack(spacing: 6) {
                    Text(poem.title)
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .lineLimit(1)

                    Spacer()

                    // Gold occasion tag
                    if let occasion = Occasion(rawValue: poem.occasion) {
                        Text(occasion.displayName)
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundColor(DesignTokens.gold)
                    }
                }

                // Line 2: Recipient
                Text("For \(poem.recipientName)")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)

                // Line 3: Preview text (italic serif)
                Text("\"\(poem.previewLines)...\"")
                    .font(DesignTokens.displayFont(size: 14))
                    .italic()
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(2)
            }
            .padding(14)
            .background(DesignTokens.surface)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(poem.title), for \(poem.recipientName)")
        .accessibilityHint("Double tap to view full poem")
        .contextMenu {
            if let onDelete = onDelete {
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Remove from Library", systemImage: "trash")
                }
            }
        }
    }

    // MARK: - Status Badge

    @ViewBuilder
    private var statusBadge: some View {
        if poem.status == "complete" {
            Text("Complete")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.statusSuccess)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.statusSuccessBg)
                .cornerRadius(10)
        } else {
            Text("Draft")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textTertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
                .cornerRadius(10)
        }
    }
}

// MARK: - Poem Detail View (Velvet design)

struct PoemDetailView: View {
    let poem: Poem
    let apiClient: APIClient
    var onDelete: ((Poem) -> Void)?
    var onCreateVariation: ((Poem) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var activeSheet: ActiveSheet?
    @State private var isGeneratingAudio = false

    private var canSharePoem: Bool {
        poem.canShare ?? true
    }

    private enum ActiveSheet: String, Identifiable {
        case actionMenu
        case sharePoem

        var id: String { rawValue }
    }

    var body: some View {
        ZStack {
            PoemFullView(
                poem: poem,
                onBack: { dismiss() },
                onMenu: { activeSheet = .actionMenu },
                onListen: { listenToPoem() },
                onShare: {
                    guard canSharePoem else {
                        ToastService.shared.error("Only the creator can share this poem.")
                        return
                    }
                    activeSheet = .sharePoem
                }
            )
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .actionMenu:
                PoemActionMenu(
                    poem: poem,
                    canShare: canSharePoem,
                    onListen: { listenToPoem() },
                    onShare: { activeSheet = .sharePoem },
                    onDelete: {
                        onDelete?(poem)
                        activeSheet = nil
                        dismiss()
                    }
                )
                .environmentObject(APIClientWrapper(client: apiClient))
            case .sharePoem:
                PoemShareView(poem: poem)
                    .environmentObject(APIClientWrapper(client: apiClient))
            }
        }
    }

    // MARK: - Listen to Poem (TTS)

    private func listenToPoem() {
        guard !isGeneratingAudio else { return }
        isGeneratingAudio = true
        ToastService.shared.info("Generating audio...")
        Task {
            do {
                let _ = try await apiClient.generatePoemAudio(poemId: poem.id)
                let url = await apiClient.poemAudioURL(poemId: poem.id)
                let headers = await apiClient.streamingAuthHeaders()
                await MainActor.run {
                    isGeneratingAudio = false
                    AudioPlayerService.shared.play(
                        url: url,
                        headers: headers,
                        metadata: NowPlayingMetadata(
                            title: poem.title,
                            artist: "For \(poem.recipientName)"
                        )
                    )
                }
            } catch {
                await MainActor.run {
                    isGeneratingAudio = false
                    ToastService.shared.error(poemAudioErrorMessage(error))
                }
            }
        }
    }

    private func poemAudioErrorMessage(_ error: Error) -> String {
        guard let apiError = error as? APIClientError else {
            return "Could not play poem audio. Please try again."
        }

        switch apiError {
        case .rateLimited:
            return "You have reached the poem audio limit. Please wait and try again."
        case .networkError:
            return "Network issue while generating poem audio. Please try again."
        case .serverError(let message):
            return message.isEmpty ? "Could not generate poem audio. Please try again." : message
        case .httpError(_, let body):
            if body.localizedCaseInsensitiveContains("FST_ERR_CTP_EMPTY_JSON_BODY") {
                return "Audio request was rejected by the server. Please try again."
            }
            return "Could not generate poem audio. Please try again."
        default:
            return "Could not play poem audio. Please try again."
        }
    }
}

#Preview {
    PoemsTabView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL), playerState: PlayerState())
}
