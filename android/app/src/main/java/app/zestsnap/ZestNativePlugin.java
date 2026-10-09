package app.zestsnap;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small first-party plugin for OS integrations no official plugin covers (see lib/native/permissions.ts). */
@CapacitorPlugin(name = "ZestNative")
public class ZestNativePlugin extends Plugin {

    /** Opens Zest Snap's App info screen so a permanently denied permission can be re-enabled. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings");
        }
    }

    /**
     * Returns the real Android system-bar insets in CSS-compatible dp.
     * WebView env(safe-area-inset-*) can be zero on Samsung/three-button navigation even when bars overlap content.
     */
    @PluginMethod
    public void getSystemInsets(PluginCall call) {
        try {
            WindowInsetsCompat root = ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
            Insets px = root == null
                ? Insets.NONE
                : root.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getContext().getResources().getDisplayMetrics().density;
            JSObject result = new JSObject();
            result.put("top", px.top / density);
            result.put("right", px.right / density);
            result.put("bottom", px.bottom / density);
            result.put("left", px.left / density);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read system insets");
        }
    }

    /**
     * Whether Firebase was configured at build time. The google-services Gradle plugin generates the google_app_id
     * string only when android/app/google-services.json exists; without it FirebaseMessaging.getInstance() throws
     * and Capacitor turns that into a crash, so the web layer must not call PushNotifications.register().
     */
    @PluginMethod
    public void getPushConfiguration(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("firebase", id != 0);
        call.resolve(result);
    }
}
