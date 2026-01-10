//
//  PoemsTabView.swift
//  PorizoApp
//
//  Displays list of user's poems with detail view.
//  Extracted from MainTabView for better modularity.
//

import SwiftUI

// MARK: - Poems Tab View

struct PoemsTabView: View {
    let apiClient: APIClient
    var onCreatePoem: (() -> Void)?

    @State private var poems: [Poem] = []
    @State private var isLoading = true
    @State private var loadError: Error?
    @State private var selectedPoem: Poem?
    @State private var showPoemDetail = false

    // Delete confirmation
    @State private var poemToDelete: Poem?
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false

    // Sample data for preview (until API is ready)
    private let samplePoems: [Poem] = [
        Poem(
            id: "poem-001",
            userId: "user-001",
            title: "For My Mother",
            recipientName: "Mom",
            occasion: "thank_you",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Through every storm, you held my hand,",
                "When I was lost, you helped me stand.",
                "Your love, a beacon shining bright,",
                "Has guided me through darkest night.",
                "",
                "No words could ever fully say,",
                "How much you mean to me each day.",
                "But Mom, I hope that you can see,",
                "The world you've given, just by being free."
            ],
            createdAt: "2024-01-15T14:00:00Z",
            updatedAt: "2024-01-15T14:00:00Z"
        ),
        Poem(
            id: "poem-002",
            userId: "user-001",
            title: "Our Five Years",
            recipientName: "Sarah",
            occasion: "anniversary",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Five years ago, we took a chance,",
                "Two hearts that dared to join the dance.",
                "Through laughter, tears, and everything between,",
                "You're still the best I've ever seen.",
                "",
                "Sarah, my love, my partner, my friend,",
                "I'll choose you over and over again.",
                "Here's to five more, and fifty more after,",
                "A lifetime of love, joy, and laughter."
            ],
            createdAt: "2024-01-12T19:30:00Z",
            updatedAt: "2024-01-12T19:30:00Z"
        )
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                Group {
                    if isLoading {
                        loadingView
                    } else if loadError != nil {
                        errorStateView
                    } else if poems.isEmpty {
                        emptyStateView
                    } else {
                        poemListView
                    }
                }
            }
            .navigationTitle("My Poems")
            .refreshable {
                await loadPoems()
            }
            .sheet(isPresented: $showPoemDetail) {
                if let poem = selectedPoem {
                    PoemDetailView(poem: poem, apiClient: apiClient, onDelete: { deletedPoem in
                        poems.removeAll { $0.id == deletedPoem.id }
                    })
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
                    Text("Are you sure you want to delete \"\(poem.title)\"? This action cannot be undone.")
                }
            }
        }
        .onAppear {
            if poems.isEmpty && loadError == nil {
                Task {
                    await loadPoems()
                }
            }
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(DesignTokens.rose)
            Text("Loading poems...")
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Error State

    private var errorStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Error icon
            ZStack {
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 8) {
                Text("Couldn't Load Poems")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Check your connection and try again")
                    .font(.body)
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
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.rose)
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

            // Icon with rose theme
            ZStack {
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "text.book.closed.fill")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 8) {
                Text("No Poems Yet")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Express your feelings through\nbeautifully crafted words")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // CTA Button - solid rose (no gradient per design guide)
            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onCreatePoem?()
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Create Your First Poem")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.rose)
                .cornerRadius(25)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Poem List

    private var poemListView: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(poems) { poem in
                    PoemCard(poem: poem, onTap: {
                        selectedPoem = poem
                        showPoemDetail = true
                    }, onDelete: {
                        poemToDelete = poem
                        showDeleteConfirmation = true
                    })
                }
            }
            .padding()
            // Bottom padding removed - MainTabView handles spacing
        }
    }

    // MARK: - Load Poems

    private func loadPoems() async {
        isLoading = true
        loadError = nil

        do {
            let response = try await apiClient.getPoems()
            poems = response.poems
            isLoading = false
        } catch {
            print("[PoemsTab] Failed to load poems: \(error)")
            loadError = error
            isLoading = false
        }
    }

    private func deletePoem(_ poem: Poem) {
        isDeleting = true

        Task {
            do {
                try await apiClient.deletePoem(poemId: poem.id)
                await MainActor.run {
                    poems.removeAll { $0.id == poem.id }
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

// MARK: - Poem Card (Light UI)

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
            VStack(alignment: .leading, spacing: 12) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(poem.title)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        HStack(spacing: 8) {
                            // Occasion badge
                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                        .font(.caption)
                                    Text(occasion.displayName)
                                        .font(.caption)
                                        .foregroundColor(DesignTokens.textSecondary)
                                }
                            }

                            Text("•")
                                .foregroundColor(DesignTokens.textTertiary)

                            // Recipient
                            Text("For \(poem.recipientName)")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()

                    // Status indicator
                    statusBadge
                }

                // Preview lines
                Text(poem.previewLines + "...")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(2)
                    .italic()

                // Footer
                HStack {
                    Text(formattedDate)
                        .font(.caption2)
                        .foregroundColor(DesignTokens.textTertiary)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }
            .padding()
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .subtleShadow()
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let onDelete = onDelete {
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Delete Poem", systemImage: "trash")
                }
            }
        }
    }

    private var statusBadge: some View {
        Group {
            if poem.status == "complete" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(DesignTokens.success)
            } else {
                Text("Draft")
                    .font(.caption2)
                    .foregroundColor(DesignTokens.warning)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(DesignTokens.warning.opacity(0.1))
                    .cornerRadius(8)
            }
        }
    }

    // Static formatters for performance
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        return formatter
    }()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter
    }()

    private var formattedDate: String {
        if let date = Self.isoFormatter.date(from: poem.createdAt) {
            return Self.displayFormatter.string(from: date)
        }
        return poem.createdAt
    }
}

// MARK: - Poem Detail View (Light UI)

struct PoemDetailView: View {
    let poem: Poem
    let apiClient: APIClient
    var onDelete: ((Poem) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var showCopiedToast = false
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false

    /// Formatted poem text for sharing
    private var shareableText: String {
        """
        \(poem.title)
        For \(poem.recipientName)

        \(poem.verses.joined(separator: "\n"))

        Created with Porizo
        """
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 32) {
                        // Header
                        VStack(spacing: 8) {
                            Text("For \(poem.recipientName)")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)

                            Text(poem.title)
                                .font(.title.bold())
                                .foregroundColor(DesignTokens.textPrimary)

                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                    Text(occasion.displayName)
                                }
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                            }
                        }
                        .padding(.top, 20)

                        // Poem content
                        VStack(alignment: .center, spacing: 8) {
                            ForEach(Array(poem.verses.enumerated()), id: \.offset) { _, line in
                                if line.isEmpty {
                                    Spacer()
                                        .frame(height: 16)
                                } else {
                                    Text(line)
                                        .font(.system(.body, design: .serif))
                                        .italic()
                                        .multilineTextAlignment(.center)
                                        .foregroundColor(DesignTokens.textPrimary)
                                }
                            }
                        }
                        .padding(.horizontal, 24)

                        // Action buttons
                        VStack(spacing: 12) {
                            // Share button - solid rose
                            ShareLink(item: shareableText) {
                                HStack {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("Share Poem")
                                }
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.rose)
                                .cornerRadius(14)
                            }

                            // Copy text button
                            Button {
                                let generator = UINotificationFeedbackGenerator()
                                generator.notificationOccurred(.success)
                                UIPasteboard.general.string = poem.verses.joined(separator: "\n")
                                showCopiedToast = true
                                Task { @MainActor in
                                    try? await Task.sleep(for: .seconds(2))
                                    showCopiedToast = false
                                }
                            } label: {
                                HStack {
                                    Image(systemName: showCopiedToast ? "checkmark" : "doc.on.doc")
                                    Text(showCopiedToast ? "Copied!" : "Copy Text")
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(DesignTokens.cardBackground)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(DesignTokens.cardBorder, lineWidth: 1)
                                )
                                .cornerRadius(14)
                            }

                            // Create variation button
                            Button {
                                let generator = UIImpactFeedbackGenerator(style: .medium)
                                generator.impactOccurred()
                                // TODO: Navigate to create flow with pre-filled context
                            } label: {
                                HStack {
                                    Image(systemName: "arrow.triangle.branch")
                                    Text("Create Variation")
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(DesignTokens.rose)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(DesignTokens.roseMuted)
                                .cornerRadius(14)
                            }

                            // Delete button
                            if onDelete != nil {
                                Button(role: .destructive) {
                                    showDeleteConfirmation = true
                                } label: {
                                    HStack {
                                        Image(systemName: "trash")
                                        Text("Delete Poem")
                                    }
                                    .font(.subheadline.weight(.medium))
                                    .foregroundColor(DesignTokens.error)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }
            .alert("Delete Poem?", isPresented: $showDeleteConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) {
                    deletePoem()
                }
            } message: {
                Text("Are you sure you want to delete \"\(poem.title)\"? This action cannot be undone.")
            }
            .overlay {
                if isDeleting {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.5)
                }
            }
        }
    }

    private func deletePoem() {
        isDeleting = true

        Task {
            do {
                try await apiClient.deletePoem(poemId: poem.id)
                await MainActor.run {
                    isDeleting = false
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.success)
                    onDelete?(poem)
                    dismiss()
                }
            } catch {
                print("[PoemDetail] Failed to delete poem: \(error)")
                await MainActor.run {
                    isDeleting = false
                    ToastService.shared.error("Failed to delete poem")
                }
            }
        }
    }
}

#Preview {
    PoemsTabView(apiClient: APIClient(baseURL: "http://localhost:3000"))
}
