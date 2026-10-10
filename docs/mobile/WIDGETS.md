# Home-screen widgets and the on-device Daily Briefing

## How the data flows

1. The app (web code running in the Capacitor shell) watches the Planner (`app/native-bridge.tsx`).
2. Whenever the Planner or the briefing settings change, and on every resume, it:
   - schedules the next three morning briefings as **local notifications** (`lib/native/briefing.ts`, IDs
     `2_000_000_001…003`, kept out of the reminder sync in `lib/native/notifications.ts`);
   - writes a three-day **widget snapshot** (`lib/native/widget.ts`) through `ZestNative.setWidgetData`.
3. The snapshot holds titles and times only — never descriptions or locations.

Native users no longer depend on web push for the briefing. Web/PWA users still get it from the
`deliver-reminders` edge function, which now lists items in time order (`08:30 Dentist · 10:00 Science fair`).
Deploy it after merging: `supabase functions deploy deliver-reminders`.

## Android

Nothing to set up. `TodayWidget` is registered in `AndroidManifest.xml`; after installing a build that contains it,
long-press the home screen → Widgets → Zest Snap → **Today**. The system refreshes it every 30 minutes and the app
pushes a new snapshot whenever the Planner changes. Tapping opens Planner › Today.

## iOS (one-time Xcode setup)

The widget code is in `ios/ZestWidget/ZestWidget.swift` but is **not** in any Xcode target yet, because adding a
target and an App Group changes signing and provisioning profiles. Until this is done, `setWidgetData` is a no-op
on iOS (it checks that the App Group container exists), so nothing breaks.

1. Apple Developer portal → Identifiers → App Groups → add `group.app.zestsnap`.
2. Xcode → `ios/App/App.xcworkspace` → File → New → Target → **Widget Extension**.
   - Product name `ZestWidget`, bundle id `app.zestsnap.ZestWidget`, untick *Include Configuration App Intent*
     and *Live Activity*. Activate the scheme if asked.
3. Replace the generated Swift files in the new `ZestWidget` group with `ios/ZestWidget/ZestWidget.swift`
   (delete the template's `ZestWidgetBundle.swift` — this file has its own `@main`).
4. Signing & Capabilities → **+ App Groups** → tick `group.app.zestsnap` on **both** the `App` target and the
   `ZestWidget` target.
5. Set the widget target's deployment target to iOS 15 or later and the same team as the app.
6. Update `ios-testflight.yml`/fastlane profiles so the extension's provisioning profile is included, then run
   the TestFlight workflow.

Test: install, open the app once (writes the snapshot), long-press the home screen → **+** → Zest Snap → Today.

## Checking the briefing on a device

Settings → Daily briefing → on, pick a time a couple of minutes ahead, save, then background the app.
