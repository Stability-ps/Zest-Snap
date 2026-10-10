package app.zestsnap;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Today" home-screen widget: the next few Planner items for the current day, from the snapshot the app writes via
 * ZestNative.setWidgetData (lib/native/widget.ts). The snapshot covers three days, so the widget stays correct past
 * midnight; the system refreshes it every 30 minutes and the app pushes a new snapshot whenever the Planner changes.
 */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "zest_widget";
    static final String KEY = "snapshot";
    private static final int[] ROWS = { R.id.widget_row_0, R.id.widget_row_1, R.id.widget_row_2 };
    private static final int[] TIMES = { R.id.widget_time_0, R.id.widget_time_1, R.id.widget_time_2 };
    private static final int[] TITLES = { R.id.widget_title_0, R.id.widget_title_1, R.id.widget_title_2 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, render(context));
    }

    /** Redraws every placed widget (called after the app saves a new snapshot). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) manager.updateAppWidget(id, render(context));
    }

    static RemoteViews render(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        int count = 0;
        JSONArray items = null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject snapshot = new JSONObject(prefs.getString(KEY, "{}"));
            JSONObject day = snapshot.optJSONObject("days") == null ? null : snapshot.getJSONObject("days").optJSONObject(today);
            if (day != null) {
                count = day.optInt("count", 0);
                items = day.optJSONArray("items");
            }
        } catch (Exception ignored) {
            // A damaged snapshot shows the empty state; the app rewrites it on next open.
        }

        views.setTextViewText(R.id.widget_count, count == 0 ? "Nothing planned" : count == 1 ? "1 thing" : count + " things");
        int shown = items == null ? 0 : Math.min(items.length(), ROWS.length);
        for (int i = 0; i < ROWS.length; i++) {
            if (i < shown) {
                JSONObject item = items.optJSONObject(i);
                String time = item == null ? "" : item.optString("time", "");
                String title = item == null ? "" : item.optString("title", "");
                views.setViewVisibility(ROWS[i], View.VISIBLE);
                views.setTextViewText(TIMES[i], time.isEmpty() ? "All day" : time);
                views.setTextViewText(TITLES[i], title);
            } else {
                views.setViewVisibility(ROWS[i], View.GONE);
            }
        }
        views.setViewVisibility(R.id.widget_empty, shown == 0 ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_more, count > shown && shown > 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_more, "+" + Math.max(0, count - shown) + " more");

        // Tapping opens Planner › Today through the same verified App Link the app already handles.
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://app.zestsnap.app/app?view=calendar&tab=today"));
        open.setClass(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);
        return views;
    }
}
