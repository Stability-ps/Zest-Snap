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

    /** Saves the home-screen widget snapshot (lib/native/widget.ts) and redraws placed widgets. */
    @PluginMethod
    public void setWidgetData(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.length() > 50000) {
            call.reject("Invalid widget data");
            return;
        }
        try {
            getContext().getSharedPreferences(TodayWidget.PREFS, android.content.Context.MODE_PRIVATE).edit().putString(TodayWidget.KEY, json).apply();
            TodayWidget.refreshAll(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not update widget");
        }
    }
}
