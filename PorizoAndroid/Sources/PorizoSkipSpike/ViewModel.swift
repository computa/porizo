import Foundation

enum ClaimState: String, CaseIterable, Identifiable {
    case readyToClaim
    case claimedHere
    case alreadyClaimed
    case expired
    case wrongDevice

    var id: String { rawValue }

    var label: String {
        switch self {
        case .readyToClaim: return "Ready"
        case .claimedHere: return "Claimed here"
        case .alreadyClaimed: return "Already claimed"
        case .expired: return "Expired"
        case .wrongDevice: return "Wrong device"
        }
    }

    var headline: String {
        switch self {
        case .readyToClaim: return "Someone made you a song"
        case .claimedHere: return "Saved to this device"
        case .alreadyClaimed: return "This gift was already claimed"
        case .expired: return "This link expired"
        case .wrongDevice: return "Open on the claimed device"
        }
    }

    var detail: String {
        switch self {
        case .readyToClaim:
            return "Stream the preview once, then claim in the app to save it."
        case .claimedHere:
            return "This Android device is bound and can request protected stream keys."
        case .alreadyClaimed:
            return "The server should block a second app claim and keep web playback limited."
        case .expired:
            return "The share token is past its expiry window and should not stream."
        case .wrongDevice:
            return "The token is bound elsewhere; show a support path without leaking audio."
        }
    }

    var symbol: String {
        switch self {
        case .readyToClaim: return "heart.fill"
        case .claimedHere: return "checkmark.circle.fill"
        case .alreadyClaimed: return "exclamationmark.triangle"
        case .expired: return "exclamationmark.triangle"
        case .wrongDevice: return "lock"
        }
    }

    var boundDevice: String {
        switch self {
        case .readyToClaim, .expired: return "none"
        case .claimedHere: return AndroidAppConfig.platformDeviceLabel
        case .alreadyClaimed: return "other-device-redacted"
        case .wrongDevice: return "android-other-device"
        }
    }

    var canPlay: Bool {
        self == .readyToClaim || self == .claimedHere
    }
}

enum LinkRoute: String, CaseIterable, Identifiable {
    case webPreview
    case deferredInstall
    case appLinkReturn

    var id: String { rawValue }

    var label: String {
        switch self {
        case .webPreview: return "Web preview"
        case .deferredInstall: return "Deferred install"
        case .appLinkReturn: return "App Link return"
        }
    }

    var badge: String {
        switch self {
        case .webPreview: return "web"
        case .deferredInstall: return "store"
        case .appLinkReturn: return "app"
        }
    }

    var detail: String {
        switch self {
        case .webPreview:
            return "Recipient can stream short-lived web audio before the token is claimed."
        case .deferredInstall:
            return "The link preserves share_id while the user installs the Android app."
        case .appLinkReturn:
            return "Android intent filter should route /s/{share_id} back into this claim surface."
        }
    }
}

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
