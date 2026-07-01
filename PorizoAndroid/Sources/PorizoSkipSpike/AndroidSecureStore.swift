import Foundation

struct AndroidSecretStore: Sendable {
    func string(forKey key: String) -> String? {
        #if os(Android)
        return porizoSecureStoreString(forKey: key) ?? migrateLegacyStringIfNeeded(forKey: key)
        #else
        return legacyString(forKey: key)
        #endif
    }

    func setString(_ value: String, forKey key: String) {
        #if os(Android)
        porizoSecureStoreSetString(value, forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        #else
        UserDefaults.standard.set(value, forKey: key)
        #endif
    }

    func removeString(forKey key: String) {
        #if os(Android)
        porizoSecureStoreRemoveString(forKey: key)
        #endif
        UserDefaults.standard.removeObject(forKey: key)
    }

    private func legacyString(forKey key: String) -> String? {
        UserDefaults.standard.string(forKey: key)
    }

    func migrateLegacyStringIfNeeded(forKey key: String) -> String? {
        guard let legacy = legacyString(forKey: key), !legacy.isEmpty else {
            return nil
        }
        #if os(Android)
        if porizoSecureStoreString(forKey: key) == nil {
            porizoSecureStoreSetString(legacy, forKey: key)
        }
        UserDefaults.standard.removeObject(forKey: key)
        #endif
        return legacy
    }
}

#if SKIP
func porizoSecureStoreString(forKey key: String) -> String? {
    let context = ProcessInfo.processInfo.androidContext
    return PorizoNativeSecureStore.getString(context: context, key: key)
}

func porizoSecureStoreSetString(_ value: String, forKey key: String) {
    let context = ProcessInfo.processInfo.androidContext
    PorizoNativeSecureStore.setString(context: context, key: key, value: value)
}

func porizoSecureStoreRemoveString(forKey key: String) {
    let context = ProcessInfo.processInfo.androidContext
    PorizoNativeSecureStore.removeString(context: context, key: key)
}
#endif
