// OneSignal web push worker for marketing notifications ("Tips and offers"), scoped to /push/onesignal/ so it
// never replaces the app's own worker (/sw.js, scope /app) that handles reminders and offline use.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
