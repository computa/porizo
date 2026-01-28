//
//  VoiceEnrollmentView.swift
//  PorizoApp
//
//  Voice enrollment screen for recording phrases to create a voice profile.
//  Matches v1.pen "09 - Voice Enrollment" design.
//

import SwiftUI
import AVFoundation

// MARK: - Voice Enrollment View

struct VoiceEnrollmentView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = AudioRecorder()

    @State private var currentPhraseIndex: Int = 0
    @State private var recordedPhrases: Set<Int> = []
    @State private var isRecording: Bool = false
    @State private var showCompletionAlert: Bool = false

    private let phrases: [EnrollmentPhrase] = EnrollmentPhrase.defaultPhrases

    private var currentPhrase: EnrollmentPhrase {
        phrases[currentPhraseIndex]
    }

    private var canProceed: Bool {
        recordedPhrases.contains(currentPhraseIndex)
    }

    private var isLastPhrase: Bool {
        currentPhraseIndex == phrases.count - 1
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                header

                // Content
                VStack(spacing: 24) {
                    // Progress indicator
                    progressIndicator

                    // Prompt badge
                    promptBadge

                    // Prompt text
                    promptText

                    // Hint text
                    hintText

                    Spacer()

                    // Record button
                    recordButton

                    // Waveform placeholder
                    waveformPlaceholder

                    Spacer()

                    // Navigation row
                    navigationRow
                }
                .padding(24)
            }
        }
        .navigationBarHidden(true)
        .alert("Voice Setup Complete!", isPresented: $showCompletionAlert) {
            Button("Continue") {
                dismiss()
            }
        } message: {
            Text("Your voice profile has been created successfully.")
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Text("<")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

            Spacer()

            Text("Voice Setup")
                .font(.custom("PlayfairDisplay-Regular", size: 20))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Progress Indicator

    private var progressIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<phrases.count, id: \.self) { index in
                Circle()
                    .fill(progressDotColor(for: index))
                    .frame(width: 8, height: 8)
            }

            Text("Phrase \(currentPhraseIndex + 1) of \(phrases.count)")
                .font(.system(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    private func progressDotColor(for index: Int) -> Color {
        if recordedPhrases.contains(index) {
            return DesignTokens.success
        } else if index == currentPhraseIndex {
            return DesignTokens.gold
        } else {
            return DesignTokens.border
        }
    }

    // MARK: - Prompt Badge

    private var promptBadge: some View {
        Text(currentPhrase.type.displayName)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(DesignTokens.gold)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(DesignTokens.surface)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.border, lineWidth: 1)
            )
    }

    // MARK: - Prompt Text

    private var promptText: some View {
        Text("\"\(currentPhrase.text)\"")
            .font(.custom("PlayfairDisplay-Regular", size: 24))
            .foregroundColor(DesignTokens.textPrimary)
            .multilineTextAlignment(.center)
            .lineSpacing(8)
            .padding(.horizontal, 16)
    }

    // MARK: - Hint Text

    private var hintText: some View {
        Text(currentPhrase.type == .spoken
             ? "Read this phrase naturally, like you're speaking to a friend."
             : "Sing this phrase in your natural voice.")
            .font(.system(size: 14))
            .foregroundColor(DesignTokens.textSecondary)
            .multilineTextAlignment(.center)
            .lineSpacing(4)
    }

    // MARK: - Record Button

    private var recordButton: some View {
        Button {
            toggleRecording()
        } label: {
            ZStack {
                // Outer ring
                Circle()
                    .fill(DesignTokens.gold.opacity(0.2))
                    .frame(width: 120, height: 120)

                // Inner button
                Circle()
                    .fill(isRecording ? DesignTokens.error : DesignTokens.gold)
                    .frame(width: 88, height: 88)

                // Icon
                if isRecording {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white)
                        .frame(width: 28, height: 28)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundColor(DesignTokens.background)
                }
            }
        }
        .buttonStyle(.plain)
        .scaleEffect(isRecording ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isRecording)
    }

    // MARK: - Waveform Placeholder

    private var waveformPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(DesignTokens.surface)
                .frame(height: 60)

            if isRecording {
                // Animated bars for recording indicator
                HStack(spacing: 4) {
                    ForEach(0..<20, id: \.self) { index in
                        WaveformBar(isAnimating: isRecording, delay: Double(index) * 0.05)
                    }
                }
            } else if recordedPhrases.contains(currentPhraseIndex) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(DesignTokens.success)

                    Text("Recorded")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.success)
                }
            } else {
                Text("Audio waveform will appear here")
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textTertiary)
            }
        }
    }

    // MARK: - Navigation Row

    private var navigationRow: some View {
        HStack {
            Button {
                skipPhrase()
            } label: {
                Text("Skip Phrase")
                    .font(.system(size: 16))
                    .foregroundColor(DesignTokens.gold)
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                if isLastPhrase {
                    completeEnrollment()
                } else {
                    nextPhrase()
                }
            } label: {
                Text(isLastPhrase ? "Complete" : "Next Phrase")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.background)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(canProceed ? DesignTokens.gold : DesignTokens.gold.opacity(0.4))
                    .cornerRadius(24)
            }
            .buttonStyle(.plain)
            .disabled(!canProceed)
        }
        .padding(.vertical, 16)
    }

    // MARK: - Actions

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        do {
            try recorder.startRecording()
            isRecording = true

            // Auto-stop after 5 seconds for demo
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                if self.isRecording {
                    self.stopRecording()
                }
            }
        } catch {
            print("Recording error: \(error.localizedDescription)")
        }
    }

    private func stopRecording() {
        _ = recorder.stopRecording()
        isRecording = false
        recordedPhrases.insert(currentPhraseIndex)
    }

    private func nextPhrase() {
        guard currentPhraseIndex < phrases.count - 1 else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            currentPhraseIndex += 1
        }
    }

    private func skipPhrase() {
        if currentPhraseIndex < phrases.count - 1 {
            withAnimation(.easeInOut(duration: 0.2)) {
                currentPhraseIndex += 1
            }
        }
    }

    private func completeEnrollment() {
        showCompletionAlert = true
    }
}

// MARK: - Enrollment Phrase

struct EnrollmentPhrase: Identifiable {
    let id = UUID()
    let text: String
    let type: PhraseType

    enum PhraseType {
        case spoken
        case sung

        var displayName: String {
            switch self {
            case .spoken: return "SPOKEN"
            case .sung: return "SUNG"
            }
        }
    }

    static let defaultPhrases: [EnrollmentPhrase] = [
        EnrollmentPhrase(text: "The quick brown fox\njumps over the lazy dog", type: .spoken),
        EnrollmentPhrase(text: "She sells seashells\nby the seashore", type: .spoken),
        EnrollmentPhrase(text: "How much wood would\na woodchuck chuck", type: .spoken),
        EnrollmentPhrase(text: "Peter Piper picked\na peck of pickled peppers", type: .spoken),
        EnrollmentPhrase(text: "Around the rugged rocks\nthe ragged rascal ran", type: .spoken),
        EnrollmentPhrase(text: "Betty Botter bought some butter\nbut she said the butter's bitter", type: .spoken),
        EnrollmentPhrase(text: "Happy birthday to you\nhappy birthday to you", type: .sung),
        EnrollmentPhrase(text: "La la la la la\nla la la la la", type: .sung),
    ]
}

// MARK: - Waveform Bar

private struct WaveformBar: View {
    let isAnimating: Bool
    let delay: Double

    @State private var height: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold)
            .frame(width: 4, height: height)
            .onAppear {
                if isAnimating {
                    startAnimation()
                }
            }
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startAnimation()
                } else {
                    height = 8
                }
            }
    }

    private func startAnimation() {
        withAnimation(
            .easeInOut(duration: 0.3)
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            height = CGFloat.random(in: 16...40)
        }
    }
}

// MARK: - Preview

#Preview {
    VoiceEnrollmentView()
}
