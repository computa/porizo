import Foundation

enum Occasion: String, CaseIterable, Identifiable {
    case birthday
    case anniversary
    case thankYou
    case justBecause

    var id: String { rawValue }

    var label: String {
        switch self {
        case .birthday: return "Birthday"
        case .anniversary: return "Anniversary"
        case .thankYou: return "Thank you"
        case .justBecause: return "Just because"
        }
    }
}

enum VoiceSource: String, CaseIterable, Identifiable {
    case creatorVoice
    case aiGuide
    case instrumentalOnly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .creatorVoice: return "Creator voice"
        case .aiGuide: return "AI guide vocal"
        case .instrumentalOnly: return "Instrumental only"
        }
    }

    var apiValue: String {
        switch self {
        case .creatorVoice: return "user_voice"
        case .aiGuide: return "ai_voice"
        case .instrumentalOnly: return "instrumental"
        }
    }
}

enum ActiveSettingsSheet: String, Identifiable {
    case auth
    case subscription
    case push
    case voiceEnrollment

    var id: String { rawValue }
}

enum NativeProbeStatus: String, CaseIterable, Identifiable {
    case idle
    case permissionShell
    case backgrounded
    case failed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .idle: return "Idle"
        case .permissionShell: return "Permission shell"
        case .backgrounded: return "Backgrounded"
        case .failed: return "Failed"
        }
    }

    var detail: String {
        switch self {
        case .idle:
            return "No native probe has run. Hardware validation is still required."
        case .permissionShell:
            return "Placeholder for microphone permission, recorder setup, and STT intent."
        case .backgrounded:
            return "Placeholder for background/foreground survival check."
        case .failed:
            return "Use this fixture to inspect error layout and remediation copy."
        }
    }
}

enum AndroidNativeCapability: String, CaseIterable, Identifiable {
    case secureStorage
    case recordingSTT
    case pushProvider
    case playBilling
    case appLinks
    case releaseSigning

    var id: String { rawValue }

    var label: String {
        switch self {
        case .secureStorage: return "Secure token storage"
        case .recordingSTT: return "Voice enrollment recording"
        case .pushProvider: return "Push provider"
        case .playBilling: return "Play Billing"
        case .appLinks: return "App Links"
        case .releaseSigning: return "Release signing"
        }
    }

    var status: String {
        switch self {
        case .secureStorage: return "wired"
        case .recordingSTT: return "wired"
        case .pushProvider: return "wired"
        case .playBilling: return "wired"
        case .appLinks: return "wired"
        case .releaseSigning: return "template only"
        }
    }

    var detail: String {
        switch self {
        case .secureStorage:
            return "Auth session JSON and device JWTs are stored through the Android secure-store adapter on Android, with legacy UserDefaults migration."
        case .recordingSTT:
            return "Android microphone recording now writes WAV chunks and uploads through the same voice-enrollment start/upload/complete contract used by iOS."
        case .pushProvider:
            return "OneSignal SDK initialization, external-id login/logout, runtime permission, token lookup, and backend device registration are wired. Delivery still requires OneSignal FCM configuration."
        case .playBilling:
            return "Play Billing 9.1 product query, purchase launch, restore token lookup, and backend Google receipt validation are wired. Real purchases still require Play Console products and store-signed install."
        case .appLinks:
            return "Manifest routes /s, /play, /poem, and /receiver-handoff into the SwiftUI claim/library surfaces."
        case .releaseSigning:
            return "Release builds work with fallback signing; Play upload still requires a real keystore and assetlinks.json fingerprint."
        }
    }
}
