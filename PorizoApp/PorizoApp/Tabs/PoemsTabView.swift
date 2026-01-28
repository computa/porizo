//
//  PoemsTabView.swift
//  PorizoApp
//
//  Poems tab matching v1.pen "11 - Poems Library" design.
//  Velvet & Gold design system with custom header.
//

import SwiftUI

// MARK: - Poems Tab View

struct PoemsTabView: View {
    let apiClient: APIClient
    var onCreatePoem: (() -> Void)?
    var onCreateVariation: ((Poem) -> Void)?

    @State private var poems: [Poem] = []
    @State private var isLoading = true
    @State private var loadError: Error?
    @State private var selectedPoem: Poem?
    @State private var showPoemDetail = false
    @State private var cacheLoaded = false

    // Delete confirmation
    @State private var poemToDelete: Poem?
    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false

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
                        poemListView
                    }
                }
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
                Text("Are you sure you want to delete \"\(poem.title)\"? This action cannot be undone.")
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

    // MARK: - Header (v1.pen design)

    private var poemsHeader: some View {
        HStack {
            Text("My Poems")
                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            // Filter button
            Button {
                // TODO: Show filter options
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 18))
                    .foregroundColor(DesignTokens.gold)
                    .frame(width: 40, height: 40)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
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

    // MARK: - Poem List

    private var poemListView: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
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
            let response = try await apiClient.getPoems()
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
            HStack(alignment: .center, spacing: 12) {
                // Poem content
                VStack(alignment: .leading, spacing: 8) {
                    // Header: Title + Status badge
                    HStack {
                        Text(poem.title)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                            .lineLimit(1)

                        Spacer()

                        statusBadge
                    }

                    // Meta: Emoji + "Occasion • For Recipient"
                    HStack(spacing: 8) {
                        if let occasion = Occasion(rawValue: poem.occasion) {
                            Text(occasion.emoji)
                                .font(.system(size: 14))
                        }

                        Text(metaText)
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    // Preview (italic)
                    Text("\"\(poem.previewLines)...\"")
                        .font(DesignTokens.bodyFont(size: 13))
                        .italic()
                        .foregroundColor(DesignTokens.textTertiary)
                        .lineLimit(2)
                        .lineSpacing(4)

                    // Date
                    Text(formattedDate)
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundColor(Color(hex: "#4A4A4A"))
                }

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 20))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .padding(16)
            .background(DesignTokens.surface)
            .cornerRadius(16)
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

    // MARK: - Status Badge

    @ViewBuilder
    private var statusBadge: some View {
        if poem.status == "complete" {
            Text("Complete")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(Color(hex: "#4ADE80"))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color(hex: "#1A3D1A"))
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

    private var metaText: String {
        var parts: [String] = []

        if let occasion = Occasion(rawValue: poem.occasion) {
            parts.append(occasion.displayName)
        }

        parts.append("For \(poem.recipientName)")

        return parts.joined(separator: " • ")
    }

    // Static formatters for performance
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        return formatter
    }()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()

    private var formattedDate: String {
        if let date = Self.isoFormatter.date(from: poem.createdAt) {
            return Self.displayFormatter.string(from: date)
        }
        return poem.createdAt
    }
}

// MARK: - Poem Detail View (Velvet design)

struct PoemDetailView: View {
    let poem: Poem
    let apiClient: APIClient
    var onDelete: ((Poem) -> Void)?
    var onCreateVariation: ((Poem) -> Void)?

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
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textSecondary)

                            Text(poem.title)
                                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                                .foregroundColor(DesignTokens.textPrimary)

                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                    Text(occasion.displayName)
                                }
                                .font(DesignTokens.bodyFont(size: 13))
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
                                        .font(DesignTokens.displayFont(size: 18))
                                        .italic()
                                        .multilineTextAlignment(.center)
                                        .foregroundColor(DesignTokens.textPrimary)
                                }
                            }
                        }
                        .padding(.horizontal, 24)

                        // Action buttons
                        VStack(spacing: 12) {
                            // Share button - gold
                            ShareLink(item: shareableText) {
                                HStack {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("Share Poem")
                                }
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                .foregroundColor(DesignTokens.background)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.gold)
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
                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                .foregroundColor(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(DesignTokens.surface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                                )
                                .cornerRadius(14)
                            }

                            // Create variation button
                            if let onCreateVariation = onCreateVariation {
                                Button {
                                    let generator = UIImpactFeedbackGenerator(style: .medium)
                                    generator.impactOccurred()
                                    onCreateVariation(poem)
                                } label: {
                                    HStack {
                                        Image(systemName: "arrow.triangle.branch")
                                        Text("Create Variation")
                                    }
                                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                    .foregroundColor(DesignTokens.gold)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(DesignTokens.gold.opacity(0.15))
                                    .cornerRadius(14)
                                }
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
                                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
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
                    .foregroundColor(DesignTokens.gold)
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
    PoemsTabView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
}
