//
//  ContentView.swift
//  PorizoApp
//
//  Voice enrollment recording interface.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var recorder = AudioRecorder()
    @State private var showingError = false
    @State private var errorMessage = ""

    var body: some View {
        VStack(spacing: 32) {
            // Header
            Text("Voice Enrollment")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Record your voice to create a personalized song")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()

            // Permission denied message
            if recorder.permissionDenied {
                VStack(spacing: 16) {
                    Image(systemName: "mic.slash.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.red)

                    Text("Microphone Access Denied")
                        .font(.headline)

                    Text("Please enable microphone access in Settings to record your voice.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)

                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
            } else {
                // Audio level visualization
                ZStack {
                    Circle()
                        .stroke(Color.gray.opacity(0.3), lineWidth: 4)
                        .frame(width: 200, height: 200)

                    Circle()
                        .fill(recorder.isRecording ? Color.red.opacity(0.2) : Color.blue.opacity(0.1))
                        .frame(width: 180, height: 180)
                        .scaleEffect(recorder.isRecording ? 1 + CGFloat(recorder.audioLevel) * 0.3 : 1)
                        .animation(.easeInOut(duration: 0.1), value: recorder.audioLevel)

                    Image(systemName: recorder.isRecording ? "mic.fill" : "mic")
                        .font(.system(size: 60))
                        .foregroundColor(recorder.isRecording ? .red : .blue)
                }

                // Duration display
                Text(formatDuration(recorder.duration))
                    .font(.system(size: 48, weight: .light, design: .monospaced))
                    .foregroundColor(recorder.isRecording ? .red : .primary)

                // Status text
                Text(statusText)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Control buttons
            if !recorder.permissionDenied {
                HStack(spacing: 24) {
                    // Playback button (only if has recording)
                    if recorder.hasRecording && !recorder.isRecording {
                        Button {
                            recorder.playRecording()
                        } label: {
                            Image(systemName: "play.fill")
                                .font(.title)
                                .frame(width: 60, height: 60)
                                .background(Color.green)
                                .foregroundColor(.white)
                                .clipShape(Circle())
                        }
                    }

                    // Record button
                    Button {
                        toggleRecording()
                    } label: {
                        Image(systemName: recorder.isRecording ? "stop.fill" : "circle.fill")
                            .font(.system(size: 32))
                            .frame(width: 80, height: 80)
                            .background(recorder.isRecording ? Color.gray : Color.red)
                            .foregroundColor(.white)
                            .clipShape(Circle())
                    }

                    // Delete button (only if has recording)
                    if recorder.hasRecording && !recorder.isRecording {
                        Button {
                            recorder.deleteRecording()
                        } label: {
                            Image(systemName: "trash.fill")
                                .font(.title)
                                .frame(width: 60, height: 60)
                                .background(Color.orange)
                                .foregroundColor(.white)
                                .clipShape(Circle())
                        }
                    }
                }
            }

            Spacer()
        }
        .padding()
        .alert("Recording Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            recorder.checkPermission()
        }
    }

    // MARK: - Helpers

    private var statusText: String {
        if recorder.isRecording {
            return "Recording... Tap stop when done"
        } else if recorder.hasRecording {
            return "Recording saved! Play it back or re-record"
        } else {
            return "Tap the red button to start recording"
        }
    }

    private func toggleRecording() {
        if recorder.isRecording {
            _ = recorder.stopRecording()
        } else {
            Task {
                // Request permission if not granted
                if !recorder.permissionGranted {
                    let granted = await recorder.requestPermission()
                    if !granted {
                        return
                    }
                }

                do {
                    try recorder.startRecording()
                } catch {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        let tenths = Int((duration.truncatingRemainder(dividingBy: 1)) * 10)
        return String(format: "%d:%02d.%d", minutes, seconds, tenths)
    }
}

#Preview {
    ContentView()
}
