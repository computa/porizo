import Foundation

/// Swift façade over the native share bridge (U10). Fires the system share
/// sheet, a direct SMS intent, or a clipboard copy. On non-Android hosts these
/// are inert stubs so the model layer compiles + tests run.
struct AndroidShareProvider: Sendable {

    @discardableResult
    func shareText(_ text: String) -> Bool {
        #if os(Android)
        return isOK(porizoShareText(text))
        #else
        return false
        #endif
    }

    @discardableResult
    func sendSMS(phone: String, body: String) -> Bool {
        #if os(Android)
        return isOK(porizoSendSms(phone, body))
        #else
        return false
        #endif
    }

    @discardableResult
    func copyToClipboard(_ text: String) -> Bool {
        #if os(Android)
        return isOK(porizoCopyToClipboard(text))
        #else
        return false
        #endif
    }

    private func isOK(_ raw: String) -> Bool {
        raw.split(separator: "|", maxSplits: 1).first.map(String.init) == "OK"
    }
}

/// One-tap "Send to {name}": direct SMS when a phone was captured in U7,
/// otherwise the system share sheet. Mirrors iOS DirectSendModel.present().
struct AndroidDirectSend: Sendable {
    let share: AndroidShareProvider

    init(share: AndroidShareProvider = AndroidShareProvider()) {
        self.share = share
    }

    @discardableResult
    func send(recipientName: String, phone: String?, link: String, contentType: CreateContentType) -> Bool {
        let body = ShareLogic.messageBody(recipientName: recipientName, link: link, contentType: contentType)
        switch ShareLogic.sendChannel(phone: phone) {
        case .sms(let phone):
            return share.sendSMS(phone: phone, body: body)
        case .shareSheet:
            return share.shareText(body)
        }
    }
}

#if SKIP
func porizoShareText(_ text: String) -> String {
    PorizoNativeShareBridge.shareText(text: text)
}

func porizoSendSms(_ phone: String, _ body: String) -> String {
    PorizoNativeShareBridge.sendSms(phone: phone, body: body)
}

func porizoCopyToClipboard(_ text: String) -> String {
    PorizoNativeShareBridge.copyToClipboard(text: text)
}
#endif
