import UIKit
import Capacitor
import WidgetKit

/// Small first-party plugin for OS integrations no official plugin covers (see lib/native/permissions.ts).
@objc(ZestNativePlugin)
public class ZestNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ZestNativePlugin"
    public let jsName = "ZestNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise)
    ]

    /// App Group shared with the "Today" widget extension (docs/mobile/WIDGETS.md). Until the group is added to the
    /// app's signing (Xcode › Signing & Capabilities), there is no shared container and this is a quiet no-op.
    static let widgetAppGroup = "group.app.zestsnap"

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

    /// Saves the home-screen widget snapshot (lib/native/widget.ts) for the widget extension and asks iOS to redraw it.
    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), json.count <= 50_000 else {
            call.reject("Invalid widget data")
            return
        }
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ZestNativePlugin.widgetAppGroup) != nil,
              let shared = UserDefaults(suiteName: ZestNativePlugin.widgetAppGroup) else {
            call.resolve()
            return
        }
        shared.set(json, forKey: "snapshot")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
