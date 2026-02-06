//
//  PoemPreviewView.swift
//  PorizoApp
//
//  Displays the generated poem for review.
//

import SwiftUI

struct PoemPreviewView: View {
    let poem: Poem
    let onRegenerate: () -> Void
    let onDone: () -> Void
    @State private var showOptions = false

    var body: some View {
        PoemFullView(
            poem: poem,
            onBack: onDone,
            onMenu: { showOptions = true },
            onListen: {
                ToastService.shared.info("Save your poem first to listen.")
            },
            onShare: {
                ToastService.shared.info("Share is available after saving.")
            }
        )
        .confirmationDialog("Poem Options", isPresented: $showOptions) {
            Button("Try Different Version") {
                onRegenerate()
            }
            Button("Done", role: .cancel) {
                onDone()
            }
        } message: {
            Text("Choose what to do next.")
        }
    }
}

#Preview {
    PoemPreviewView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Chioma",
            recipientName: "Chioma",
            occasion: "birthday",
            tone: "heartfelt",
            status: "generated",
            verses: [
                "You are the morning light,",
                "Soft as the dawn we found together.",
                "Every step, a quiet blessing.",
            ],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        ),
        onRegenerate: { },
        onDone: { }
    )
}
