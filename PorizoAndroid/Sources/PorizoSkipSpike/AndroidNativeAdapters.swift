import Foundation

struct AndroidPushProvider: Sendable {
    func initialize() -> String {
        #if os(Android)
        return porizoPushInitialize(appId: AndroidAppConfig.oneSignalAppId, verbose: isDebugBuild)
        #else
        return "OneSignal Android SDK is available only on Android."
        #endif
    }

    func requestPermission() -> String {
        #if os(Android)
        return porizoPushRequestPermission()
        #else
        return "Notification permission is available only on Android."
        #endif
    }

    func login(userId: String) -> String {
        #if os(Android)
        return porizoPushLogin(userId: userId)
        #else
        return "OneSignal login is available only on Android."
        #endif
    }

    func logout() -> String {
        #if os(Android)
        return porizoPushLogout()
        #else
        return "OneSignal logout is available only on Android."
        #endif
    }

    func optIn() -> String {
        #if os(Android)
        return porizoPushOptIn()
        #else
        return "OneSignal opt-in is available only on Android."
        #endif
    }

    func pushToken() -> String? {
        #if os(Android)
        return porizoPushToken()
        #else
        return nil
        #endif
    }

    func subscriptionId() -> String? {
        #if os(Android)
        return porizoPushSubscriptionId()
        #else
        return nil
        #endif
    }

    private var isDebugBuild: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}

struct AndroidPlayProductSummary: Identifiable, Sendable {
    let id: String
    let productType: String
    let title: String
    let price: String
}

struct AndroidPlayBillingProvider: Sendable {
    func queryProducts(subscriptionIds: [String], oneTimeIds: [String]) -> String {
        #if os(Android)
        return porizoBillingQueryProducts(
            subscriptionProductIdsCsv: subscriptionIds.joined(separator: ","),
            oneTimeProductIdsCsv: oneTimeIds.joined(separator: ",")
        )
        #else
        return "Play Billing is available only on Android."
        #endif
    }

    func launchPurchase(productId: String, obfuscatedAccountId: String?) -> String {
        #if os(Android)
        return porizoBillingLaunchPurchase(productId: productId, obfuscatedAccountId: obfuscatedAccountId)
        #else
        return "Play Billing purchase flow is available only on Android."
        #endif
    }

    func queryActivePurchases() -> String {
        #if os(Android)
        return porizoBillingQueryActivePurchases()
        #else
        return "Play Billing purchase restore is available only on Android."
        #endif
    }

    func lastPurchaseToken(productId: String) -> String? {
        #if os(Android)
        return porizoBillingLastPurchaseToken(productId: productId)
        #else
        return nil
        #endif
    }

    func loadedProducts() -> [AndroidPlayProductSummary] {
        #if os(Android)
        let raw = porizoBillingLoadedProductsSummary()
        #else
        let raw = ""
        #endif
        return raw
            .split(separator: "\n")
            .compactMap { row -> AndroidPlayProductSummary? in
                let pieces = row.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
                guard pieces.count >= 4 else { return nil }
                return AndroidPlayProductSummary(
                    id: pieces[0],
                    productType: pieces[1],
                    title: pieces[2],
                    price: pieces[3]
                )
            }
    }

    func status() -> String {
        #if os(Android)
        return porizoBillingStatus()
        #else
        return "Play Billing is available only on Android."
        #endif
    }
}

struct AndroidNativeRecording: Sendable {
    let path: String
    let durationSec: Double
    let bytes: Int
    let checksum: String?
}

struct AndroidRecorderProvider: Sendable {
    func hasMicrophonePermission() -> Bool {
        #if os(Android)
        return porizoRecorderHasMicrophonePermission()
        #else
        return false
        #endif
    }

    func requestMicrophonePermission() -> String {
        #if os(Android)
        return porizoRecorderRequestMicrophonePermission()
        #else
        return "Microphone permission is available only on Android."
        #endif
    }

    func startRecording() -> String {
        #if os(Android)
        return porizoRecorderStart()
        #else
        return "Android recording is available only on Android."
        #endif
    }

    func stopRecording() throws -> AndroidNativeRecording {
        #if os(Android)
        let raw = porizoRecorderStop()
        #else
        let raw = "ERROR|Android recording is available only on Android."
        #endif
        let pieces = raw.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        guard pieces.first == "OK", pieces.count >= 5 else {
            throw AndroidNativeAdapterError.operationFailed(pieces.dropFirst().joined(separator: "|"))
        }
        return AndroidNativeRecording(
            path: pieces[1],
            durationSec: Double(pieces[2]) ?? 0,
            bytes: Int(pieces[3]) ?? 0,
            checksum: pieces[4].isEmpty ? nil : pieces[4]
        )
    }

    func data(for recording: AndroidNativeRecording) throws -> Data {
        #if os(Android)
        guard let encoded = porizoRecorderReadBase64(path: recording.path),
              let data = Data(base64Encoded: encoded) else {
            throw AndroidNativeAdapterError.operationFailed("Could not read recorded audio.")
        }
        return data
        #else
        throw AndroidNativeAdapterError.operationFailed("Android recording is available only on Android.")
        #endif
    }

    func delete(recording: AndroidNativeRecording) -> String {
        #if os(Android)
        return porizoRecorderDelete(path: recording.path)
        #else
        return "Android recording is available only on Android."
        #endif
    }

    func status() -> String {
        #if os(Android)
        return porizoRecorderStatus()
        #else
        return "Android recording is available only on Android."
        #endif
    }
}

enum AndroidNativeAdapterError: Error, CustomStringConvertible {
    case operationFailed(String)

    var description: String {
        switch self {
        case .operationFailed(let message):
            return message.isEmpty ? "Native Android operation failed." : message
        }
    }
}

#if SKIP
func porizoPushInitialize(appId: String, verbose: Bool) -> String {
    PorizoNativePushBridge.initialize(context: ProcessInfo.processInfo.androidContext, appId: appId, verbose: verbose)
}

func porizoPushRequestPermission() -> String {
    PorizoNativePushBridge.requestNotificationPermission()
}

func porizoPushLogin(userId: String) -> String {
    PorizoNativePushBridge.login(userId: userId)
}

func porizoPushLogout() -> String {
    PorizoNativePushBridge.logout()
}

func porizoPushOptIn() -> String {
    PorizoNativePushBridge.optIn()
}

func porizoPushToken() -> String? {
    PorizoNativePushBridge.pushToken()
}

func porizoPushSubscriptionId() -> String? {
    PorizoNativePushBridge.subscriptionId()
}

func porizoBillingQueryProducts(subscriptionProductIdsCsv: String, oneTimeProductIdsCsv: String) -> String {
    PorizoNativeBillingBridge.queryProducts(
        context: ProcessInfo.processInfo.androidContext,
        subscriptionProductIdsCsv: subscriptionProductIdsCsv,
        oneTimeProductIdsCsv: oneTimeProductIdsCsv
    )
}

func porizoBillingLaunchPurchase(productId: String, obfuscatedAccountId: String?) -> String {
    PorizoNativeBillingBridge.launchPurchase(productId: productId, obfuscatedAccountId: obfuscatedAccountId)
}

func porizoBillingQueryActivePurchases() -> String {
    PorizoNativeBillingBridge.queryActivePurchases(context: ProcessInfo.processInfo.androidContext)
}

func porizoBillingLastPurchaseToken(productId: String) -> String? {
    PorizoNativeBillingBridge.lastPurchaseToken(productId: productId)
}

func porizoBillingLoadedProductsSummary() -> String {
    PorizoNativeBillingBridge.loadedProductsSummary()
}

func porizoBillingStatus() -> String {
    PorizoNativeBillingBridge.status()
}

func porizoRecorderHasMicrophonePermission() -> Bool {
    PorizoNativeRecorderBridge.hasMicrophonePermission(context: ProcessInfo.processInfo.androidContext)
}

func porizoRecorderRequestMicrophonePermission() -> String {
    PorizoNativeRecorderBridge.requestMicrophonePermission()
}

func porizoRecorderStart() -> String {
    PorizoNativeRecorderBridge.startRecording(context: ProcessInfo.processInfo.androidContext)
}

func porizoRecorderStop() -> String {
    PorizoNativeRecorderBridge.stopRecording()
}

func porizoRecorderReadBase64(path: String) -> String? {
    PorizoNativeRecorderBridge.readRecordingBase64(path: path)
}

func porizoRecorderDelete(path: String) -> String {
    PorizoNativeRecorderBridge.deleteRecording(path: path)
}

func porizoRecorderStatus() -> String {
    PorizoNativeRecorderBridge.status()
}
#endif
