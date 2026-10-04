import UIKit
import Capacitor

/// Small first-party plugin for OS integrations no official plugin covers (see lib/native/permissions.ts).
@objc(ZestNativePlugin)
public class ZestNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ZestNativePlugin"
    public let jsName = "ZestNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    /// Opens Settings › Zest Snap so a denied permission (camera, photos, notifications) can be re-enabled.
    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString), UIApplication.shared.canOpenURL(url) else {
                call.reject("Could not open settings")
                return
            }
            UIApplication.shared.open(url) { _ in call.resolve() }
        }
    }
}
