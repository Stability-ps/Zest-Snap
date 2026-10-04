package app.zestsnap;

import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZestNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * The Supabase session lives in WebView cookies. CookieManager writes them to disk lazily, so persist
     * them whenever the app leaves the foreground: a swipe-away or OS kill must not sign the person out.
     */
    @Override
    public void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
    }
}
