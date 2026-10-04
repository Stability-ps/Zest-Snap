import UIKit
import Capacitor

/// Zest Snap's bridge: registers app-local plugins and paints the WebView with the app's page colour,
/// so the hand-over from the navy launch screen and any overscroll match Zest Snap's screens.
class ZestBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ZestNativePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let surface = UIColor(red: 247 / 255, green: 250 / 255, blue: 252 / 255, alpha: 1)
        view.backgroundColor = surface
        webView?.isOpaque = false
        webView?.backgroundColor = surface
        webView?.scrollView.backgroundColor = surface
        // Pages manage safe areas themselves (viewport-fit=cover + env(safe-area-inset-*)).
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }
}
